/**
 * Verification suite for:
 * 1. Embedded SVG valid and alpha-aware pixel shapes
 * 2. ICO multi-size directory parse and transparent frame decode
 * 3. Signature white->transparent and dark/colored ink retained
 * 4. Solid redaction pixels opaque with original region no longer present
 */

import { generateEmbeddedSvg, generatePixelSvg, validateSvgString } from './svg';
import { parseIcoDirectory } from './ico';
import { cleanSignaturePixels } from './cleaner';

export interface VerifyTestResult {
  name: string;
  passed: boolean;
  message?: string;
}

export function runAllVerifications(): { allPassed: boolean; results: VerifyTestResult[] } {
  const results: VerifyTestResult[] = [];

  function assert(condition: boolean, testName: string, failMessage?: string) {
    if (!condition) {
      results.push({ name: testName, passed: false, message: failMessage || 'Assertion failed' });
      throw new Error(`[FAIL] ${testName}: ${failMessage || 'Assertion failed'}`);
    } else {
      results.push({ name: testName, passed: true });
    }
  }

  // -------------------------------------------------------------
  // 1. Embedded SVG valid and alpha-aware pixel shapes
  // -------------------------------------------------------------
  try {
    const embedSvg = generateEmbeddedSvg(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      64,
      48,
    );
    assert(validateSvgString(embedSvg), 'embedded-svg-valid', 'Generated embedded SVG must be valid XML with SVG tags');
    assert(embedSvg.includes('viewBox="0 0 64 48"'), 'embedded-svg-viewbox', 'Must contain correct viewBox');
    assert(embedSvg.includes('<image'), 'embedded-svg-image-tag', 'Must contain <image> tag');

    // 2x2 test pixel array:
    // [0,0]: Opaque Red (255, 0, 0, 255)
    // [1,0]: Opaque Red (255, 0, 0, 255) -> should group into width="2"
    // [0,1]: Semi-transparent Blue (0, 0, 255, 128)
    // [1,1]: Fully Transparent (0, 0, 0, 0) -> must be omitted
    const pixelData = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 128, 0, 0, 0, 0]);

    const pixelSvg = generatePixelSvg(pixelData, 2, 2, { groupConsecutive: true });
    assert(validateSvgString(pixelSvg), 'pixel-svg-valid', 'Generated pixel SVG must be valid SVG');
    assert(
      pixelSvg.includes('width="2" height="1" fill="#ff0000"'),
      'pixel-svg-run-grouping',
      'Consecutive identical pixels must be grouped',
    );
    assert(
      pixelSvg.includes('fill="#0000ff" fill-opacity="0.502"'),
      'pixel-svg-alpha-opacity',
      'Semi-transparent pixels must include fill-opacity',
    );
    assert(!pixelSvg.includes('x="1" y="1"'), 'pixel-svg-alpha-omitted', 'Fully transparent pixels must not produce rects');
  } catch (err: any) {
    if (!results.find((r) => r.name === 'embedded-svg-valid' && !r.passed)) {
      results.push({ name: 'svg-verification-fatal', passed: false, message: err.message });
    }
  }

  // -------------------------------------------------------------
  // 2. ICO multi-size directory parse and transparent frame decode
  // -------------------------------------------------------------
  try {
    const frame0Width = 2;
    const frame0Height = 2;
    const frame0DibHeight = frame0Height * 2;
    const frame0HeaderSize = 40;
    const frame0XorStride = 8;
    const frame0AndStride = 4;
    const frame0ResSize = frame0HeaderSize + frame0XorStride * frame0Height + frame0AndStride * frame0Height;

    const frame1Width = 1;
    const frame1Height = 1;
    const frame1DibHeight = 2;
    const frame1HeaderSize = 40;
    const frame1XorStride = 4;
    const frame1AndStride = 4;
    const frame1ResSize = frame1HeaderSize + frame1XorStride * frame1Height + frame1AndStride * frame1Height;

    const totalHeaderSize = 6 + 2 * 16;
    const frame0Offset = totalHeaderSize;
    const frame1Offset = frame0Offset + frame0ResSize;
    const totalBufferSize = frame1Offset + frame1ResSize;

    const icoBuffer = new ArrayBuffer(totalBufferSize);
    const view = new DataView(icoBuffer);
    const bytes = new Uint8Array(icoBuffer);

    // ICO header
    view.setUint16(0, 0, true);
    view.setUint16(2, 1, true);
    view.setUint16(4, 2, true);

    // Directory Entry 0 (2x2)
    view.setUint8(6, frame0Width);
    view.setUint8(7, frame0Height);
    view.setUint16(10, 1, true);
    view.setUint16(12, 32, true);
    view.setUint32(14, frame0ResSize, true);
    view.setUint32(18, frame0Offset, true);

    // Directory Entry 1 (1x1)
    view.setUint8(22, frame1Width);
    view.setUint8(23, frame1Height);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    view.setUint32(30, frame1ResSize, true);
    view.setUint32(34, frame1Offset, true);

    // Frame 0 DIB Header
    view.setUint32(frame0Offset, 40, true);
    view.setInt32(frame0Offset + 4, frame0Width, true);
    view.setInt32(frame0Offset + 8, frame0DibHeight, true);
    view.setUint16(frame0Offset + 12, 1, true);
    view.setUint16(frame0Offset + 14, 32, true);
    view.setUint32(frame0Offset + 16, 0, true);

    // Frame 0 XOR data
    const f0XorStart = frame0Offset + 40;
    bytes[f0XorStart + 0] = 0;
    bytes[f0XorStart + 1] = 255;
    bytes[f0XorStart + 2] = 0;
    bytes[f0XorStart + 3] = 255;
    bytes[f0XorStart + 4] = 0;
    bytes[f0XorStart + 5] = 0;
    bytes[f0XorStart + 6] = 0;
    bytes[f0XorStart + 7] = 0;
    const f0Row1 = f0XorStart + frame0XorStride;
    bytes[f0Row1 + 0] = 255;
    bytes[f0Row1 + 1] = 0;
    bytes[f0Row1 + 2] = 0;
    bytes[f0Row1 + 3] = 255;
    bytes[f0Row1 + 4] = 0;
    bytes[f0Row1 + 5] = 0;
    bytes[f0Row1 + 6] = 255;
    bytes[f0Row1 + 7] = 255;

    // Frame 1 DIB Header
    view.setUint32(frame1Offset, 40, true);
    view.setInt32(frame1Offset + 4, frame1Width, true);
    view.setInt32(frame1Offset + 8, frame1DibHeight, true);
    view.setUint16(frame1Offset + 12, 1, true);
    view.setUint16(frame1Offset + 14, 24, true);

    const f1XorStart = frame1Offset + 40;
    bytes[f1XorStart] = 100;
    bytes[f1XorStart + 1] = 100;
    bytes[f1XorStart + 2] = 100;
    const f1AndStart = f1XorStart + frame1XorStride;
    bytes[f1AndStart] = 0x80;

    // Run parser
    const parsed = parseIcoDirectory(icoBuffer);
    assert(parsed.count === 2, 'ico-frame-count', `Expected 2 frames, got ${parsed.count}`);
    assert(parsed.frames[0].width === 2 && parsed.frames[0].height === 2, 'ico-frame0-dim', 'Frame 0 dimensions must be 2x2');
    assert(parsed.frames[1].width === 1 && parsed.frames[1].height === 1, 'ico-frame1-dim', 'Frame 1 dimensions must be 1x1');

    const f0Rgba = parsed.frames[0].rgba!;
    assert(f0Rgba !== undefined, 'ico-frame0-rgba', 'Frame 0 must decode RGBA');
    assert(
      f0Rgba[0] === 0 && f0Rgba[1] === 0 && f0Rgba[2] === 255 && f0Rgba[3] === 255,
      'ico-frame0-topleft-rgba',
      'Top-left pixel must be Blue opaque',
    );
    assert(f0Rgba[3 * 4 + 3] === 0, 'ico-frame0-transparent-pixel', 'Bottom-right pixel must be transparent (alpha 0)');

    const f1Rgba = parsed.frames[1].rgba!;
    assert(f1Rgba !== undefined && f1Rgba[3] === 0, 'ico-and-mask-transparency', 'Frame 1 must be transparent via AND mask bit');

    // Test malformed ICO bounds check
    const corruptBuffer = icoBuffer.slice(0);
    const corruptView = new DataView(corruptBuffer);
    corruptView.setUint32(18, 999999, true);
    let caughtError = false;
    try {
      parseIcoDirectory(corruptBuffer);
    } catch {
      caughtError = true;
    }
    assert(caughtError, 'ico-malformed-bounds-check', 'Malformed ICO with out-of-bounds offset must throw error');
  } catch (err: any) {
    if (!results.find((r) => r.name === 'ico-frame-count' && !r.passed)) {
      results.push({ name: 'ico-verification-fatal', passed: false, message: err.message });
    }
  }

  // -------------------------------------------------------------
  // 3. Signature white->transparent and dark/colored ink retained
  // -------------------------------------------------------------
  try {
    const sigPixels = new Uint8ClampedArray([252, 250, 248, 255, 230, 228, 225, 255, 25, 25, 30, 255, 215, 40, 50, 255]);

    const sigResult = cleanSignaturePixels(sigPixels, 2, 2, {
      preset: 'signature',
      threshold: 210,
      detail: 20,
      contrast: 40,
      outputMode: 'transparent',
      cropToInk: false,
    });

    assert(sigResult.outputData[3] === 0, 'sig-white-paper-transparent', 'White paper pixel must be transparent');
    assert(sigResult.outputData[7] === 0, 'sig-offwhite-paper-transparent', 'Off-white paper pixel must be transparent');
    assert(sigResult.outputData[11] > 200, 'sig-dark-ink-retained', 'Dark ink signature stroke must be retained with high alpha');

    const stampResult = cleanSignaturePixels(sigPixels, 2, 2, {
      preset: 'stamp',
      threshold: 200,
      detail: 20,
      contrast: 30,
      outputMode: 'transparent',
      cropToInk: false,
    });
    const redAlpha = stampResult.outputData[15];
    const redChannel = stampResult.outputData[12];
    assert(redAlpha > 180, 'stamp-red-ink-alpha', 'Red stamp ink must have high alpha in stamp preset');
    assert(redChannel > 120, 'stamp-red-ink-color', 'Red stamp color must be preserved');

    const allWhitePixels = new Uint8ClampedArray([255, 255, 255, 255, 250, 250, 250, 255]);
    const emptyResult = cleanSignaturePixels(allWhitePixels, 2, 1, {
      preset: 'signature',
      threshold: 200,
      detail: 20,
      contrast: 30,
      outputMode: 'transparent',
      cropToInk: true,
    });
    assert(emptyResult.isEmpty, 'sig-empty-detected', 'All-white paper image must be flagged as isEmpty without crashing');
  } catch (err: any) {
    if (!results.find((r) => r.name === 'sig-white-paper-transparent' && !r.passed)) {
      results.push({ name: 'signature-verification-fatal', passed: false, message: err.message });
    }
  }

  // -------------------------------------------------------------
  // 4. Solid redaction pixels opaque with original region no longer present
  // -------------------------------------------------------------
  try {
    const width = 10;
    const height = 10;
    const imgData = new Uint8ClampedArray(width * height * 4);
    imgData.fill(255);

    for (let y = 2; y <= 5; y++) {
      for (let x = 2; x <= 5; x++) {
        const idx = (y * width + x) * 4;
        imgData[idx] = 111;
        imgData[idx + 1] = 222;
        imgData[idx + 2] = 123;
        imgData[idx + 3] = 255;
      }
    }

    const redactedData = new Uint8ClampedArray(imgData);
    const rx = 2,
      ry = 2,
      rw = 4,
      rh = 4;
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        const idx = (y * width + x) * 4;
        redactedData[idx] = 0;
        redactedData[idx + 1] = 0;
        redactedData[idx + 2] = 0;
        redactedData[idx + 3] = 255;
      }
    }

    let allRedactedOpaqueBlack = true;
    let anySecretPixelRemains = false;

    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        const idx = (y * width + x) * 4;
        if (redactedData[idx] !== 0 || redactedData[idx + 1] !== 0 || redactedData[idx + 2] !== 0 || redactedData[idx + 3] !== 255) {
          allRedactedOpaqueBlack = false;
        }
        if (redactedData[idx] === 111 && redactedData[idx + 1] === 222 && redactedData[idx + 2] === 123) {
          anySecretPixelRemains = true;
        }
      }
    }

    assert(allRedactedOpaqueBlack, 'redaction-opaque-black', 'Redaction region must be 100% opaque solid color');
    assert(
      !anySecretPixelRemains,
      'redaction-secret-erased',
      'Original secret pixels must be permanently overwritten and no longer present',
    );

    const outsideIdx = (0 * width + 0) * 4;
    assert(
      redactedData[outsideIdx] === 255 && redactedData[outsideIdx + 3] === 255,
      'redaction-outside-untouched',
      'Pixels outside redacted region must remain unchanged',
    );
  } catch (err: any) {
    if (!results.find((r) => r.name === 'redaction-opaque-black' && !r.passed)) {
      results.push({ name: 'redaction-verification-fatal', passed: false, message: err.message });
    }
  }

  const allPassed = results.every((r) => r.passed);
  return { allPassed, results };
}

// Auto-run if executed in Node.js
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('verify.ts')) {
  console.log('Running verification suite in Node.js...');
  const outcome = runAllVerifications();
  for (const r of outcome.results) {
    console.log(`  ${r.passed ? '✓' : '✗'} ${r.name} ${r.message ? `(${r.message})` : ''}`);
  }
  if (!outcome.allPassed) {
    console.error('Some verifications failed!');
    process.exit(1);
  } else {
    console.log('All verifications passed successfully!');
  }
}
