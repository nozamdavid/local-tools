import avifEncWasmUrl from '@jsquash/avif/codec/enc/avif_enc.wasm?url';
import { isAvifSignature, isAvifFile, encodeAvif, encodeAvifCanvas } from './avif';
import { canvasToBlob, decodeImage, imageToCanvas, loadImage } from './image';
import { checkAvifSupport, convertSingleImage } from '../tools/image/_convert/convert';
import { detectFormat } from '../tools/file-converter/detect';
import { getTargetFormats } from '../tools/file-converter/matrix';
import { init as initEncode } from '@jsquash/avif/encode.js';

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runAllTests(): Promise<{ passed: boolean; results: TestResult[] }> {
  console.log('--- Running AVIF Verification Tests ---');
  const results: TestResult[] = [];

  async function runTest(
    name: string,
    fn: () => Promise<string | void> | string | void
  ) {
    try {
      const details = await fn();
      results.push({ name, passed: true, details: details || undefined });
      console.log(`  ✓ ${name}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({ name, passed: false, error: errorMsg });
      console.error(`  ✗ ${name}: ${errorMsg}`);
    }
  }

  // 1. Production WASM asset loading & compilation
  await runTest('Production WASM asset loading & compilation', async () => {
    assert(
      typeof avifEncWasmUrl === 'string' && avifEncWasmUrl.length > 0,
      'AVIF encoder WASM URL must be defined'
    );

    const encRes = await fetch(avifEncWasmUrl);
    assert(encRes.ok, `Encoder WASM fetch failed with status ${encRes.status}`);
    const encBytes = await encRes.arrayBuffer();
    assert(
      encBytes.byteLength > 100000,
      `Encoder WASM must be > 100KB, got ${encBytes.byteLength}`
    );

    const encModule = await WebAssembly.compile(encBytes);
    assert(
      encModule instanceof WebAssembly.Module,
      'Encoder WASM must compile into WebAssembly.Module'
    );

    await initEncode(encModule);
    return `WASM binary loaded and compiled successfully (${(encBytes.byteLength / 1024 / 1024).toFixed(2)} MB)`;
  });

  // 2. Signatures: ISOBMFF ftyp container with avif/avis brands
  await runTest('Signature detection: ISOBMFF ftyp box and avif brand', async () => {
    // Standard AVIF header: length 0x1c (28), 'ftyp', major brand 'avif', minor 0, compatible 'avif', 'mif1'
    const standardAvifHeader = new Uint8Array([
      0x00, 0x00, 0x00, 0x1c, // box length: 28
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x61, 0x76, 0x69, 0x66, // 'avif'
      0x00, 0x00, 0x00, 0x00, // minor_version: 0
      0x61, 0x76, 0x69, 0x66, // compatible brand 1: 'avif'
      0x6d, 0x69, 0x66, 0x31, // compatible brand 2: 'mif1'
      0x6d, 0x69, 0x61, 0x66, // compatible brand 3: 'miaf'
    ]);
    assert(isAvifSignature(standardAvifHeader), 'Must recognize standard ftypavif signature');

    // AV1 Image Sequence brand 'avis'
    const avisHeader = new Uint8Array([
      0x00, 0x00, 0x00, 0x1c,
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x61, 0x76, 0x69, 0x73, // 'avis'
      0x00, 0x00, 0x00, 0x00,
      0x61, 0x76, 0x69, 0x73,
      0x6d, 0x69, 0x66, 0x31,
      0x6d, 0x69, 0x61, 0x66,
    ]);
    assert(isAvifSignature(avisHeader), 'Must recognize avis signature');

    // Negative tests
    const pngMagic = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert(!isAvifSignature(pngMagic), 'Must reject PNG magic bytes');

    const jpegMagic = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    assert(!isAvifSignature(jpegMagic), 'Must reject JPEG magic bytes');

    const jxlMagic = new Uint8Array([0xff, 0x0a, 0x00, 0x11]);
    assert(!isAvifSignature(jxlMagic), 'Must reject JXL magic bytes');

    assert(!isAvifSignature(new Uint8Array([0x00, 0x00, 0x00])), 'Must reject truncated < 12 byte buffer');
    assert(!isAvifSignature(new Uint8Array([])), 'Must reject empty buffer');

    // Renamed file test: Blob with image/png MIME but AVIF header
    const renamedBlob = new Blob([standardAvifHeader], { type: 'image/png' });
    const isAvif = await isAvifFile(renamedBlob);
    assert(isAvif, 'Content-based check must identify AVIF even if renamed with .png MIME');
  });

  // 3. Actual WASM encode: RGBA 2x2 fixture with varying colors and alpha transparency
  await runTest('WASM encode & decode: 2x2 RGBA fixture, dimensions and alpha transparency', async () => {
    const width = 2;
    const height = 2;
    // 2x2 RGBA fixture with varying colors and alpha transparency
    const originalPixels = [
      255, 0, 0, 255,      // Pixel 0: Red opaque
      0, 255, 0, 255,      // Pixel 1: Green opaque
      0, 0, 255, 255,      // Pixel 2: Blue opaque
      255, 255, 0, 128,    // Pixel 3: Yellow semi-transparent (alpha = 128)
    ];
    const data = new Uint8ClampedArray(originalPixels);

    const encodedBuffer = await encodeAvif(width, height, data, { quality: 80 });
    assert(encodedBuffer.byteLength > 0, 'Encoded AVIF buffer must be non-empty');

    const u8 = new Uint8Array(encodedBuffer);
    assert(isAvifSignature(u8), 'Encoded buffer must have valid AVIF signature');

    // Check ftyp box in output
    const ftypStr = String.fromCharCode(...u8.slice(4, 8));
    assert(ftypStr === 'ftyp', `Expected 'ftyp' at bytes 4..8, got '${ftypStr}'`);

    const blob = new Blob([encodedBuffer], { type: 'image/avif' });

    // Decode with native browser engine (loadImage or createImageBitmap)
    let decodedWidth = 0;
    let decodedHeight = 0;
    let semiAlpha = 0;

    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(blob);
      decodedWidth = bmp.width;
      decodedHeight = bmp.height;

      const canvas = document.createElement('canvas');
      canvas.width = decodedWidth;
      canvas.height = decodedHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const imgData = ctx.getImageData(0, 0, decodedWidth, decodedHeight);
      semiAlpha = imgData.data[15]; // Alpha channel of pixel 3 (yellow semi-transparent)
      bmp.close();
    } else {
      const img = await loadImage(blob);
      decodedWidth = img.naturalWidth || img.width;
      decodedHeight = img.naturalHeight || img.height;

      const canvas = imageToCanvas(img);
      const ctx = canvas.getContext('2d')!;
      const imgData = ctx.getImageData(0, 0, decodedWidth, decodedHeight);
      semiAlpha = imgData.data[15];
    }

    assert(decodedWidth === width, `Decoded width must be ${width}, got ${decodedWidth}`);
    assert(decodedHeight === height, `Decoded height must be ${height}, got ${decodedHeight}`);
    assert(
      semiAlpha > 60 && semiAlpha < 190,
      `Pixel 3 alpha must be preserved around 128 under compression, got ${semiAlpha}`
    );

    return `WASM encoded 2x2 AVIF (${encodedBuffer.byteLength} bytes); decoded dimensions ${decodedWidth}x${decodedHeight}, alpha preserved (${semiAlpha}). Native decode used; decode limits: browser native image engine.`;
  });

  // 4. Force/mock unavailable native toBlob branch to verify fallback path
  await runTest('Forced unavailable native toBlob: fallback to WASM worker executes correctly', async () => {
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    let mockedFallbackTriggered = false;

    try {
      // Mock toBlob to simulate browsers lacking native AVIF encoding support
      HTMLCanvasElement.prototype.toBlob = function (
        callback: BlobCallback,
        type?: string,
        _quality?: any
      ) {
        if (type === 'image/avif') {
          mockedFallbackTriggered = true;
          // Return null or wrong type (as Safari/Firefox do for unsupported MIME)
          callback(null);
          return;
        }
        originalToBlob.apply(this, arguments as any);
      };

      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#00ff88';
      ctx.fillRect(0, 0, 2, 2);

      // canvasToBlob should catch the failed native toBlob and fall back to encodeAvifCanvas
      const avifBlob = await canvasToBlob(canvas, 'image/avif', 0.85);

      assert(mockedFallbackTriggered, 'Mocked native toBlob must have been called');
      assert(
        avifBlob.type === 'image/avif',
        `Fallback must produce 'image/avif' MIME, got '${avifBlob.type}'`
      );
      assert(avifBlob.size > 0, 'Fallback AVIF Blob must have size > 0');

      const isAvif = await isAvifFile(avifBlob);
      assert(isAvif, 'Fallback Blob must pass isAvifFile signature verification');

      // Verify dimensions of emitted fallback
      const img = await decodeImage(new File([avifBlob], 'fallback.avif', { type: 'image/avif' }));
      assert(
        img.naturalWidth === 2 && img.naturalHeight === 2,
        `Fallback decoded dimensions must be 2x2, got ${img.naturalWidth}x${img.naturalHeight}`
      );

      return `Mocked native failure successfully triggered WASM fallback; emitted ${avifBlob.size} bytes valid AVIF`;
    } finally {
      // Restore native prototype
      HTMLCanvasElement.prototype.toBlob = originalToBlob;
    }
  });

  // 5. Worker pipeline: encodeAvifCanvas, decodeImage, and imageToCanvas
  await runTest('Worker pipeline: encodeAvifCanvas, decodeImage, and imageToCanvas', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 4, 4);

    const avifBlob = await encodeAvifCanvas(canvas, { quality: 90, speed: 6 });
    assert(avifBlob.type === 'image/avif', `Blob type must be 'image/avif', got '${avifBlob.type}'`);
    assert(avifBlob.size > 0, 'AVIF blob must be non-empty');

    const isAvif = await isAvifFile(avifBlob);
    assert(isAvif, 'Canvas-encoded blob must pass isAvifFile check');

    // Decode through decodeImage
    const avifFile = new File([avifBlob], 'rendered.avif', { type: 'image/avif' });
    const imgElement = await decodeImage(avifFile);
    assert(imgElement instanceof HTMLImageElement, 'decodeImage must return an HTMLImageElement');
    assert(imgElement.naturalWidth === 4, `naturalWidth must be 4, got ${imgElement.naturalWidth}`);
    assert(imgElement.naturalHeight === 4, `naturalHeight must be 4, got ${imgElement.naturalHeight}`);

    const roundtripCanvas = imageToCanvas(imgElement);
    assert(
      roundtripCanvas.width === 4 && roundtripCanvas.height === 4,
      'imageToCanvas must create matching canvas'
    );
  });

  // 6. Universal converter & single/bulk format matrix integration
  await runTest('Universal converter: detection, selectable target formats, and convertSingleImage', async () => {
    // 1. Synthetic AVIF file
    const sampleAvifHeader = new Uint8Array([
      0x00, 0x00, 0x00, 0x1c,
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x61, 0x76, 0x69, 0x66, // 'avif'
      0x00, 0x00, 0x00, 0x00,
      0x61, 0x76, 0x69, 0x66,
      0x6d, 0x69, 0x66, 0x31,
      0x6d, 0x69, 0x61, 0x66,
    ]);
    const avifFile = new File([sampleAvifHeader], 'scenery.avif', { type: 'image/avif' });
    const detected = await detectFormat(avifFile);

    assert(detected.id === 'avif', `Detected ID must be 'avif', got '${detected.id}'`);
    assert(detected.family === 'image', `Family must be 'image', got '${detected.family}'`);
    assert(detected.mime === 'image/avif', `MIME must be 'image/avif', got '${detected.mime}'`);
    assert(!detected.extensionMismatch, 'Extension matches, extensionMismatch must be false');

    // 2. Renamed file test: scenery.png containing AVIF header
    const renamedFile = new File([sampleAvifHeader], 'scenery.png', { type: 'image/png' });
    const detectedRenamed = await detectFormat(renamedFile);
    assert(detectedRenamed.id === 'avif', 'Must detect AVIF from magic bytes despite .png extension');
    assert(detectedRenamed.extensionMismatch === true, 'extensionMismatch must be true for misnamed AVIF');
    assert(detectedRenamed.actualExtension === 'png', 'actualExtension must be png');

    // 3. Check AVIF support flag (must include WASM path and return true without eager download)
    const isAvifAvailable = await checkAvifSupport();
    assert(isAvifAvailable, 'checkAvifSupport must return true via native or WASM fallback');

    // 4. Input PNG must offer AVIF in target formats (WebUtilityHub source requirement)
    const dummyPngCanvas = document.createElement('canvas');
    dummyPngCanvas.width = 1;
    dummyPngCanvas.height = 1;
    const realPngBlob = await new Promise<Blob>((res) =>
      dummyPngCanvas.toBlob((b) => res(b!), 'image/png')
    );
    const pngFile = new File([realPngBlob], 'input.png', { type: 'image/png' });
    const detectedPng = await detectFormat(pngFile);
    assert(detectedPng.id === 'png', 'Detected format must be png');

    const pngTargets = await getTargetFormats(detectedPng, pngFile);
    const hasAvifTarget = pngTargets.image.some((t) => t.id === 'avif');
    assert(
      hasAvifTarget,
      'PNG input must offer AVIF as a selectable output format in Universal File Converter'
    );

    // 5. Input AVIF must offer standard image targets (PNG, JPG, WEBP)
    const avifTargets = await getTargetFormats(detected, avifFile);
    assert(avifTargets.image.some((t) => t.id === 'png'), 'AVIF input must offer PNG target');
    assert(avifTargets.image.some((t) => t.id === 'jpg'), 'AVIF input must offer JPG target');
    assert(avifTargets.image.some((t) => t.id === 'webp'), 'AVIF input must offer WEBP target');

    // 6. Test convertSingleImage with format: 'avif'
    const convertedAvifBlob = await convertSingleImage({
      file: pngFile,
      format: 'avif',
      quality: 80,
      bgColor: '#ffffff',
    });
    assert(
      convertedAvifBlob.type === 'image/avif',
      `convertSingleImage must return 'image/avif', got '${convertedAvifBlob.type}'`
    );
    assert(
      await isAvifFile(convertedAvifBlob),
      'convertSingleImage output must pass isAvifFile signature verification'
    );

    return 'AVIF detection, renamed mismatch, target format matrix, and convertSingleImage verified';
  });

  const allPassed = results.every((r) => r.passed);
  console.log(
    `\nAVIF Verification complete: ${results.filter((r) => r.passed).length}/${results.length} passed.`
  );
  return { passed: allPassed, results };
}
