import { translate } from '../../../lib/i18n';

/**
 * ICO format parser and extractor.
 * Handles embedded PNG frames as well as standard BMP/DIB frames with AND transparency masks.
 * Bounds-checks directory and pixel offsets to prevent crashes on malformed files.
 */

export interface DecodedIcoFrame {
  index: number;
  width: number;
  height: number;
  bitCount: number;
  isPng: boolean;
  pngBytes?: Uint8Array;
  rgba?: Uint8ClampedArray;
}

export function parseIcoDirectory(buffer: ArrayBuffer): {
  count: number;
  frames: DecodedIcoFrame[];
} {
  if (buffer.byteLength < 6) {
    throw new Error(translate('Invalid ICO file: size too small ({size} bytes, minimum 6)', { size: buffer.byteLength }));
  }

  const view = new DataView(buffer);
  const reserved = view.getUint16(0, true);
  const type = view.getUint16(2, true);
  const count = view.getUint16(4, true);

  if (reserved !== 0) {
    throw new Error(translate('Invalid ICO file: reserved header word must be 0, got {reserved}', { reserved }));
  }
  if (type !== 1 && type !== 2) {
    throw new Error(translate('Invalid ICO file: expected type 1 (ICO) or 2 (CUR), got {type}', { type }));
  }
  if (count <= 0) {
    throw new Error(translate('Invalid ICO file: icon directory contains 0 images'));
  }

  const minHeaderSize = 6 + count * 16;
  if (buffer.byteLength < minHeaderSize) {
    throw new Error(
      translate(
        'Malformed ICO directory: header claims {count} frames, requiring {requiredBytes} bytes, but file is only {fileBytes} bytes',
        {
          count,
          requiredBytes: minHeaderSize,
          fileBytes: buffer.byteLength,
        },
      ),
    );
  }

  const frames: DecodedIcoFrame[] = [];

  for (let i = 0; i < count; i++) {
    const entryOffset = 6 + i * 16;
    const bWidth = view.getUint8(entryOffset) || 256;
    const bHeight = view.getUint8(entryOffset + 1) || 256;
    const bitCount = view.getUint16(entryOffset + 6, true);
    const bytesInRes = view.getUint32(entryOffset + 8, true);
    const imageOffset = view.getUint32(entryOffset + 12, true);

    // Bounds checking
    if (imageOffset < minHeaderSize || imageOffset + bytesInRes > buffer.byteLength) {
      throw new Error(
        translate('Malformed ICO frame {index} ({width}x{height}): offset {offset} + length {length} exceeds file size {fileBytes}', {
          index: i + 1,
          width: bWidth,
          height: bHeight,
          offset: imageOffset,
          length: bytesInRes,
          fileBytes: buffer.byteLength,
        }),
      );
    }
    if (bytesInRes < 8) {
      throw new Error(translate('Malformed ICO frame {index}: resource size too small ({size} bytes)', { index: i + 1, size: bytesInRes }));
    }

    const frameBytes = new Uint8Array(buffer, imageOffset, bytesInRes);

    // Check if frame is an embedded PNG
    const isPng =
      frameBytes.length >= 8 &&
      frameBytes[0] === 0x89 &&
      frameBytes[1] === 0x50 &&
      frameBytes[2] === 0x4e &&
      frameBytes[3] === 0x47 &&
      frameBytes[4] === 0x0d &&
      frameBytes[5] === 0x0a &&
      frameBytes[6] === 0x1a &&
      frameBytes[7] === 0x0a;

    if (isPng) {
      frames.push({
        index: i,
        width: bWidth,
        height: bHeight,
        bitCount: bitCount || 32,
        isPng: true,
        pngBytes: new Uint8Array(buffer.slice(imageOffset, imageOffset + bytesInRes)),
      });
      continue;
    }

    // DIB (Bitmap) frame
    const frameView = new DataView(buffer, imageOffset, bytesInRes);
    const headerSize = frameView.getUint32(0, true);
    if (headerSize < 40) {
      throw new Error(
        translate('Malformed DIB frame {index}: header size {headerSize} is less than BITMAPINFOHEADER (40)', {
          index: i + 1,
          headerSize,
        }),
      );
    }

    const dibWidth = frameView.getInt32(4, true);
    const dibHeight = frameView.getInt32(8, true);
    // In ICO DIBs, biHeight is twice the actual image height (includes XOR + AND masks)
    let actualHeight = dibHeight > 0 ? Math.floor(dibHeight / 2) : bHeight;
    let actualWidth = dibWidth > 0 ? dibWidth : bWidth;
    if (actualHeight <= 0) actualHeight = bHeight;
    if (actualWidth <= 0) actualWidth = bWidth;

    const dibBitCount = frameView.getUint16(14, true) || bitCount || 32;
    const compression = frameView.getUint32(16, true);

    if (compression !== 0 && compression !== 3) {
      throw new Error(
        translate('Unsupported DIB compression {compression} in ICO frame {index} ({width}x{height})', {
          compression,
          index: i + 1,
          width: actualWidth,
          height: actualHeight,
        }),
      );
    }

    const validBits = [1, 4, 8, 24, 32];
    if (!validBits.includes(dibBitCount)) {
      throw new Error(
        translate('Unsupported bit depth {bitCount} in ICO frame {index} ({width}x{height})', {
          bitCount: dibBitCount,
          index: i + 1,
          width: actualWidth,
          height: actualHeight,
        }),
      );
    }

    // Palette handling for indexed formats
    const paletteOffset = headerSize + (compression === 3 ? 12 : 0);
    const clrUsed = frameView.getUint32(32, true);
    const numColors = dibBitCount <= 8 ? (clrUsed > 0 ? clrUsed : 1 << dibBitCount) : 0;
    const palette: { r: number; g: number; b: number }[] = [];

    if (numColors > 0) {
      if (paletteOffset + numColors * 4 > bytesInRes) {
        throw new Error(translate('Malformed DIB frame {index}: palette truncated', { index: i + 1 }));
      }
      for (let c = 0; c < numColors; c++) {
        const pIdx = paletteOffset + c * 4;
        palette.push({
          b: frameBytes[pIdx],
          g: frameBytes[pIdx + 1],
          r: frameBytes[pIdx + 2],
        });
      }
    }

    const xorOffset = paletteOffset + numColors * 4;
    const xorRowStride = Math.floor((actualWidth * dibBitCount + 31) / 32) * 4;
    const andRowStride = Math.floor((actualWidth * 1 + 31) / 32) * 4;
    const xorDataSize = xorRowStride * actualHeight;
    const andDataSize = andRowStride * actualHeight;

    if (xorOffset + xorDataSize > bytesInRes) {
      throw new Error(
        translate('Malformed ICO frame {index}: XOR mask data truncated (needed {neededBytes}, got {actualBytes})', {
          index: i + 1,
          neededBytes: xorOffset + xorDataSize,
          actualBytes: bytesInRes,
        }),
      );
    }

    const andOffset = xorOffset + xorDataSize;
    const hasAndMask = andOffset + andDataSize <= bytesInRes;

    // Detect if 32-bit image has valid alpha in 4th byte
    let hasAlphaByte = false;
    if (dibBitCount === 32) {
      for (let y = 0; y < actualHeight && !hasAlphaByte; y++) {
        const row = xorOffset + y * xorRowStride;
        for (let x = 0; x < actualWidth; x++) {
          if (frameBytes[row + x * 4 + 3] > 0) {
            hasAlphaByte = true;
            break;
          }
        }
      }
    }

    const rgba = new Uint8ClampedArray(actualWidth * actualHeight * 4);

    // Decode bottom-up rows
    for (let targetY = 0; targetY < actualHeight; targetY++) {
      const srcY = actualHeight - 1 - targetY;
      const xorRow = xorOffset + srcY * xorRowStride;
      const andRow = hasAndMask ? andOffset + srcY * andRowStride : -1;

      for (let x = 0; x < actualWidth; x++) {
        const outIdx = (targetY * actualWidth + x) * 4;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 255;

        let isMaskedTransparent = false;
        if (andRow >= 0) {
          const maskByte = frameBytes[andRow + (x >> 3)];
          const maskBit = (maskByte >> (7 - (x & 7))) & 1;
          isMaskedTransparent = maskBit === 1;
        }

        if (dibBitCount === 32) {
          b = frameBytes[xorRow + x * 4];
          g = frameBytes[xorRow + x * 4 + 1];
          r = frameBytes[xorRow + x * 4 + 2];
          const alphaByte = frameBytes[xorRow + x * 4 + 3];
          a = hasAlphaByte ? alphaByte : isMaskedTransparent ? 0 : 255;
        } else if (dibBitCount === 24) {
          b = frameBytes[xorRow + x * 3];
          g = frameBytes[xorRow + x * 3 + 1];
          r = frameBytes[xorRow + x * 3 + 2];
          a = isMaskedTransparent ? 0 : 255;
        } else if (dibBitCount === 8) {
          const idx = frameBytes[xorRow + x];
          const col = palette[idx] || { r: 0, g: 0, b: 0 };
          r = col.r;
          g = col.g;
          b = col.b;
          a = isMaskedTransparent ? 0 : 255;
        } else if (dibBitCount === 4) {
          const byteVal = frameBytes[xorRow + (x >> 1)];
          const idx = (x & 1) === 0 ? byteVal >> 4 : byteVal & 0x0f;
          const col = palette[idx] || { r: 0, g: 0, b: 0 };
          r = col.r;
          g = col.g;
          b = col.b;
          a = isMaskedTransparent ? 0 : 255;
        } else if (dibBitCount === 1) {
          const byteVal = frameBytes[xorRow + (x >> 3)];
          const idx = (byteVal >> (7 - (x & 7))) & 1;
          const col = palette[idx] || { r: 0, g: 0, b: 0 };
          r = col.r;
          g = col.g;
          b = col.b;
          a = isMaskedTransparent ? 0 : 255;
        }

        rgba[outIdx] = r;
        rgba[outIdx + 1] = g;
        rgba[outIdx + 2] = b;
        rgba[outIdx + 3] = a;
      }
    }

    frames.push({
      index: i,
      width: actualWidth,
      height: actualHeight,
      bitCount: dibBitCount,
      isPng: false,
      rgba,
    });
  }

  return { count, frames };
}

export async function frameToPngBlob(frame: DecodedIcoFrame): Promise<Blob> {
  if (frame.isPng && frame.pngBytes) {
    const bytesCopy = new Uint8Array(frame.pngBytes.byteLength);
    bytesCopy.set(frame.pngBytes);
    return new Blob([bytesCopy], { type: 'image/png' });
  }

  if (frame.rgba) {
    if (typeof document === 'undefined') {
      throw new Error(translate('Canvas conversion requires browser DOM environment'));
    }
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(translate('Canvas 2D context unavailable'));

    const imgData = ctx.createImageData(frame.width, frame.height);
    imgData.data.set(frame.rgba);
    ctx.putImageData(imgData, 0, 0);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error(translate('Failed to encode PNG from decoded frame canvas')));
      }, 'image/png');
    });
  }

  throw new Error(translate('Frame {index} has neither PNG data nor RGBA data', { index: frame.index }));
}
