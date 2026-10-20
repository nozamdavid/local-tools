import { decodeImage, canvasToBlob, type EncodableMime } from '../../../lib/image';
import { getDefaultFormat, renderScaledCanvas, formatOutputFile, detectAlpha } from './utils';

export interface ResizeOptions {
  width: number;
  height: number;
  format?: EncodableMime;
  quality?: number; // 0..1
}

export interface ResizeResult {
  blob: Blob;
  width: number;
  height: number;
  filename: string;
  originalSize: number;
}

export async function resizeImage(file: File, options: ResizeOptions): Promise<ResizeResult> {
  const img = await decodeImage(file);
  const defaultFmt = getDefaultFormat(file, 'image/png');
  const mime = options.format || defaultFmt.mime;
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';

  const scaledCanvas = renderScaledCanvas(img, img.width, img.height, options.width, options.height);
  const quality = mime === 'image/png' ? undefined : (options.quality ?? 0.85);
  const blob = await canvasToBlob(scaledCanvas, mime, quality);
  const filename = formatOutputFile(file.name, '-resized', ext);

  return {
    blob,
    width: options.width,
    height: options.height,
    filename,
    originalSize: file.size,
  };
}

export interface CompressOptions {
  quality?: number; // 0..1 (default 0.75)
  maxDimension?: number;
  format?: EncodableMime;
}

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  filename: string;
  originalSize: number;
  isLarger: boolean;
}

export async function compressImage(file: File, options: CompressOptions = {}): Promise<CompressResult> {
  const img = await decodeImage(file);
  let targetW = img.width;
  let targetH = img.height;

  if (options.maxDimension && options.maxDimension > 0) {
    const maxDim = Math.max(img.width, img.height);
    if (maxDim > options.maxDimension) {
      const scale = options.maxDimension / maxDim;
      targetW = Math.max(1, Math.round(img.width * scale));
      targetH = Math.max(1, Math.round(img.height * scale));
    }
  }

  const canvas = renderScaledCanvas(img, img.width, img.height, targetW, targetH);

  let mime: EncodableMime = options.format || 'image/jpeg';
  if (!options.format) {
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
    const isWebp = file.type === 'image/webp' || /\.webp$/i.test(file.name);
    if (isWebp) {
      mime = 'image/webp';
    } else if (isPng) {
      // PNG input with alpha -> WEBP by default, else JPG
      const hasAlpha = detectAlpha(canvas);
      mime = hasAlpha ? 'image/webp' : 'image/jpeg';
    } else {
      // HEIC, BMP, etc. or JPG -> JPG
      mime = 'image/jpeg';
    }
  }

  const ext = mime === 'image/webp' ? 'webp' : 'jpg';
  const quality = options.quality ?? 0.75;
  const blob = await canvasToBlob(canvas, mime, quality);
  const filename = formatOutputFile(file.name, '-compressed', ext);

  return {
    blob,
    width: targetW,
    height: targetH,
    filename,
    originalSize: file.size,
    isLarger: blob.size > file.size,
  };
}

export interface TargetSizeResult {
  blob: Blob;
  width: number;
  height: number;
  filename: string;
  originalSize: number;
  achievedBytes: number;
  quality: number;
  scale: number;
}

export async function compressToTargetSize(file: File, targetBytes: number): Promise<TargetSizeResult> {
  const img = await decodeImage(file);
  const baseCanvas = renderScaledCanvas(img, img.width, img.height, img.width, img.height);
  const hasAlpha = detectAlpha(baseCanvas);
  const isWebp = file.type === 'image/webp' || /\.webp$/i.test(file.name);

  // For compressing to target size, JPG or WEBP must be used because PNG toBlob ignores quality
  const mime: EncodableMime = (hasAlpha || isWebp) ? 'image/webp' : 'image/jpeg';
  const ext = mime === 'image/webp' ? 'webp' : 'jpg';

  // Binary search quality helper at a given canvas
  async function searchQualityAtCanvas(c: HTMLCanvasElement): Promise<{ blob: Blob; q: number } | null> {
    let low = 0.30;
    let high = 0.95;
    let best: { blob: Blob; q: number } | null = null;

    // First check lowest quality
    const minBlob = await canvasToBlob(c, mime, low);
    if (minBlob.size <= targetBytes) {
      best = { blob: minBlob, q: low };
    } else {
      return null; // Cannot reach target at this resolution
    }

    // Check highest quality
    const maxBlob = await canvasToBlob(c, mime, high);
    if (maxBlob.size <= targetBytes) {
      return { blob: maxBlob, q: high };
    }

    // 6 binary search iterations
    for (let i = 0; i < 6; i++) {
      const mid = (low + high) / 2;
      const midBlob = await canvasToBlob(c, mime, mid);
      if (midBlob.size <= targetBytes) {
        best = { blob: midBlob, q: mid };
        low = mid; // Try higher quality
      } else {
        high = mid; // Must lower quality
      }
    }

    return best;
  }

  // 1. Try full resolution
  const fullRes = await searchQualityAtCanvas(baseCanvas);
  if (fullRes) {
    return {
      blob: fullRes.blob,
      width: img.width,
      height: img.height,
      filename: formatOutputFile(file.name, '-target-size', ext),
      originalSize: file.size,
      achievedBytes: fullRes.blob.size,
      quality: fullRes.q,
      scale: 1,
    };
  }

  // 2. Downscale in steps if quality floor 0.3 cannot reach target
  const scaleSteps = [0.85, 0.70, 0.55, 0.40, 0.30, 0.20, 0.15, 0.10];
  let smallestBlob: { blob: Blob; w: number; h: number; q: number; s: number } | null = null;

  for (const s of scaleSteps) {
    const sw = Math.max(1, Math.round(img.width * s));
    const sh = Math.max(1, Math.round(img.height * s));
    const stepCanvas = renderScaledCanvas(img, img.width, img.height, sw, sh);
    const stepRes = await searchQualityAtCanvas(stepCanvas);

    if (stepRes) {
      return {
        blob: stepRes.blob,
        width: sw,
        height: sh,
        filename: formatOutputFile(file.name, '-target-size', ext),
        originalSize: file.size,
        achievedBytes: stepRes.blob.size,
        quality: stepRes.q,
        scale: s,
      };
    }

    // Keep track of the lowest size so far at quality 0.30
    const testBlob = await canvasToBlob(stepCanvas, mime, 0.30);
    if (!smallestBlob || testBlob.size < smallestBlob.blob.size) {
      smallestBlob = { blob: testBlob, w: sw, h: sh, q: 0.30, s };
    }
  }

  // Fallback if target was ridiculously small
  const final = smallestBlob || {
    blob: await canvasToBlob(baseCanvas, mime, 0.30),
    w: img.width,
    h: img.height,
    q: 0.30,
    s: 1,
  };

  return {
    blob: final.blob,
    width: final.w,
    height: final.h,
    filename: formatOutputFile(file.name, '-target-size', ext),
    originalSize: file.size,
    achievedBytes: final.blob.size,
    quality: final.q,
    scale: final.s,
  };
}
