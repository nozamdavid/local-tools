import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { loadPdfDocument } from '../../image/_pdf/pdfRenderer';
import { applyAnnotations } from './annotate';
import { applyFormValues, extractFormFields } from './forms';
import { redactPdf } from './redact';
import type { Annotation, RedactionBox } from './types';

export interface VerifyResults {
  formFlattenSuccess: boolean;
  annotationRetainSuccess: boolean;
  redactionCleanSuccess: boolean;
  details: string[];
}

export async function runVerification(): Promise<VerifyResults> {
  const details: string[] = [];
  const log = (msg: string) => {
    details.push(msg);
    console.log(msg);
  };

  log('=== Starting PDF Edit, Forms & Redaction Verification ===');

  // -------------------------------------------------------------
  // Test 1: Fill + Flatten Output Values
  // -------------------------------------------------------------
  log('\n--- Test 1: Fill + Flatten Output Values ---');
  let formFlattenSuccess: boolean;
  {
    const formDoc = await PDFDocument.create();
    const font = await formDoc.embedFont(StandardFonts.Helvetica);
    const page = formDoc.addPage([600, 400]);
    page.drawText('Form Test Page', { x: 50, y: 350, size: 14, font, color: rgb(0, 0, 0) });

    const form = formDoc.getForm();
    const textField = form.createTextField('fullName');
    textField.addToPage(page, { x: 50, y: 300, width: 200, height: 24 });

    const checkField = form.createCheckBox('acceptedTerms');
    checkField.addToPage(page, { x: 50, y: 250, width: 20, height: 20 });

    const radioGroup = form.createRadioGroup('deliveryMethod');
    radioGroup.addOptionToPage('express', page, { x: 50, y: 200, width: 16, height: 16 });
    radioGroup.addOptionToPage('standard', page, { x: 120, y: 200, width: 16, height: 16 });

    const dropdown = form.createDropdown('roleSelect');
    dropdown.addOptions(['Admin', 'User', 'Guest']);
    dropdown.addToPage(page, { x: 50, y: 150, width: 150, height: 24 });

    // Verify fields extraction
    const extracted = extractFormFields(formDoc);
    if (extracted.length !== 4) {
      throw new Error(`Expected 4 extracted fields, got ${extracted.length}`);
    }
    log(`✓ Successfully extracted 4 form fields: ${extracted.map((f) => f.name).join(', ')}`);

    // Apply values & flatten
    const values = {
      fullName: 'Alice Walker',
      acceptedTerms: true,
      deliveryMethod: 'express',
      roleSelect: 'Admin',
    };
    await applyFormValues(formDoc, values, true /* flatten */);

    const savedBytes = await formDoc.save();
    const reloaded = await PDFDocument.load(savedBytes);

    // After flattening, interactive AcroForm fields should be removed / baked into page
    const reloadedFields = reloaded.getForm().getFields();
    if (reloadedFields.length !== 0) {
      throw new Error(`Form fields were not flattened; found ${reloadedFields.length} fields`);
    }

    // Verify using pdf.js text extraction that the text value "Alice Walker" is in the flattened page
    const pdfjsDoc = await loadPdfDocument(new Blob([savedBytes as BlobPart], { type: 'application/pdf' }));
    const p1 = await pdfjsDoc.getPage(1);
    const tc = await p1.getTextContent();
    const extractedStrings = tc.items.map((i: any) => i.str || '');
    if (!extractedStrings.some((s) => s.includes('Alice Walker'))) {
      throw new Error(`Flattened PDF page does not contain text value "Alice Walker", got: ${JSON.stringify(extractedStrings)}`);
    }

    log('✓ Form fields filled, flattened, and value "Alice Walker" verified in flattened output.');
    formFlattenSuccess = true;
  }

  // -------------------------------------------------------------
  // Test 2: Annotation Output Original Content Retained
  // -------------------------------------------------------------
  log('\n--- Test 2: Annotation Output Original Content Retained ---');
  let annotationRetainSuccess: boolean;
  {
    const baseDoc = await PDFDocument.create();
    const font = await baseDoc.embedFont(StandardFonts.Helvetica);
    const basePage = baseDoc.addPage([600, 800]);

    const originalContent = 'Original Confidential Page 1 Content That Must Be Retained';
    basePage.drawText(originalContent, {
      x: 60,
      y: 700,
      size: 14,
      font,
      color: rgb(0, 0, 0),
    });

    const originalBytes = await baseDoc.save();
    const annotDoc = await PDFDocument.load(originalBytes);

    const testAnnotations: Annotation[] = [
      {
        id: 'ann-1',
        type: 'text',
        pageNum: 1,
        text: 'Approved by Reviewer 42',
        fontSize: 14,
        color: '#ff0000',
        backgroundColor: '#ffff00',
        xPercent: 10,
        yPercent: 40,
        widthPercent: 40,
        heightPercent: 5,
      },
      {
        id: 'ann-2',
        type: 'rect',
        pageNum: 1,
        strokeColor: '#0000ff',
        strokeWidth: 2,
        fillColor: '#eeeeee',
        xPercent: 10,
        yPercent: 20,
        widthPercent: 30,
        heightPercent: 10,
      },
    ];

    await applyAnnotations(annotDoc, testAnnotations);
    const annotatedBytes = await annotDoc.save();

    // Verify using pdf.js text extraction that original content is retained and annotation text is present
    const pdfjsDoc = await loadPdfDocument(new Blob([annotatedBytes as BlobPart], { type: 'application/pdf' }));
    const p1 = await pdfjsDoc.getPage(1);
    const tc = await p1.getTextContent();
    const extractedStrings = tc.items.map((i: any) => i.str || '');

    const hasOriginal = extractedStrings.some((s) => s.includes('Original Confidential Page 1 Content That Must Be Retained'));
    if (!hasOriginal) {
      throw new Error('Original content was lost after applying annotations!');
    }

    const hasAnnotation = extractedStrings.some((s) => s.includes('Approved by Reviewer 42'));
    if (!hasAnnotation) {
      throw new Error('Annotation text was not added to the document!');
    }

    log('✓ Original document text retained intact and new annotations successfully applied.');
    annotationRetainSuccess = true;
  }

  // -------------------------------------------------------------
  // Test 3: Redaction Output Contains No Sensitive Text / Attachments
  // -------------------------------------------------------------
  log('\n--- Test 3: Redaction Output Purges Sensitive Text & Attachments ---');
  let redactionCleanSuccess: boolean;
  {
    const sensitiveDoc = await PDFDocument.create();
    const font = await sensitiveDoc.embedFont(StandardFonts.Helvetica);
    const page = sensitiveDoc.addPage([600, 800]);

    const sensitiveString = 'SUPER_SECRET_SSN_987-65-4321';
    page.drawText(`Customer Record: ${sensitiveString}`, {
      x: 50,
      y: 720,
      size: 16,
      font,
      color: rgb(0, 0, 0),
    });

    // Attach sensitive file
    const attachmentContent = new TextEncoder().encode('Confidential payroll source attachment data');
    await sensitiveDoc.attach(attachmentContent, 'classified_source.txt', {
      mimeType: 'text/plain',
      description: 'Classified attachment',
    });

    sensitiveDoc.setTitle('Confidential Document Title');
    sensitiveDoc.setAuthor('Top Secret Author');

    const sensitiveBytes = await sensitiveDoc.save({ useObjectStreams: false });

    // Load in pdf.js
    const pdfjsDoc = await loadPdfDocument(new Blob([sensitiveBytes as BlobPart], { type: 'application/pdf' }));
    const origPage = await pdfjsDoc.getPage(1);
    const origTc = await origPage.getTextContent();
    const origStrings = origTc.items.map((i: any) => i.str || '');

    // Pre-condition check: sensitive text, attachment, and /EmbeddedFile must exist in source
    if (!origStrings.some((s) => s.includes('SUPER_SECRET_SSN_987-65-4321'))) {
      throw new Error('Test setup error: sensitive text not in source PDF');
    }
    const rawSensitive = new TextDecoder().decode(sensitiveBytes);
    if (!rawSensitive.includes('classified_source.txt') || !rawSensitive.includes('/EmbeddedFile')) {
      throw new Error('Test setup error: source attachment not in source PDF');
    }
    log('✓ Pre-condition verified: Source PDF contains sensitive text, classified attachment, and /EmbeddedFile object.');

    // Define redaction box over top area
    const redactionBoxes: RedactionBox[] = [
      {
        id: 'redact-1',
        pageNum: 1,
        xPercent: 5,
        yTopPercent: 5,
        widthPercent: 90,
        heightPercent: 20,
        color: '#000000',
      },
    ];

    // Redact
    const redactedBytes = await redactPdf(pdfjsDoc, redactionBoxes, { dpi: 150 });
    const rawRedacted = new TextDecoder().decode(redactedBytes);

    // 1. Verify sensitive text is NOT in the PDF byte stream
    if (rawRedacted.includes('SUPER_SECRET_SSN_987-65-4321')) {
      throw new Error('REDACTION FAILURE: Sensitive string still found in redacted PDF stream!');
    }

    // 2. Verify source attachment and /EmbeddedFile are NOT in the PDF byte stream
    if (rawRedacted.includes('classified_source.txt') || rawRedacted.includes('/EmbeddedFile')) {
      throw new Error('REDACTION FAILURE: Classified attachment or /EmbeddedFile still found in redacted PDF stream!');
    }

    // 3. Verify clean metadata in reconstructed PDFDocument
    const redactedPdfDoc = await PDFDocument.load(redactedBytes);
    if (redactedPdfDoc.getTitle()) {
      throw new Error(`Metadata title was not sanitized: ${redactedPdfDoc.getTitle()}`);
    }
    if (redactedPdfDoc.getAuthor()) {
      throw new Error(`Metadata author was not sanitized: ${redactedPdfDoc.getAuthor()}`);
    }

    // 4. Verify text content extraction via pdf.js returns NO selectable text (fully rasterized)
    const redactedPdfjsDoc = await loadPdfDocument(new Blob([redactedBytes as BlobPart], { type: 'application/pdf' }));
    const p1 = await redactedPdfjsDoc.getPage(1);
    const textContent = await p1.getTextContent();
    const extractedChars = textContent.items
      .map((item: any) => item.str || '')
      .join('')
      .trim();

    if (extractedChars.length > 0) {
      throw new Error(`Expected zero selectable text on rasterized page, but extracted: "${extractedChars}"`);
    }

    log('✓ Redaction verified: Zero sensitive text, zero source attachments, zero metadata, and zero selectable text.');
    redactionCleanSuccess = true;
  }

  log('\n=== All PDF Verification Checks Passed Successfully! ===');

  return {
    formFlattenSuccess,
    annotationRetainSuccess,
    redactionCleanSuccess,
    details,
  };
}
