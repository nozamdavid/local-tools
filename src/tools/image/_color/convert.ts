export interface RGBA {
  r: number; // 0..255
  g: number; // 0..255
  b: number; // 0..255
  a: number; // 0..1
}

export interface HSLA {
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
  a: number; // 0..1
}

export interface HSVA {
  h: number; // 0..360
  s: number; // 0..100
  v: number; // 0..100
  a: number; // 0..1
}

export interface CMYK {
  c: number; // 0..100
  m: number; // 0..100
  y: number; // 0..100
  k: number; // 0..100
}

export const CSS_NAMED_COLORS: Record<string, string> = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkgrey: '#a9a9a9',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  grey: '#808080',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  rebeccapurple: '#663399',
  red: '#ff0000',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
};

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function parseHex(input: string): RGBA | null {
  const clean = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(clean)) return null;

  if (clean.length === 3) {
    // #RGB
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b, a: 1 };
  }
  if (clean.length === 4) {
    // #RGBA
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    const a = Math.round((parseInt(clean[3] + clean[3], 16) / 255) * 100) / 100;
    return { r, g, b, a };
  }
  if (clean.length === 6) {
    // #RRGGBB
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return { r, g, b, a: 1 };
  }
  if (clean.length === 8) {
    // #RRGGBBAA
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const a = Math.round((parseInt(clean.slice(6, 8), 16) / 255) * 100) / 100;
    return { r, g, b, a };
  }
  return null;
}

export function formatHex(rgba: RGBA, digits: 3 | 4 | 6 | 8 = 6): string {
  const r2 = clamp(Math.round(rgba.r), 0, 255).toString(16).padStart(2, '0');
  const g2 = clamp(Math.round(rgba.g), 0, 255).toString(16).padStart(2, '0');
  const b2 = clamp(Math.round(rgba.b), 0, 255).toString(16).padStart(2, '0');
  const aVal = clamp(Math.round(rgba.a * 255), 0, 255);
  const a2 = aVal.toString(16).padStart(2, '0');

  if (digits === 3) {
    return `#${r2[0]}${g2[0]}${b2[0]}`;
  }
  if (digits === 4) {
    return `#${r2[0]}${g2[0]}${b2[0]}${a2[0]}`;
  }
  if (digits === 8) {
    return `#${r2}${g2}${b2}${a2}`;
  }
  return `#${r2}${g2}${b2}`;
}

export function rgbToHex(rgba: RGBA, includeAlpha: boolean = false): string {
  return formatHex(rgba, includeAlpha || rgba.a < 1 ? 8 : 6);
}

export function rgbToHsl(rgba: RGBA): HSLA {
  const r = clamp(rgba.r, 0, 255) / 255;
  const g = clamp(rgba.g, 0, 255) / 255;
  const b = clamp(rgba.b, 0, 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
    a: rgba.a,
  };
}

export function hslToRgb(hsla: HSLA): RGBA {
  const h = (((hsla.h % 360) + 360) % 360) / 360;
  const s = clamp(hsla.s, 0, 100) / 100;
  const l = clamp(hsla.l, 0, 100) / 100;

  if (s === 0) {
    const val = Math.round(l * 255);
    return { r: val, g: val, b: val, a: hsla.a };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tAdj = t;
    if (tAdj < 0) tAdj += 1;
    if (tAdj > 1) tAdj -= 1;
    if (tAdj < 1 / 6) return p + (q - p) * 6 * tAdj;
    if (tAdj < 1 / 2) return q;
    if (tAdj < 2 / 3) return p + (q - p) * (2 / 3 - tAdj) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

  return { r, g, b, a: hsla.a };
}

export function rgbToHsv(rgba: RGBA): HSVA {
  const r = clamp(rgba.r, 0, 255) / 255;
  const g = clamp(rgba.g, 0, 255) / 255;
  const b = clamp(rgba.b, 0, 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    v: Math.round(v * 100),
    a: rgba.a,
  };
}

export function hsvToRgb(hsva: HSVA): RGBA {
  const h = (((hsva.h % 360) + 360) % 360) / 60;
  const s = clamp(hsva.s, 0, 100) / 100;
  const v = clamp(hsva.v, 0, 100) / 100;

  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  let r = 0;
  let g = 0;
  let b = 0;

  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
    a: hsva.a,
  };
}

