import jxlDecWasmUrl from '@jsquash/jxl/codec/dec/jxl_dec.wasm?url';
import jxlEncWasmUrl from '@jsquash/jxl/codec/enc/jxl_enc.wasm?url';
import { isJxlSignature, isJxlFile, decodeJxlToBlob, encodeJxlCanvas } from './jxl';
import { decodeImage, imageToCanvas } from './image';
import { detectFormat } from '../tools/file-converter/detect';
import { getTargetFormats } from '../tools/file-converter/matrix';
import { init as initEncode, default as encode } from '@jsquash/jxl/encode.js';
import { init as initDecode, default as decode } from '@jsquash/jxl/decode.js';

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runAllTests(): Promise<{ passed: boolean; results: TestResult[] }> {
  console.log('--- Running JXL Verification Tests ---');
  const results: TestResult[] = [];

  async function runTest(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`  ✓ ${name}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({ name, passed: false, error: errorMsg });
      console.error(`  ✗ ${name}: ${errorMsg}`);
    }
  }

  // 1. Production WASM asset loading
  await runTest('Production WASM asset loading & compilation', async () => {
    assert(typeof jxlDecWasmUrl === 'string' && jxlDecWasmUrl.length > 0, 'Decoder WASM URL must be defined');
    assert(typeof jxlEncWasmUrl === 'string' && jxlEncWasmUrl.length > 0, 'Encoder WASM URL must be defined');

    const decRes = await fetch(jxlDecWasmUrl);
    assert(decRes.ok, `Decoder WASM fetch failed with status ${decRes.status}`);
    const decBytes = await decRes.arrayBuffer();
    assert(decBytes.byteLength > 100000, `Decoder WASM must be > 100KB, got ${decBytes.byteLength}`);
    const decModule = await WebAssembly.compile(decBytes);
    assert(decModule instanceof WebAssembly.Module, 'Decoder WASM must compile into WebAssembly.Module');

    const encRes = await fetch(jxlEncWasmUrl);
    assert(encRes.ok, `Encoder WASM fetch failed with status ${encRes.status}`);
    const encBytes = await encRes.arrayBuffer();
    assert(encBytes.byteLength > 100000, `Encoder WASM must be > 100KB, got ${encBytes.byteLength}`);
    const encModule = await WebAssembly.compile(encBytes);
    assert(encModule instanceof WebAssembly.Module, 'Encoder WASM must compile into WebAssembly.Module');

    await initDecode(decModule);
    await initEncode(encModule);
  });

  // 2. Signatures: Raw codestream magic FF 0A and 12-byte container signature
  await runTest('Signature detection: raw codestream and 12-byte container', async () => {
    // Raw codestream magic: FF 0A
    const rawCodestream = new Uint8Array([0xff, 0x0a, 0x00, 0x11, 0x22]);
    assert(isJxlSignature(rawCodestream), 'Must recognize FF 0A raw codestream signature');

    // 12-byte container signature: 00 00 00 0C 4A 58 4C 20 0D 0A 87 0A
    const containerSig = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x0c,
      0x4a,
      0x58,
      0x4c,
      0x20,
      0x0d,
      0x0a,
      0x87,
      0x0a,
      0x00,
      0x00,
      0x00,
      0x14, // followed by additional box data
    ]);
    assert(isJxlSignature(containerSig), 'Must recognize 12-byte container signature');

    // Negative tests: PNG magic, JPEG magic, empty, truncated
    const pngMagic = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert(!isJxlSignature(pngMagic), 'Must reject PNG signature');

    const jpegMagic = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    assert(!isJxlSignature(jpegMagic), 'Must reject standard JPEG signature');

    assert(!isJxlSignature(new Uint8Array([0xff])), 'Must reject 1-byte truncated header');
    assert(!isJxlSignature(new Uint8Array([])), 'Must reject empty buffer');

    // Renamed file test: Blob with .png or .jpg name containing JXL signature
    const renamedBlob = new Blob([rawCodestream], { type: 'image/png' });
    const isJxl = await isJxlFile(renamedBlob);
    assert(isJxl, 'Content-based check must identify JXL even if renamed with .png MIME');
  });

  // 3. Lossless encode and decode: dimensions, alpha transparency, exact pixels
  await runTest('Lossless encode & decode: exact dimensions, transparency & pixels', async () => {
    const width = 2;
    const height = 2;
    // 2x2 RGBA fixture with varying colors and alpha transparency
    const originalPixels = [
      255,
      0,
      0,
      255, // Red opaque
      0,
      255,
      0,
      255, // Green opaque
      0,
      0,
      255,
      255, // Blue opaque
      255,
      255,
      0,
      128, // Yellow semi-transparent (alpha = 128)
    ];
    const data = new Uint8ClampedArray(originalPixels);
    const imgData = new ImageData(data, width, height);

    const encodedBuffer = await encode(imgData, { lossless: true, quality: 100 });
    assert(encodedBuffer.byteLength > 0, 'Encoded JXL buffer must be non-empty');

    const u8 = new Uint8Array(encodedBuffer);
    assert(isJxlSignature(u8), 'Lossless output must have a valid JXL signature');

    const decoded = await decode(encodedBuffer);
    assert(decoded.width === width, `Decoded width must be ${width}, got ${decoded.width}`);
    assert(decoded.height === height, `Decoded height must be ${height}, got ${decoded.height}`);
    assert(decoded.data.length === 16, `Decoded data length must be 16, got ${decoded.data.length}`);

    // Verify all 16 RGBA bytes match exactly in lossless mode
    for (let i = 0; i < originalPixels.length; i++) {
      assert(
        decoded.data[i] === originalPixels[i],
        `Pixel byte ${i} mismatch in lossless mode: expected ${originalPixels[i]}, got ${decoded.data[i]}`,
      );
    }
  });

  // 4. Lossy encode and decode: dimensions check
  await runTest('Lossy encode & decode: dimensions preserved', async () => {
    const width = 4;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i * 17) % 256;
      data[i + 1] = (i * 31) % 256;
      data[i + 2] = (i * 47) % 256;
      data[i + 3] = 255;
    }
    const imgData = new ImageData(data, width, height);

    const encodedBuffer = await encode(imgData, { lossless: false, quality: 75 });
    assert(encodedBuffer.byteLength > 0, 'Lossy encoded buffer must be non-empty');

    const decoded = await decode(encodedBuffer);
    assert(decoded.width === width, `Lossy decoded width must be ${width}, got ${decoded.width}`);
    assert(decoded.height === height, `Lossy decoded height must be ${height}, got ${decoded.height}`);
  });

  // 5. Container format decoding
  await runTest('Decode 12-byte container signature JXL format', async () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255]);
    const rawCodestream = new Uint8Array(await encode(new ImageData(data, 1, 1), { lossless: true }));

    // Synthesize 12-byte container header + ftyp box + jxlc box wrapping the raw codestream
    const sigBox = [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a];
    const ftypBox = [
      0x00,
      0x00,
      0x00,
      0x14, // length: 20
      0x66,
      0x74,
      0x79,
      0x70, // 'ftyp'
      0x6a,
      0x78,
      0x6c,
      0x20, // 'jxl '
      0x00,
      0x00,
      0x00,
      0x00,
      0x6a,
      0x78,
      0x6c,
      0x20,
    ];
    const jxlcBoxLen = rawCodestream.length + 8;
    const jxlcHeader = [
      (jxlcBoxLen >> 24) & 0xff,
      (jxlcBoxLen >> 16) & 0xff,
      (jxlcBoxLen >> 8) & 0xff,
      jxlcBoxLen & 0xff,
      0x6a,
      0x78,
      0x6c,
      0x63, // 'jxlc'
    ];

    const container = new Uint8Array(sigBox.length + ftypBox.length + jxlcHeader.length + rawCodestream.length);
    container.set(sigBox, 0);
    container.set(ftypBox, sigBox.length);
    container.set(jxlcHeader, sigBox.length + ftypBox.length);
    container.set(rawCodestream, sigBox.length + ftypBox.length + jxlcHeader.length);

    assert(isJxlSignature(container), 'Container byte array must match JXL signature');

    const decoded = await decode(container.buffer);
    assert(decoded.width === 1 && decoded.height === 1, 'Container format must decode to 1x1 image');
    assert(decoded.data[0] === 10 && decoded.data[1] === 20 && decoded.data[2] === 30, 'Container pixels match');
  });

  // 6. Malformed input error handling
  await runTest('Malformed input error handling', async () => {
    // Corrupt stream
    const corruptBuffer = new Uint8Array([0xff, 0x0a, 0x00, 0x01, 0x02, 0x03]).buffer;
    let failed = false;
    try {
      await decode(corruptBuffer);
    } catch {
      failed = true;
    }
    assert(failed, 'Decoding corrupt codestream must fail cleanly');
  });

  // 7. Worker pipeline: canvas encode, decodeToBlob, and decodeImage
  await runTest('Worker pipeline: encodeJxlCanvas, decodeJxlToBlob, and decodeImage', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 2, 2);

    // Encode canvas to JXL Blob
    const jxlBlob = await encodeJxlCanvas(canvas, { quality: 100, lossless: true });
    assert(jxlBlob.type === 'image/jxl', `Blob MIME must be 'image/jxl', got '${jxlBlob.type}'`);
    assert(jxlBlob.size > 0, 'JXL Blob must be non-empty');

    const isJxl = await isJxlFile(jxlBlob);
    assert(isJxl, 'Generated blob must pass isJxlFile signature check');

    // Decode JXL blob to browser-displayable PNG Blob
    const pngBlob = await decodeJxlToBlob(await jxlBlob.arrayBuffer());
    assert(pngBlob.type === 'image/png', `Decoded blob must be 'image/png', got '${pngBlob.type}'`);
    assert(pngBlob.size > 0, 'PNG blob must be non-empty');

    // Decode through decodeImage
    const jxlFile = new File([jxlBlob], 'test-image.jxl', { type: 'image/jxl' });
    const imgElement = await decodeImage(jxlFile);
    assert(imgElement instanceof HTMLImageElement, 'decodeImage must return an HTMLImageElement');
    assert(imgElement.naturalWidth === 2, `naturalWidth must be 2, got ${imgElement.naturalWidth}`);
    assert(imgElement.naturalHeight === 2, `naturalHeight must be 2, got ${imgElement.naturalHeight}`);

    // Verify canvas draw from returned HTMLImageElement
    const testCanvas = imageToCanvas(imgElement);
    assert(testCanvas.width === 2 && testCanvas.height === 2, 'imageToCanvas must create matching canvas');
  });

  // 8. Universal converter & bulk convert integration
  await runTest('Universal converter: detection, mismatch flag, and selectable targets', async () => {
    // Fake file with JXL content and .jxl extension
    const jxlContent = new Uint8Array([0xff, 0x0a, 0x11, 0x22]);
    const jxlFile = new File([jxlContent], 'photo.jxl', { type: 'image/jxl' });
    const detected = await detectFormat(jxlFile);

    assert(detected.id === 'jxl', `Detected ID must be 'jxl', got '${detected.id}'`);
    assert(detected.family === 'image', `Family must be 'image', got '${detected.family}'`);
    assert(detected.mime === 'image/jxl', `MIME must be 'image/jxl', got '${detected.mime}'`);
    assert(detected.extensionMismatch === false, 'Extension matches, mismatch must be false');

    // Renamed file test: photo.jpg with JXL content
    const renamedFile = new File([jxlContent], 'photo.jpg', { type: 'image/jpeg' });
    const detectedRenamed = await detectFormat(renamedFile);
    assert(detectedRenamed.id === 'jxl', 'Must detect JXL from content despite .jpg extension');
    assert(detectedRenamed.extensionMismatch === true, 'extensionMismatch must be true for photo.jpg with JXL bytes');
    assert(detectedRenamed.actualExtension === 'jpg', 'actualExtension must be jpg');

    // Valid PNG file from canvas
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const realPngBlob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const pngFake = new File([realPngBlob], 'test.png', { type: 'image/png' });
    const detectedPng = await detectFormat(pngFake);
    assert(detectedPng.id === 'png', `Expected PNG detection, got ${detectedPng.id}`);
    const pngTargets = await getTargetFormats(detectedPng, pngFake);
    const hasJxlTarget = pngTargets.image.some((t) => t.id === 'jxl');
    assert(hasJxlTarget, 'PNG input must offer JXL as a selectable output format');

    // Check target formats when input is JXL
    const jxlTargets = await getTargetFormats(detected, jxlFile);
    const hasPngTarget = jxlTargets.image.some((t) => t.id === 'png');
    const hasJpgTarget = jxlTargets.image.some((t) => t.id === 'jpg');
    assert(hasPngTarget, 'JXL input must offer PNG target');
    assert(hasJpgTarget, 'JXL input must offer JPG target');
  });

  const allPassed = results.every((r) => r.passed);
  console.log(`\nVerification complete: ${results.filter((r) => r.passed).length}/${results.length} passed.`);
  return { passed: allPassed, results };
}
