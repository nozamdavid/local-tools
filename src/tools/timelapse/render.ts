import { getRotationCrop, rotationAxes } from '../../lib/rotationCrop';

export type FrameSettings = {
  /** Clockwise rotation in degrees. */
  angle: number;
  /** Coordinates normalized to the centered, edge-free straightened first frame. */
  crop: { x: number; y: number; width: number; height: number };
};

function getCrop(width: number, height: number, { angle, crop }: FrameSettings) {
  const straightened = getRotationCrop(width, height, angle);
  const cropWidth = Math.min(straightened.width, Math.max(1, crop.width * straightened.width));
  const cropHeight = Math.min(straightened.height, Math.max(1, crop.height * straightened.height));
  const left = Math.min(straightened.width - cropWidth, Math.max(0, crop.x * straightened.width));
  const top = Math.min(straightened.height - cropHeight, Math.max(0, crop.y * straightened.height));

  return {
    x: left - straightened.width / 2,
    y: top - straightened.height / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

export function getFrameSize(width: number, height: number, settings: FrameSettings): { width: number; height: number } {
  const crop = getCrop(width, height, settings);
  const scale = Math.min(1, 3840 / Math.max(crop.width, crop.height));
  return {
    width: Math.max(2, Math.round((crop.width * scale) / 2) * 2),
    height: Math.max(2, Math.round((crop.height * scale) / 2) * 2),
  };
}

export function drawFrame(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  projectWidth: number,
  projectHeight: number,
  settings: FrameSettings,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');

  const crop = getCrop(projectWidth, projectHeight, settings);
  const { cos, sin } = rotationAxes(settings.angle);
  const coverScale = Math.max(projectWidth / sourceWidth, projectHeight / sourceHeight);
  const coveredWidth = sourceWidth * coverScale;
  const coveredHeight = sourceHeight * coverScale;

  ctx.save();
  try {
    ctx.resetTransform();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(canvas.width / crop.width, canvas.height / crop.height);
    ctx.translate(-crop.x, -crop.y);
    ctx.transform(cos, sin, -sin, cos, 0, 0);
    ctx.drawImage(source, -coveredWidth / 2, -coveredHeight / 2, coveredWidth, coveredHeight);
  } finally {
    ctx.restore();
  }
}
