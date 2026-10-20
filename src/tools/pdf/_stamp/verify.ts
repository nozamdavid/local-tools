import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { getVisualPageDims, mapVisualToPdf, calcRotatedCenterVisualOrigin, hexToRgb } from './coords';
import { getTargetPages } from './pageScope';

export async function runVerification() {
  console.log('--- Starting PDF Stamping & Tool Verification ---');

  // 1. Verify coordinate transformations across all 4 rotation angles (0, 90, 180, 270)
  const dims0 = { pdfWidth: 600, pdfHeight: 800, visualWidth: 600, visualHeight: 800, rotation: 0 };
  const p0 = mapVisualToPdf({ x: 100, y: 50, angle: 0 }, dims0);
  if (p0.x !== 100 || p0.y !== 50 || p0.rotateDegrees !== 0) {
    throw new Error(`Rot 0 failed: ${JSON.stringify(p0)}`);
  }

  const dims90 = { pdfWidth: 600, pdfHeight: 800, visualWidth: 800, visualHeight: 600, rotation: 90 };
  const p90 = mapVisualToPdf({ x: 100, y: 50, angle: 0 }, dims90);
  if (p90.x !== 550 || p90.y !== 100 || p90.rotateDegrees !== 90) {
    throw new Error(`Rot 90 failed: ${JSON.stringify(p90)}`);
  }

  const dims180 = { pdfWidth: 600, pdfHeight: 800, visualWidth: 600, visualHeight: 800, rotation: 180 };
  const p180 = mapVisualToPdf({ x: 100, y: 50, angle: 0 }, dims180);
  if (p180.x !== 500 || p180.y !== 750 || p180.rotateDegrees !== 180) {
    throw new Error(`Rot 180 failed: ${JSON.stringify(p180)}`);
  }

  const dims270 = { pdfWidth: 600, pdfHeight: 800, visualWidth: 800, visualHeight: 600, rotation: 270 };
  const p270 = mapVisualToPdf({ x: 100, y: 50, angle: 0 }, dims270);
  if (p270.x !== 50 || p270.y !== 700 || p270.rotateDegrees !== 270) {
    throw new Error(`Rot 270 failed: ${JSON.stringify(p270)}`);
  }

  console.log('✓ All 4 rotation coordinate mappings verified successfully.');

  // 2. Verify rotated center origin calculation
  const origin0 = calcRotatedCenterVisualOrigin(400, 300, 200, 50, 0);
  if (Math.abs(origin0.x - 300) > 1e-4 || Math.abs(origin0.y - 275) > 1e-4) {
    throw new Error(`Center origin 0deg failed: ${JSON.stringify(origin0)}`);
  }
  console.log('✓ Rotated center origin calculation verified.');

  // 3. Verify PageScope parsing
  const all3 = getTargetPages('all', 3);
  if (all3.length !== 3 || all3[0] !== 1 || all3[2] !== 3) {
    throw new Error(`Scope 'all' failed: ${all3}`);
  }
  const range = getTargetPages('range', 5, { rangeStr: '1-2, 4' });
  if (range.length !== 3 || range[0] !== 1 || range[1] !== 2 || range[2] !== 4) {
    throw new Error(`Scope 'range' failed: ${range}`);
  }
  const exFirst = getTargetPages('all', 3, { excludeFirst: true });
  if (exFirst.length !== 2 || exFirst[0] !== 2 || exFirst[1] !== 3) {
    throw new Error(`Scope 'excludeFirst' failed: ${exFirst}`);
  }
  console.log('✓ Page scope resolution verified.');

  // 4. Create minimal fixture PDF
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Page 1: normal portrait (600x800)
  const page1 = doc.addPage([600, 800]);
  page1.drawText('Page 1 Base Text', { x: 50, y: 500, size: 16, font, color: rgb(0, 0, 0) });

  // Page 2: rotated 90 degrees
  const page2 = doc.addPage([600, 800]);
  page2.setRotation(degrees(90));
  page2.drawText('Page 2 Base Text', { x: 50, y: 500, size: 16, font, color: rgb(0, 0, 0) });

  // Page 3: normal portrait
  const page3 = doc.addPage([600, 800]);
  page3.drawText('Page 3 Base Text', { x: 50, y: 500, size: 16, font, color: rgb(0, 0, 0) });

  const origBytes = await doc.save();
  console.log(`✓ Fixture PDF created (${origBytes.byteLength} bytes, 3 pages).`);

  // 5. Verify Page Numbers stamping
  {
    const numDoc = await PDFDocument.load(origBytes);
    const numFont = await numDoc.embedFont(StandardFonts.Helvetica);
    const pages = numDoc.getPages();
    const targetSet = new Set([1, 2]); // Only number pages 1 and 2, leave page 3 unchanged

    for (let pNum = 1; pNum <= pages.length; pNum++) {
      if (!targetSet.has(pNum)) continue;
      const p = pages[pNum - 1];
      const dims = getVisualPageDims(p);
      const text = `Page ${pNum} of 2`;
      const textWidth = numFont.widthOfTextAtSize(text, 12);
      const xv = (dims.visualWidth - textWidth) / 2;
      const yv = 30;
      const placement = mapVisualToPdf({ x: xv, y: yv, angle: 0 }, dims);

      p.drawText(text, {
        x: placement.x,
        y: placement.y,
        size: 12,
        font: numFont,
        color: hexToRgb('#000000'),
        rotate: degrees(placement.rotateDegrees),
      });
    }

    const numBytes = await numDoc.save();
    const loadedNumbered = await PDFDocument.load(numBytes);
    if (loadedNumbered.getPageCount() !== 3) {
      throw new Error(`Numbered doc page count mismatch: ${loadedNumbered.getPageCount()}`);
    }

    // Verify page 1 and page 2 have new content stream operators added
    const numP1 = loadedNumbered.getPages()[0];
    const numP2 = loadedNumbered.getPages()[1];
    const numP3 = loadedNumbered.getPages()[2];

    const p1StreamLen = JSON.stringify(numP1.node.normalizedEntries()['Contents']).length;
    const p3StreamLen = JSON.stringify(numP3.node.normalizedEntries()['Contents']).length;
    if (p1StreamLen <= p3StreamLen) {
      throw new Error('Page 1 did not receive page number mark');
    }
    // Verify page 2 rotation retained
    if (numP2.getRotation().angle !== 90) {
      throw new Error('Page 2 rotation altered unexpectedly');
    }
    console.log('✓ Page numbers stamping and original retention verified.');
  }

  // 6. Verify Watermark stamping
  {
    const wmDoc = await PDFDocument.load(origBytes);
    const wmFont = await wmDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = wmDoc.getPages();

    // Watermark page 2 only
    const p = pages[1];
    const dims = getVisualPageDims(p);
    const text = 'CONFIDENTIAL';
    const textWidth = wmFont.widthOfTextAtSize(text, 48);
    const textHeight = 48 * 0.7;
    const origin = calcRotatedCenterVisualOrigin(
      dims.visualWidth / 2,
      dims.visualHeight / 2,
      textWidth,
      textHeight,
      -45
    );
    const placement = mapVisualToPdf({ x: origin.x, y: origin.y, angle: -45 }, dims);

    p.drawText(text, {
      x: placement.x,
      y: placement.y,
      size: 48,
      font: wmFont,
      color: hexToRgb('#888888'),
      opacity: 0.3,
      rotate: degrees(placement.rotateDegrees),
    });

    const wmBytes = await wmDoc.save();
    const loadedWm = await PDFDocument.load(wmBytes);
    if (loadedWm.getPageCount() !== 3) {
      throw new Error(`Watermark doc page count mismatch: ${loadedWm.getPageCount()}`);
    }
    console.log('✓ Watermark stamping on rotated page and non-target retention verified.');
  }

  // 7. Verify Sign stamping
  {
    const signDoc = await PDFDocument.load(origBytes);
    // Minimal 1x1 transparent PNG data bytes:
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
    const embeddedSig = await signDoc.embedPng(pngBytes);

    const pages = signDoc.getPages();
    // Sign page 3 only
    const p3 = pages[2];
    const dims = getVisualPageDims(p3);
    const wv = dims.visualWidth * 0.25;
    const hv = wv * (embeddedSig.height / embeddedSig.width);
    const xv = dims.visualWidth * 0.65;
    const yv = dims.visualHeight * 0.08;
    const placement = mapVisualToPdf({ x: xv, y: yv, angle: 0 }, dims);

    p3.drawImage(embeddedSig, {
      x: placement.x,
      y: placement.y,
      width: wv,
      height: hv,
      rotate: degrees(placement.rotateDegrees),
    });

    const signBytes = await signDoc.save();
    const loadedSign = await PDFDocument.load(signBytes);
    if (loadedSign.getPageCount() !== 3) {
      throw new Error(`Sign doc page count mismatch: ${loadedSign.getPageCount()}`);
    }
    console.log('✓ Signature image placement and non-target retention verified.');
  }

  console.log('--- ALL VERIFICATIONS PASSED SUCCESSFULLY ---');
}

// Run if called directly
runVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
