import { PDFDocument, PDFName, PDFArray, PDFDict, StandardFonts, rgb } from 'pdf-lib';
import { runQpdf } from '../_qpdf/qpdf';
import {
  openPdf,
  copyPagesToPdf,
  cleanDanglingLinks,
  PasswordRequiredError,
  IncorrectPasswordError,
} from './pdfPages';
import { sanitizeHtml } from '../html-to-pdf/convert';
import { createStage } from '../_render/render';

export interface PageVerifyResults {
  encryptedOpsSuccess: boolean;
  danglingLinkFixSuccess: boolean;
  privacySanitizeSuccess: boolean;
  details: string[];
}

export async function runVerification(): Promise<PageVerifyResults> {
  const details: string[] = [];
  const log = (msg: string) => {
    details.push(msg);
    console.log(msg);
  };

  log('=== Starting PDF Pages, Encryption & Privacy Verification ===');

  // -------------------------------------------------------------
  // Test 1: Encrypted PDF Fixture - Prompt, Retry & Decrypted Export
  // -------------------------------------------------------------
  log('\n--- Test 1: Encrypted PDF Handling (openPdf + copyPages) ---');
  let encryptedOpsSuccess = false;
  try {
    const baseDoc = await PDFDocument.create();
    const font = await baseDoc.embedFont(StandardFonts.Helvetica);
    const page = baseDoc.addPage([500, 400]);
    page.drawText('Confidential Encrypted Page Data 42', { x: 50, y: 350, size: 14, font, color: rgb(0, 0, 0) });
    const rawBytes = await baseDoc.save();

    // Encrypt with qpdf: user password = 'user-secret', owner password = 'owner-secret'
    const encBytes = await runQpdf(rawBytes, ['--encrypt', 'user-secret', 'owner-secret', '256', '--']);
    const encBlob = new Blob([encBytes as BlobPart], { type: 'application/pdf' });
    log(`✓ Encrypted PDF fixture created (${encBytes.byteLength} bytes).`);

    // 1.1 Open without password must throw PasswordRequiredError
    let threwRequired = false;
    try {
      await openPdf(encBlob);
    } catch (err) {
      if (err instanceof PasswordRequiredError) {
        threwRequired = true;
      }
    }
    if (!threwRequired) {
      throw new Error('openPdf did not throw PasswordRequiredError for encrypted PDF');
    }
    log('✓ openPdf correctly threw PasswordRequiredError when no password provided.');

    // 1.2 Open with wrong password must throw IncorrectPasswordError
    let threwIncorrect = false;
    try {
      await openPdf(encBlob, 'wrong-password-123');
    } catch (err) {
      if (err instanceof IncorrectPasswordError) {
        threwIncorrect = true;
      }
    }
    if (!threwIncorrect) {
      throw new Error('openPdf did not throw IncorrectPasswordError for invalid password');
    }
    log('✓ openPdf correctly threw IncorrectPasswordError for wrong password.');

    // 1.3 Open with correct password must succeed
    const opened = await openPdf(encBlob, 'user-secret');
    if (opened.pageCount !== 1) {
      throw new Error(`Expected 1 page, got ${opened.pageCount}`);
    }
    log('✓ openPdf successfully decrypted and loaded document with correct password.');

    // 1.4 Export / copy pages from decrypted doc
    const exportedDoc = await copyPagesToPdf(opened.doc, [1]);
    const exportedBytes = await exportedDoc.save();
    const reloaded = await PDFDocument.load(exportedBytes);
    if (reloaded.getPageCount() !== 1) {
      throw new Error('Exported page count mismatch');
    }
    log('✓ Decrypted pages copied and saved into plain PDF successfully.');

    encryptedOpsSuccess = true;
  } catch (err) {
    log(`✗ Test 1 failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // -------------------------------------------------------------
  // Test 2: Organize copyPages Cross-Page Destination Link Bug
  // -------------------------------------------------------------
  log('\n--- Test 2: Dangling Link / Cross-Page Destination Bug Fix ---');
  let danglingLinkFixSuccess = false;
  try {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    const page1 = doc.addPage([600, 400]);
    page1.drawText('Public Kept Page Content', { x: 50, y: 350, size: 14, font });

    const page2 = doc.addPage([600, 400]);
    const SECRET_TEXT = 'TOP_SECRET_DELETED_CONTENT_REDACTED_888';
    page2.drawText(SECRET_TEXT, { x: 50, y: 350, size: 14, font });

    // Web link on Page 1 (must be preserved)
    const uriAction = doc.context.obj({ Type: 'Action', S: 'URI', URI: 'https://loconvert.local' });
    const uriAnnot = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 50, 50], A: uriAction });

    // Highlight on Page 1 (must be preserved)
    const hlAnnot = doc.context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [10, 60, 50, 80] });

    // Internal Link on Page 1 pointing to Page 2 (dangling when Page 2 is removed)
    const destArray = doc.context.obj([page2.ref, 'XYZ', null, null, null]);
    const crossPageLink = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [50, 340, 150, 360],
      Dest: destArray,
    });

    page1.node.set(
      PDFName.of('Annots'),
      doc.context.obj([
        doc.context.register(uriAnnot),
        doc.context.register(hlAnnot),
        doc.context.register(crossPageLink),
      ])
    );

    const twoPageBytes = await doc.save();
    const loadedForOrganize = await PDFDocument.load(twoPageBytes);

    // Keep Page 1 (index 0), delete Page 2 (index 1)
    cleanDanglingLinks(loadedForOrganize, [0]);
    const outDoc = await PDFDocument.create();
    const [copiedPage1] = await outDoc.copyPages(loadedForOrganize, [0]);
    outDoc.addPage(copiedPage1);

    const outBytes = await outDoc.save();
    const reloadedOut = await PDFDocument.load(outBytes);

    if (reloadedOut.getPageCount() !== 1) {
      throw new Error(`Expected exactly 1 page in output, got ${reloadedOut.getPageCount()}`);
    }

    // Verify Page 2's leaf object does NOT exist in the output PDF context
    let pageObjCount = 0;
    for (const [, obj] of reloadedOut.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of('Type'))?.toString() === '/Page') {
        pageObjCount++;
      }
    }
    if (pageObjCount !== 1) {
      throw new Error(`Expected only 1 /Page object in output context, found ${pageObjCount}`);
    }
    log('✓ Verified: Zero deleted /Page dictionary objects copied into output document.');

    // Verify non-dangling annotations (URI link and Highlight) on Page 1 were retained
    const p1Annots = reloadedOut.context.lookup(reloadedOut.getPages()[0].node.get(PDFName.of('Annots')));
    if (!(p1Annots instanceof PDFArray) || p1Annots.size() !== 2) {
      throw new Error(`Expected 2 retained annotations (URI and Highlight), got ${p1Annots instanceof PDFArray ? p1Annots.size() : 0}`);
    }
    log('✓ Verified: Non-dangling annotations (URI link + Highlight) successfully preserved.');

    danglingLinkFixSuccess = true;
  } catch (err) {
    log(`✗ Test 2 failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // -------------------------------------------------------------
  // Test 3: Office/HTML Privacy Canary - Neutralized from First Render
  // -------------------------------------------------------------
  log('\n--- Test 3: Office/HTML Privacy Canary Sanitization ---');
  let privacySanitizeSuccess = false;
  try {
    const canaryHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <base href="https://canary.evil.com/base/">
          <link rel="stylesheet" href="https://canary.evil.com/style.css">
          <style>
            @import url('https://canary.evil.com/import.css');
            body { background: url('https://canary.evil.com/body-bg.png'); }
          </style>
        </head>
        <body style="background-image: url('https://canary.evil.com/inline-bg.png');">
          <script>window.__canary_leaked = true;</script>
          <img src="https://canary.evil.com/canary.jpg" alt="Secret Document Logo">
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA=" alt="Safe">
          <a href="https://canary.evil.com/outbound">Leak Link</a>
          <form action="https://canary.evil.com/submit"><input type="submit"></form>
          <div onclick="window.__canary_leaked=true">Content</div>
        </body>
      </html>
    `;

    const sanitized = sanitizeHtml(canaryHtml);

    if (sanitized.includes('canary.evil.com')) {
      throw new Error('Canary external URLs still present in sanitized HTML!');
    }
    if (sanitized.includes('__canary_leaked') || sanitized.includes('<script')) {
      throw new Error('Scripts not removed in sanitized HTML');
    }
    if (sanitized.includes('<base')) {
      throw new Error('<base> tag not removed');
    }
    if (!sanitized.includes('Content-Security-Policy')) {
      throw new Error('Missing CSP meta tag in sanitized HTML');
    }
    if (!sanitized.includes('[Secret Document Logo]')) {
      throw new Error('Alt text placeholder not preserved for neutralized external image');
    }
    log('✓ User HTML canary neutralized: Zero remote URLs, scripts, or base tags; CSP meta injected.');

    // Test stage in CSP-constrained iframe
    const { stage, dispose } = createStage(800);
    const stageDoc = stage.ownerDocument;
    const stageCsp = stageDoc.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (!stageCsp) {
      throw new Error('createStage iframe document lacks CSP meta tag');
    }
    dispose();
    log('✓ createStage verifies isolated CSP-constrained iframe staging before render.');

    privacySanitizeSuccess = true;
  } catch (err) {
    log(`✗ Test 3 failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  log('\n=== Summary of PDF Pages Verification ===');
  log(`1. Encrypted Ops (Password required/wrong/decrypt): ${encryptedOpsSuccess ? 'PASS' : 'FAIL'}`);
  log(`2. Dangling Link / Deleted Content Purge:            ${danglingLinkFixSuccess ? 'PASS' : 'FAIL'}`);
  log(`3. Office/HTML Privacy Canary Pre-Render:           ${privacySanitizeSuccess ? 'PASS' : 'FAIL'}`);

  return {
    encryptedOpsSuccess,
    danglingLinkFixSuccess,
    privacySanitizeSuccess,
    details,
  };
}
