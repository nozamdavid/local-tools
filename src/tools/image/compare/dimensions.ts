import { translate } from '../../../lib/i18n';

type LocalizedError = Error & { sourceEnglish: string; params?: Record<string, string | number> };

function localizedError(sourceEnglish: string, params?: Record<string, string | number>): LocalizedError {
  const error = new Error(translate(sourceEnglish, params)) as LocalizedError;
  error.sourceEnglish = sourceEnglish;
  error.params = params;
  return error;
}

/** JPEG frame headers can follow many metadata segments; scan the bounded input. */
export async function readComparisonFileDimensions(file: Blob): Promise<{ width: number; height: number }> {
  if (file.size > 100 * 1024 * 1024) throw localizedError('Image exceeds the 100 MB input limit.');
  const prefix = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const isJpeg = prefix[0] === 0xff && prefix[1] === 0xd8;
  const bytes = new Uint8Array(await file.slice(0, isJpeg ? file.size : 1024 * 1024).arrayBuffer());
  return readComparisonDimensions(bytes);
}

/** Read raster dimensions before allocating decoded pixel buffers. */
export function readComparisonDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u24 = (offset: number) => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
  let width = 0;
  let height = 0;
  if (bytes.length >= 24 && bytes[0] === 137 && text(1, 7) === 'PNG\r\n\x1a\n' && text(12, 4) === 'IHDR') {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes.length >= 10 && /^GIF8[79]a$/.test(text(0, 6))) {
    width = u16(6);
    height = u16(8);
  } else if (bytes.length >= 26 && text(0, 2) === 'BM') {
    const headerSize = view.getUint32(14, true);
    if (headerSize === 12) {
      width = u16(18);
      height = u16(20);
    } else if (headerSize >= 40 && bytes.length >= 54) {
      width = view.getInt32(18, true);
      height = Math.abs(view.getInt32(22, true));
    }
  } else if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const type = text(12, 4);
    if (type === 'VP8X') {
      width = 1 + u24(24);
      height = 1 + u24(27);
    } else if (type === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >>> 14) & 0x3fff);
    } else if (type === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = u16(26) & 0x3fff;
      height = u16(28) & 0x3fff;
    }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (frameMarkers.has(marker) && length >= 7) {
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (width <= 0 || height <= 0) {
    throw localizedError('Could not read image dimensions. Choose a PNG, JPG, WebP, GIF or BMP image.');
  }
  if (width > 32_768 || height > 32_768 || width * height > 40_000_000) {
    throw localizedError('Image exceeds the 40 megapixel or 32,768 pixel edge limit.');
  }
  return { width, height };
}