export function rgbToCmyk(rgba: RGBA): CMYK {
  const r = clamp(rgba.r, 0, 255) / 255;
  const g = clamp(rgba.g, 0, 255) / 255;
  const b = clamp(rgba.b, 0, 255) / 255;

  const k = 1 - Math.max(r, g, b);
  if (k === 1) {
    return { c: 0, m: 0, y: 0, k: 100 };
  }

  const c = Math.round(((1 - r - k) / (1 - k)) * 100);
  const m = Math.round(((1 - g - k) / (1 - k)) * 100);
  const y = Math.round(((1 - b - k) / (1 - k)) * 100);

  return {
    c: clamp(c, 0, 100),
    m: clamp(m, 0, 100),
    y: clamp(y, 0, 100),
    k: clamp(Math.round(k * 100), 0, 100),
  };
}

export function cmykToRgb(cmyk: CMYK, a: number = 1): RGBA {
  const c = clamp(cmyk.c, 0, 100) / 100;
  const m = clamp(cmyk.m, 0, 100) / 100;
  const y = clamp(cmyk.y, 0, 100) / 100;
  const k = clamp(cmyk.k, 0, 100) / 100;

  const r = Math.round(255 * (1 - c) * (1 - k));
  const g = Math.round(255 * (1 - m) * (1 - k));
  const b = Math.round(255 * (1 - y) * (1 - k));

  return { r, g, b, a };
}

export function formatRgb(rgba: RGBA, includeAlpha: boolean = false): string {
  const r = clamp(Math.round(rgba.r), 0, 255);
  const g = clamp(Math.round(rgba.g), 0, 255);
  const b = clamp(Math.round(rgba.b), 0, 255);
  if (includeAlpha || rgba.a < 1) {
    const a = Math.round(rgba.a * 100) / 100;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return `rgb(${r}, ${g}, ${b})`;
}

export function formatHsl(hsla: HSLA, includeAlpha: boolean = false): string {
  if (includeAlpha || hsla.a < 1) {
    const a = Math.round(hsla.a * 100) / 100;
    return `hsla(${hsla.h}, ${hsla.s}%, ${hsla.l}%, ${a})`;
  }
  return `hsl(${hsla.h}, ${hsla.s}%, ${hsla.l}%)`;
}

export function formatHsv(hsva: HSVA, includeAlpha: boolean = false): string {
  if (includeAlpha || hsva.a < 1) {
    const a = Math.round(hsva.a * 100) / 100;
    return `hsva(${hsva.h}, ${hsva.s}%, ${hsva.v}%, ${a})`;
  }
  return `hsv(${hsva.h}, ${hsva.s}%, ${hsva.v}%)`;
}

export function formatCmyk(cmyk: CMYK): string {
  return `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`;
}

export function parseRgb(str: string): RGBA | null {
  const match = str.match(/^rgba?\s*\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.%]+))?\s*\)$/i);
  if (!match) return null;
  const r = parseFloat(match[1]);
  const g = parseFloat(match[2]);
  const b = parseFloat(match[3]);
  let a = 1;
  if (match[4]) {
    a = match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
  }
  return {
    r: clamp(Math.round(r), 0, 255),
    g: clamp(Math.round(g), 0, 255),
    b: clamp(Math.round(b), 0, 255),
    a: clamp(a, 0, 1),
  };
}

export function parseHsl(str: string): HSLA | null {
  const match = str.match(/^hsla?\s*\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%(?:\s*[,/]\s*([\d.%]+))?\s*\)$/i);
  if (!match) return null;
  const h = parseFloat(match[1]);
  const s = parseFloat(match[2]);
  const l = parseFloat(match[3]);
  let a = 1;
  if (match[4]) {
    a = match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
  }
  return {
    h: Math.round(((h % 360) + 360) % 360),
    s: clamp(Math.round(s), 0, 100),
    l: clamp(Math.round(l), 0, 100),
    a: clamp(a, 0, 1),
  };
}

export function parseHsv(str: string): HSVA | null {
  const match = str.match(/^hsva?\s*\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?(?:\s*[,/]\s*([\d.%]+))?\s*\)$/i);
  if (!match) return null;
  const h = parseFloat(match[1]);
  const s = parseFloat(match[2]);
  const v = parseFloat(match[3]);
  let a = 1;
  if (match[4]) {
    a = match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]);
  }
  return {
    h: Math.round(((h % 360) + 360) % 360),
    s: clamp(Math.round(s), 0, 100),
    v: clamp(Math.round(v), 0, 100),
    a: clamp(a, 0, 1),
  };
}

