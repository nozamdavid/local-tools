import exifr from 'exifr';
import { decodeImage, imageToCanvas, canvasToBlob, type EncodableMime } from '../../../lib/image';
import { translate } from '../../../lib/i18n';
import { replaceExt } from '../../../lib/format';

export interface StripResult {
  filename: string;
  blob: Blob;
  originalSize: number;
  removed: string[];
  lossless: boolean;
}

export function stripJpeg(buf: Uint8Array, keepIcc: boolean = true): { data: Uint8Array; removed: string[] } {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error(translate('Not a valid JPEG image.'));
  }

  const pieces: Uint8Array[] = [buf.subarray(0, 2)]; // SOI
  let offset = 2;
  const removed: string[] = [];

  while (offset < buf.length) {
    if (buf[offset] !== 0xff) {
      break;
    }
    while (offset < buf.length && buf[offset] === 0xff) offset++; // skip pad 0xff
    if (offset >= buf.length) break;

    const marker = buf[offset++];
    if (marker === 0xda) {
      // SOS (Start of Scan): image entropy data begins, marker + length + scan data to end of file
      pieces.push(buf.subarray(offset - 2));
      break;
    }
    if (marker === 0xd9) {
      // EOI
      pieces.push(buf.subarray(offset - 2));
      break;
    }
    // Standalone markers with no length
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x00 || marker === 0x01) {
      pieces.push(buf.subarray(offset - 2, offset));
      continue;
    }

    if (offset + 2 > buf.length) throw new Error(translate('Not a valid JPEG image.'));
    const len = (buf[offset] << 8) | buf[offset + 1];
    const markerStart = offset - 2;
    const markerEnd = offset + len;
    if (len < 2 || markerEnd > buf.length) throw new Error(translate('Not a valid JPEG image.'));

    let drop = false;
    if (marker === 0xe1) {
      drop = true;
      if (!removed.includes('EXIF/XMP (APP1)')) removed.push('EXIF/XMP (APP1)');
    } else if (marker === 0xed) {
      drop = true;
      if (!removed.includes('Photoshop/IPTC (APP13)')) removed.push('Photoshop/IPTC (APP13)');
    } else if (marker === 0xfe) {
      drop = true;
      if (!removed.includes('Comment (COM)')) removed.push('Comment (COM)');
    } else if (marker === 0xe2 && !keepIcc) {
      drop = true;
      if (!removed.includes('ICC Profile (APP2)')) removed.push('ICC Profile (APP2)');
    }

    if (!drop) {
      pieces.push(buf.subarray(markerStart, markerEnd));
    }
    offset = markerEnd;
  }

  const totalLen = pieces.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of pieces) {
    out.set(p, pos);
    pos += p.length;
  }

  return { data: out, removed };
}

export function stripPng(buf: Uint8Array): { data: Uint8Array; removed: string[] } {
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== pngSig[i]) throw new Error(translate('Not a valid PNG image.'));
  }

  const pieces: Uint8Array[] = [buf.subarray(0, 8)];
  let offset = 8;
  const removed: string[] = [];
  const textDecoder = new TextDecoder();
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dropTypes = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf']);

  while (true) {
    if (offset + 12 > buf.length) throw new Error(translate('Not a valid PNG image.'));
    const len = view.getUint32(offset);
    const type = textDecoder.decode(buf.subarray(offset + 4, offset + 8));
    const totalChunkLen = 12 + len;
    if (offset + totalChunkLen > buf.length) throw new Error(translate('Not a valid PNG image.'));

    if (dropTypes.has(type)) {
      const label = `${type} chunk`;
      if (!removed.includes(label)) removed.push(label);
    } else {
      pieces.push(buf.subarray(offset, offset + totalChunkLen));
    }

    offset += totalChunkLen;
    if (type === 'IEND') break;
  }

  const totalLen = pieces.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of pieces) {
    out.set(p, pos);
    pos += p.length;
  }

  return { data: out, removed };
}

