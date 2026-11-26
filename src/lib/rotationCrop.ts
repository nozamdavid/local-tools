export function rotationAxes(angle: number): { cos: number; sin: number } {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return angle % 90 === 0 ? { cos: Math.round(cos), sin: Math.round(sin) } : { cos, sin };
}

export function getRotationBounds(width: number, height: number, angle: number): { width: number; height: number } {
  const { cos, sin } = rotationAxes(angle);
  return {
    width: Math.ceil(width * Math.abs(cos) + height * Math.abs(sin)),
    height: Math.ceil(width * Math.abs(sin) + height * Math.abs(cos)),
  };
}

export function getRotationCrop(width: number, height: number, angle: number): { width: number; height: number } {
  const rotation = Math.abs(angle % 180);
  if (rotation === 0) return { width, height };
  if (rotation === 90) return { width: height, height: width };

  const acute = Math.min(rotation, 180 - rotation);
  const { cos, sin } = rotationAxes(acute);
  const shorter = Math.min(width, height);
  const longer = Math.max(width, height);
  let keptWidth: number;
  let keptHeight: number;

  // The maximum-area rectangle touches both pairs of sides or splits the limiting side's constraint equally.
  if (acute === 45 || shorter <= 2 * sin * cos * longer) {
    keptWidth = shorter / (2 * (width <= height ? cos : sin));
    keptHeight = shorter / (2 * (width <= height ? sin : cos));
  } else {
    const sum = (width + height) / (cos + sin);
    const difference = (width - height) / (cos - sin);
    keptWidth = (sum + difference) / 2;
    keptHeight = (sum - difference) / 2;
  }

  // A dimension below one pixel still has a center sample.
  return { width: Math.max(1, Math.floor(keptWidth)), height: Math.max(1, Math.floor(keptHeight)) };
}
