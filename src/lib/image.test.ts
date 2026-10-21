import { describe, it, expect, vi } from 'vitest';

vi.mock('./ffmpeg', () => ({
  runFFmpeg: vi.fn(),
  getFFmpeg: vi.fn(),
  mimeFromName: vi.fn(),
}));

vi.mock('./jxl', () => ({
  isJxlFile: vi.fn(),
  decodeJxlToBlob: vi.fn(),
  decodeJxl: vi.fn(),
  decodeJxlToCanvas: vi.fn(),
  encodeJxl: vi.fn(),
  encodeJxlCanvas: vi.fn(),
}));

import { encodeBmp } from './image';

describe('encodeBmp', () => {
  it('encodes a 2x2 RGBA canvas to a valid 24-bit BMP with bottom-up order and alpha flattened onto white', async () => {
    // 2x2 image:
    // (0,0) = Red [255, 0, 0, 255]
    // (1,0) = Green [0, 255, 0, 255]
    // (0,1) = Blue [0, 0, 255, 255]
    // (1,1) = Transparent black [0, 0, 0, 0]
    const rgbaData = new Uint8ClampedArray([
      255,
      0,
      0,
      255, // (0,0) Top-left: Red
      0,
      255,
      0,
      255, // (1,0) Top-right: Green
      0,
      0,
      255,
      255, // (0,1) Bottom-left: Blue
      0,
      0,
      0,
      0, // (1,1) Bottom-right: Transparent
    ]);

    const stubCanvas = {
      width: 2,
      height: 2,
      getContext: (type: string) => {
        if (type === '2d') {
          return {
            getImageData: () => ({
              data: rgbaData,
            }),
          };
        }
        return null;
      },
    } as unknown as HTMLCanvasElement;

    const bmpBlob = encodeBmp(stubCanvas);
    const arrayBuffer = await bmpBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);

    // 1. Assert "BM" signature
    const signature = String.fromCharCode(bytes[0], bytes[1]);
    expect(signature).toBe('BM');
    expect(view.getUint16(0, true)).toBe(0x4d42);

    // 2. Assert declared file size equals byteLength
    const declaredFileSize = view.getUint32(2, true);
    expect(declaredFileSize).toBe(arrayBuffer.byteLength);
    expect(bmpBlob.size).toBe(arrayBuffer.byteLength);

    // 3. Assert 24-bit / 1-plane header
    const planes = view.getUint16(26, true);
    const bitsPerPixel = view.getUint16(28, true);
    expect(planes).toBe(1);
    expect(bitsPerPixel).toBe(24);

    // 4. Assert positive height
    const headerWidth = view.getInt32(18, true);
    const headerHeight = view.getInt32(22, true);
    expect(headerWidth).toBe(2);
    expect(headerHeight).toBe(2);
    expect(headerHeight).toBeGreaterThan(0);

    // 5. Assert bottom-up row order:
    // With 2x2: rowSize = Math.ceil(2 * 3 / 4) * 4 = 8 bytes.
    // Offset 54 contains row y=1 (bottom row: Blue at x=0, Transparent at x=1).
    // Offset 62 contains row y=0 (top row: Red at x=0, Green at x=1).

    // Bottom row (y = 1) at offset 54:
    // Pixel (0, 1) is Blue: BGR -> B=255, G=0, R=0
    expect(bytes[54]).toBe(255); // B
    expect(bytes[55]).toBe(0); // G
    expect(bytes[56]).toBe(0); // R

    // 6. Assert alpha flattened onto white:
    // Pixel (1, 1) had alpha=0, so flattened onto white gives (255, 255, 255)
    expect(bytes[57]).toBe(255); // B
    expect(bytes[58]).toBe(255); // G
    expect(bytes[59]).toBe(255); // R

    // Top row (y = 0) at offset 62:
    // Pixel (0, 0) is Red: BGR -> B=0, G=0, R=255
    expect(bytes[62]).toBe(0); // B
    expect(bytes[63]).toBe(0); // G
    expect(bytes[64]).toBe(255); // R

    // Pixel (1, 0) is Green: BGR -> B=0, G=255, R=0
    expect(bytes[65]).toBe(0); // B
    expect(bytes[66]).toBe(255); // G
    expect(bytes[67]).toBe(0); // R
  });
});