export function stripWebp(buf: Uint8Array): { data: Uint8Array; removed: string[] } {
  const textDecoder = new TextDecoder();
  if (textDecoder.decode(buf.subarray(0, 4)) !== 'RIFF' || textDecoder.decode(buf.subarray(8, 12)) !== 'WEBP') {
    throw new Error(translate('Not a valid WEBP image.'));
  }

  const chunks: Uint8Array[] = [];
  let offset = 12;
  const removed: string[] = [];
  let vp8xChunk: Uint8Array | null = null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = view.getUint32(4, true) + 8;
  if (end < 12 || end > buf.length) throw new Error(translate('Not a valid WEBP image.'));

  while (offset < end) {
    if (offset + 8 > end) throw new Error(translate('Not a valid WEBP image.'));
    const fourCC = textDecoder.decode(buf.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const paddedSize = size + (size % 2);
    if (offset + 8 + paddedSize > end) throw new Error(translate('Not a valid WEBP image.'));
    const chunkBytes = buf.subarray(offset, offset + 8 + paddedSize);

    if (fourCC === 'EXIF') {
      if (!removed.includes('EXIF metadata')) removed.push('EXIF metadata');
    } else if (fourCC === 'XMP ') {
      if (!removed.includes('XMP metadata')) removed.push('XMP metadata');
    } else {
      const copy = new Uint8Array(chunkBytes);
      if (fourCC === 'VP8X') {
        vp8xChunk = copy;
      }
      chunks.push(copy);
    }
    offset += 8 + paddedSize;
  }

  if (vp8xChunk && removed.length > 0) {
    // byte 8 is start of payload, flags is at index 8
    let flags = vp8xChunk[8];
    if (removed.includes('EXIF metadata')) flags &= ~0x08;
    if (removed.includes('XMP metadata')) flags &= ~0x04;
    vp8xChunk[8] = flags;
  }

  const chunksLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const total = 12 + chunksLen;
  const out = new Uint8Array(total);
  out.set(buf.subarray(0, 4), 0); // RIFF
  const riffSize = total - 8;
  out[4] = riffSize & 0xff;
  out[5] = (riffSize >> 8) & 0xff;
  out[6] = (riffSize >> 16) & 0xff;
  out[7] = (riffSize >> 24) & 0xff;
  out.set(buf.subarray(8, 12), 8); // WEBP
  let pos = 12;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }

  return { data: out, removed };
}

export async function stripFileMetadata(file: File, options: { applyOrientation: boolean; keepIcc: boolean }): Promise<StripResult> {
  const mime = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  // Check if orientation needs to be applied
  if (options.applyOrientation) {
    const orientation = await exifr.orientation(file).catch(() => undefined);
    if (orientation && orientation > 1) {
      // The browser applies the orientation while decoding.
      const img = await decodeImage(file);
      const canvas = imageToCanvas(img);
      let outMime: EncodableMime = 'image/png';
      if (mime === 'image/jpeg' || /\.jpe?g$/.test(name)) outMime = 'image/jpeg';
      else if (mime === 'image/webp' || name.endsWith('.webp')) outMime = 'image/webp';

      const blob = await canvasToBlob(canvas, outMime, 0.95);
      const ext = outMime === 'image/jpeg' ? 'jpg' : outMime.slice('image/'.length);
      return {
        filename: name.endsWith(`.${ext}`) || (ext === 'jpg' && name.endsWith('.jpeg')) ? file.name : replaceExt(file.name, ext),
        blob,
        originalSize: file.size,
        removed: ['Applied orientation rotation', 'All metadata removed'],
        lossless: false,
      };
    }
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // JPEG
  if (mime === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg')) {
    const { data, removed } = stripJpeg(bytes, options.keepIcc);
    const blob = new Blob([data as unknown as BlobPart], { type: 'image/jpeg' });
    return {
      filename: file.name,
      blob,
      originalSize: file.size,
      removed: removed.length > 0 ? removed : ['No metadata found'],
      lossless: true,
    };
  }

  // PNG
  if (mime === 'image/png' || name.endsWith('.png')) {
    const { data, removed } = stripPng(bytes);
    const blob = new Blob([data as unknown as BlobPart], { type: 'image/png' });
    return {
      filename: file.name,
      blob,
      originalSize: file.size,
      removed: removed.length > 0 ? removed : ['No metadata found'],
      lossless: true,
    };
  }

  // WEBP
  if (mime === 'image/webp' || name.endsWith('.webp')) {
    const { data, removed } = stripWebp(bytes);
    const blob = new Blob([data as unknown as BlobPart], { type: 'image/webp' });
    return {
      filename: file.name,
      blob,
      originalSize: file.size,
      removed: removed.length > 0 ? removed : ['No metadata found'],
      lossless: true,
    };
  }

  // Other formats: re-encode via canvas
  const img = await decodeImage(file);
  const canvas = imageToCanvas(img);
  const blob = await canvasToBlob(canvas, 'image/png');
  return {
    filename: replaceExt(file.name, 'png'),
    blob,
    originalSize: file.size,
    removed: ['Stripped via canvas re-encode'],
    lossless: false,
  };
}
