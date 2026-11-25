import { runFFmpeg, type RunFFmpegInput } from '../../lib/ffmpeg';
import { withSuffix } from '../../lib/format';
import { translate } from '../../lib/i18n';
import type { SubtitleCue } from '../_whisper';

export interface SubtitleStyleOptions {
  fontSize: number; // base size (e.g. 28)
  color: string; // e.g. '#ffffff'
  backgroundBox: boolean;
  position: 'bottom' | 'top';
}

function wrapText(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const testLine = `${currentLine} ${word}`;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);
  return lines;
}

async function renderCueToPng(cue: SubtitleCue, width: number, height: number, style: SubtitleStyleOptions): Promise<Uint8Array> {
  const canvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : (document.createElement('canvas') as HTMLCanvasElement);

  if ('width' in canvas) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (!ctx) {
    throw new Error(translate('Canvas 2D context not available'));
  }

  ctx.clearRect(0, 0, width, height);

  const text = cue.text.trim();
  if (!text) {
    // Return transparent 1x1 image or empty canvas
    return canvasToUint8Array(canvas);
  }

  // Scale font size proportionally to video height (normalized to 720p)
  const scale = Math.max(0.4, Math.min(3.0, height / 720));
  const fontSizePx = Math.round(style.fontSize * scale);
  const lineHeight = Math.round(fontSizePx * 1.35);

  ctx.font = `600 ${fontSizePx}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxTextWidth = Math.round(width * 0.85);
  const lines = wrapText(ctx, text, maxTextWidth);
  const totalTextHeight = lines.length * lineHeight;

  const centerX = Math.round(width / 2);
  let startY: number;

  if (style.position === 'top') {
    startY = Math.round(height * 0.08 + lineHeight / 2);
  } else {
    startY = Math.round(height * 0.88 - totalTextHeight + lineHeight / 2);
  }

  const padX = Math.round(fontSizePx * 0.45);
  const padY = Math.round(fontSizePx * 0.2);
  const radius = Math.round(fontSizePx * 0.25);

  lines.forEach((line, lineIdx) => {
    const y = startY + lineIdx * lineHeight;
    const metrics = ctx.measureText(line);
    const lineWidth = metrics.width;

    if (style.backgroundBox) {
      const boxX = centerX - lineWidth / 2 - padX;
      const boxY = y - lineHeight / 2 + padY / 2;
      const boxW = lineWidth + padX * 2;
      const boxH = lineHeight - padY;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, radius);
        ctx.fill();
      } else {
        ctx.fillRect(boxX, boxY, boxW, boxH);
      }
    }

    // Text outline for contrast
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(2, Math.round(fontSizePx * 0.12));
    ctx.lineJoin = 'round';
    ctx.strokeText(line, centerX, y);

    // Text fill
    ctx.fillStyle = style.color;
    ctx.fillText(line, centerX, y);
  });

  return canvasToUint8Array(canvas);
}

async function canvasToUint8Array(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
  let blob: Blob | null;
  if (canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: 'image/png' });
  } else {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  if (!blob) {
    throw new Error(translate('Failed to convert canvas to PNG blob'));
  }

  const ab = await blob.arrayBuffer();
  return new Uint8Array(ab);
}

export async function burnSubtitlesIntoVideo(
  videoFile: File,
  cues: SubtitleCue[],
  style: SubtitleStyleOptions,
  videoWidth: number = 1280,
  videoHeight: number = 720,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const safeWidth = videoWidth > 0 ? videoWidth : 1280;
  const safeHeight = videoHeight > 0 ? videoHeight : 720;

  // Filter valid cues that have text and valid timing
  const validCues = cues.filter((c) => c.text.trim().length > 0 && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start);

  const inputVideoExt = videoFile.name.includes('.') ? videoFile.name.slice(videoFile.name.lastIndexOf('.')) : '.mp4';
  const inputVideoName = `input${inputVideoExt}`;
  const outputName = withSuffix(videoFile.name, '-subtitled-burned', 'mp4');

  if (validCues.length === 0) {
    // No cues to burn, just transcode / copy input
    return runFFmpeg({
      inputs: [{ name: inputVideoName, data: videoFile }],
      args: ['-i', inputVideoName, '-c', 'copy', outputName],
      output: outputName,
      onProgress,
    });
  }

  // Phase 1: Rasterize each cue to PNG
  onProgress?.(0.05);
  const inputs: RunFFmpegInput[] = [{ name: inputVideoName, data: videoFile }];

  for (let i = 0; i < validCues.length; i++) {
    const cue = validCues[i];
    const pngData = await renderCueToPng(cue, safeWidth, safeHeight, style);
    const pngName = `cue_${i}.png`;
    inputs.push({ name: pngName, data: pngData });
  }

  onProgress?.(0.15);

  // Phase 2: Build chained overlay filter graph
  let filter = '';
  let prevStream = '0:v';

  validCues.forEach((cue, index) => {
    const nextStream = index === validCues.length - 1 ? 'out_v' : `v${index + 1}`;
    filter += `[${prevStream}][${index + 1}:v]overlay=0:0:enable='between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})'[${nextStream}];`;
    prevStream = nextStream;
  });
  filter = filter.slice(0, -1);

  const args = [
    '-i',
    inputVideoName,
    ...validCues.flatMap((_, idx) => ['-i', `cue_${idx}.png`]),
    '-filter_complex',
    filter,
    '-map',
    '[out_v]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    outputName,
  ];

  return runFFmpeg({
    inputs,
    args,
    output: outputName,
    onProgress: (ffmpegRatio) => {
      // Map ffmpeg progress from 0.15 to 1.0
      onProgress?.(0.15 + ffmpegRatio * 0.85);
    },
  });
}
