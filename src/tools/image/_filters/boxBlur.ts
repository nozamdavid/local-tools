// Blur each row or column by extending its end pixels past the image boundary.
export function boxBlur(
  source: Uint8ClampedArray | Uint16Array,
  target: Uint8ClampedArray | Uint16Array,
  length: number,
  lineCount: number,
  pixelStride: number,
  lineStride: number,
  radius: number,
  blurAlpha = false,
) {
  const windowSize = 2 * radius + 1;
  for (let line = 0; line < lineCount; line++) {
    const start = line * lineStride;
    const last = length - 1;
    let red = (radius + 1) * source[start];
    let green = (radius + 1) * source[start + 1];
    let blue = (radius + 1) * source[start + 2];
    let alpha = (radius + 1) * source[start + 3];
    for (let pixel = 1; pixel <= radius; pixel++) {
      const index = start + Math.min(last, pixel) * pixelStride;
      red += source[index];
      green += source[index + 1];
      blue += source[index + 2];
      alpha += source[index + 3];
    }

    for (let pixel = 0; pixel < length; pixel++) {
      const index = start + pixel * pixelStride;
      target[index] = Math.round(red / windowSize);
      target[index + 1] = Math.round(green / windowSize);
      target[index + 2] = Math.round(blue / windowSize);
      target[index + 3] = blurAlpha ? Math.round(alpha / windowSize) : source[index + 3];

      const entering = start + Math.min(last, pixel + radius + 1) * pixelStride;
      const leaving = start + Math.max(0, pixel - radius) * pixelStride;
      red += source[entering] - source[leaving];
      green += source[entering + 1] - source[leaving + 1];
      blue += source[entering + 2] - source[leaving + 2];
      alpha += source[entering + 3] - source[leaving + 3];
    }
  }
}