export function parseCmyk(str: string): CMYK | null {
  const match = str.match(/^cmyk\s*\(\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?\s*\)$/i);
  if (!match) return null;
  return {
    c: clamp(Math.round(parseFloat(match[1])), 0, 100),
    m: clamp(Math.round(parseFloat(match[2])), 0, 100),
    y: clamp(Math.round(parseFloat(match[3])), 0, 100),
    k: clamp(Math.round(parseFloat(match[4])), 0, 100),
  };
}

export function parseColorAny(input: string): RGBA | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 1. Hex
  if (trimmed.startsWith('#') || /^[0-9a-fA-F]{3,8}$/.test(trimmed)) {
    const hexResult = parseHex(trimmed);
    if (hexResult) return hexResult;
  }

  // 2. RGB
  if (/^rgba?\(/i.test(trimmed)) {
    const rgbResult = parseRgb(trimmed);
    if (rgbResult) return rgbResult;
  }

  // 3. HSL
  if (/^hsla?\(/i.test(trimmed)) {
    const hslResult = parseHsl(trimmed);
    if (hslResult) return hslToRgb(hslResult);
  }

  // 4. HSV
  if (/^hsva?\(/i.test(trimmed)) {
    const hsvResult = parseHsv(trimmed);
    if (hsvResult) return hsvToRgb(hsvResult);
  }

  // 5. CMYK
  if (/^cmyk\(/i.test(trimmed)) {
    const cmykResult = parseCmyk(trimmed);
    if (cmykResult) return cmykToRgb(cmykResult);
  }

  // 6. Named colors
  const lower = trimmed.toLowerCase();
  if (CSS_NAMED_COLORS[lower]) {
    return parseHex(CSS_NAMED_COLORS[lower]);
  }

  return null;
}

export function findMatchingNamedColor(rgba: RGBA): string | null {
  const hex = formatHex(rgba, 6).toLowerCase();
  for (const [name, value] of Object.entries(CSS_NAMED_COLORS)) {
    if (value.toLowerCase() === hex) {
      return name;
    }
  }
  return null;
}

// WCAG 2.x Relative Luminance and Contrast
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function getRelativeLuminance(rgba: RGBA): number {
  const rLin = srgbToLinear(clamp(rgba.r, 0, 255));
  const gLin = srgbToLinear(clamp(rgba.g, 0, 255));
  const bLin = srgbToLinear(clamp(rgba.b, 0, 255));
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

export function getContrastRatio(fg: RGBA, bg: RGBA): number {
  const l1 = getRelativeLuminance(fg);
  const l2 = getRelativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

export interface WcagEvaluation {
  ratio: number;
  aaNormal: boolean; // >= 4.5
  aaaNormal: boolean; // >= 7.0
  aaLarge: boolean; // >= 3.0
  aaaLarge: boolean; // >= 4.5
  uiComponent: boolean; // >= 3.0
}

export function evaluateWcag(ratio: number): WcagEvaluation {
  return {
    ratio,
    aaNormal: ratio >= 4.5,
    aaaNormal: ratio >= 7.0,
    aaLarge: ratio >= 3.0,
    aaaLarge: ratio >= 4.5,
    uiComponent: ratio >= 3.0,
  };
}

export function suggestPassingColor(fg: RGBA, bg: RGBA, targetRatio: number = 4.5): RGBA {
  const fgHsl = rgbToHsl(fg);

  // Check if current already passes
  if (getContrastRatio(fg, bg) >= targetRatio) {
    return fg;
  }

  // Test all L from 0 to 100 to find the L closest to current fgHsl.l that satisfies targetRatio
  let bestL: number | null = null;
  let minDiff = Infinity;

  for (let l = 0; l <= 100; l++) {
    const candidateRgb = hslToRgb({ ...fgHsl, l });
    const ratio = getContrastRatio(candidateRgb, bg);
    if (ratio >= targetRatio) {
      const diff = Math.abs(l - fgHsl.l);
      if (diff < minDiff) {
        minDiff = diff;
        bestL = l;
      }
    }
  }

  if (bestL !== null) {
    return hslToRgb({ ...fgHsl, l: bestL });
  }

  // If impossible with same hue/sat, return pure black or pure white
  const blackRatio = getContrastRatio({ r: 0, g: 0, b: 0, a: 1 }, bg);
  const whiteRatio = getContrastRatio({ r: 255, g: 255, b: 255, a: 1 }, bg);
  return blackRatio >= whiteRatio ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
}
