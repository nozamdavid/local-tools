import { describe, expect, it } from 'vitest';
import { readComparisonDimensions, readComparisonFileDimensions } from './dimensions';

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set(new TextEncoder().encode('IHDR'), 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe('comparison dimension preflight', () => {
  it('reads dimensions without decoding pixels and rejects oversized images', () => {
    expect(readComparisonDimensions(pngHeader(640, 480))).toEqual({ width: 640, height: 480 });
    expect(() => readComparisonDimensions(pngHeader(20_000, 20_000))).toThrow(/megapixel/);
    expect(() => readComparisonDimensions(pngHeader(0, 480))).toThrow(/dimensions/);
  });
  it('reads JPEG frame sizes after metadata segments', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 7, 8, 1, 224, 2, 128]);
    expect(readComparisonDimensions(bytes)).toEqual({ width: 640, height: 480 });
  });
  it('reads JPEG frame headers beyond one MiB of metadata without decoding pixels', async () => {
    const app = new Uint8Array(65_537);
    app.set([0xff, 0xe1, 0xff, 0xff]);
    const file = new Blob([
      new Uint8Array([0xff, 0xd8]),
      ...Array.from({ length: 17 }, () => app),
      new Uint8Array([0xff, 0xc0, 0, 7, 8, 1, 224, 2, 128]),
    ]);
    expect(file.size).toBeGreaterThan(1024 * 1024);
    await expect(readComparisonFileDimensions(file)).resolves.toEqual({ width: 640, height: 480 });
  });
  it('rejects malformed, truncated and unrecognized files before decode', () => {
    expect(() => readComparisonDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xc0]))).toThrow(/dimensions/);
    expect(() => readComparisonDimensions(new TextEncoder().encode('<svg width="100" height="100"/>'))).toThrow(/dimensions/);
  });
});
