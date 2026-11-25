/** Fit a visual annotation box inside the page, preserving its aspect ratio. */
export function fitAnnotationBox(xPercent: number, yPercent: number, widthPercent: number, heightPercent: number) {
  const scale = Math.min(1, 100 / Math.max(widthPercent, heightPercent));
  const width = widthPercent * scale;
  const height = heightPercent * scale;
  return {
    xPercent: Math.max(0, Math.min(100 - width, xPercent)),
    yPercent: Math.max(0, Math.min(100 - height, yPercent)),
    widthPercent: width,
    heightPercent: height,
  };
}
