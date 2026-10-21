import { getToolMeta, TOOL_METAS, type ToolMeta } from '../tools/registry';

/*
 * File handoff: a file dropped on the home page is held in memory here and
 * picked up by the FileDrop on the tool page the user opens next.
 * Nothing is persisted; a reload clears it.
 */

interface Pending {
  files: File[];
  path: string;
  at: number;
}

const MAX_AGE_MS = 5 * 60 * 1000;
let pending: Pending | null = null;

export function setPendingFiles(files: File[], path: string) {
  pending = { files, path, at: Date.now() };
}

export function clearPendingFiles() {
  pending = null;
}

/**
 * Takes the pending files when they were meant for `path`. Files the tool does not
 * accept are returned in `rejected` so the drop zone can explain why nothing loaded.
 */
export function takePendingFiles(path: string, accept?: string, multiple = false) {
  if (!pending || pending.path !== path || Date.now() - pending.at > MAX_AGE_MS) return null;
  const { files } = pending;
  pending = null;
  const accepted = files.filter((file) => matchesAccept(file, accept));
  const rejected = files.filter((file) => !accepted.includes(file));
  return { accepted: multiple ? accepted : accepted.slice(0, 1), rejected };
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  jxl: 'image/jxl',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  json: 'application/json',
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function mimeOf(file: File): string {
  return (file.type || EXT_MIME[extensionOf(file.name)] || '').toLowerCase();
}

/** Mirrors the browser's <input accept> rules: extensions, exact MIME types and type/* wildcards. */
export function matchesAccept(file: File, accept?: string): boolean {
  if (!accept || accept.trim() === '' || accept.trim() === '*') return true;
  const ext = `.${extensionOf(file.name)}`;
  const mime = mimeOf(file);
  // The browser could not tell what this is: let the tool decide.
  if (!mime && !accept.includes(ext)) return accept.includes('/');
  return accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .some((token) => {
      if (!token) return false;
      if (token === '*' || token === '*/*') return true;
      if (token.startsWith('.')) return token === ext;
      if (token.endsWith('/*')) return mime.startsWith(token.slice(0, -1));
      return token === mime;
    });
}

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'word' | 'excel' | 'powerpoint' | 'web' | 'data' | 'text' | 'other';

export function fileKind(file: File): FileKind {
  const ext = extensionOf(file.name);
  const mime = mimeOf(file);
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'word';
  if (['xls', 'xlsx', 'ods'].includes(ext)) return 'excel';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'powerpoint';
  if (['html', 'htm', 'mhtml', 'mht', 'css'].includes(ext)) return 'web';
  if (['csv', 'tsv', 'json', 'gpx', 'kml'].includes(ext)) return 'data';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || ['txt', 'log', 'md'].includes(ext)) return 'text';
  return 'other';
}

const NOT_FOR_IMAGES = new Set([
  'img-pdf-to-image',
  'img-extract-pdf-images',
  'img-docx-to-jpg',
  'img-docx-to-png',
  'img-hex-rgb-converter',
  'img-color-contrast',
  'img-qr-code-generator',
  'img-barcode-generator',
  'img-label-designer',
]);

const NOT_FOR_PDFS = new Set(['pdf-jpg-to-pdf', 'pdf-word-to-pdf', 'pdf-powerpoint-to-pdf', 'pdf-excel-to-pdf', 'pdf-html-to-pdf', 'pdf-scan-to-pdf']);

/**
 * Direction-specific source converters and their required input formats.
 * Generic converters (e.g. img-convert, img-image-to-webp, img-image-to-svg)
 * are not listed here and remain eligible for all supported files of their kind.
 */
const DIRECTIONAL_INPUT_FORMATS: Record<string, string[]> = {
  'img-png-to-jpg': ['png'],
  'img-jpg-to-png': ['jpg', 'jpeg', 'jpe'],
  'img-webp-to-jpg': ['webp'],
  'img-webp-to-png': ['webp'],
  'img-heic-to-jpg': ['heic', 'heif'],
  'img-svg-to-png': ['svg'],
  'pdf-jpg-to-pdf': ['jpg', 'jpeg', 'jpe'],
};

/** Checks whether a tool is eligible to accept the given file based on directional input requirements. */
export function isToolEligible(toolId: string, file: File): boolean {
  const expectedFormats = DIRECTIONAL_INPUT_FORMATS[toolId];
  if (!expectedFormats) return true;

  const ext = extensionOf(file.name);
  if (ext && expectedFormats.includes(ext)) return true;

  const mime = mimeOf(file);
  return expectedFormats.some((fmt) => {
    const expectedMime = EXT_MIME[fmt];
    return (expectedMime && mime === expectedMime) || mime.includes(fmt);
  });
}

/** Ids that fit a specific extension best, shown first. */
const BY_EXTENSION: Record<string, string[]> = {
  heic: ['img-heic-to-jpg'],
  heif: ['img-heic-to-jpg'],
  webp: ['img-webp-to-jpg', 'img-webp-to-png'],
  svg: ['img-svg-to-png'],
  png: ['img-png-to-jpg'],
  jpg: ['img-jpg-to-png', 'pdf-jpg-to-pdf'],
  jpeg: ['img-jpg-to-png', 'pdf-jpg-to-pdf'],
  jpe: ['img-jpg-to-png', 'pdf-jpg-to-pdf'],
  ico: ['img-icon-converter'],
  docx: ['pdf-word-to-pdf', 'img-docx-to-jpg', 'img-docx-to-png'],
  xlsx: ['pdf-excel-to-pdf'],
  pptx: ['pdf-powerpoint-to-pdf'],
  html: ['pdf-html-to-pdf'],
  htm: ['pdf-html-to-pdf'],
  mhtml: ['mhtml-to-html'],
  mht: ['mhtml-to-html'],
  css: ['css-viewer'],
  csv: ['csv-viewer', 'json-csv'],
  tsv: ['csv-viewer'],
  json: ['json-csv'],
  txt: ['txt-to-csv'],
  log: ['txt-to-csv'],
  gpx: ['gpx-kml'],
  kml: ['gpx-kml'],
};

const BY_KIND: Record<FileKind, (tool: ToolMeta) => boolean> = {
  image: (t) =>
    (t.media === 'image' && !NOT_FOR_IMAGES.has(t.id)) ||
    ['pdf-jpg-to-pdf', 'text-behind-image'].includes(t.id),
  video: (t) => (t.media === 'video' && t.id !== 'media-speed' && t.id !== 'text-behind-image') || t.id === 'video-health',
  audio: (t) => ['video-to-text', 'subtitles'].includes(t.id),
  pdf: (t) => (t.media === 'pdf' && !NOT_FOR_PDFS.has(t.id)) || ['img-pdf-to-image', 'img-extract-pdf-images'].includes(t.id),
  word: () => false,
  excel: () => false,
  powerpoint: () => false,
  web: () => false,
  data: () => false,
  text: () => false,
  other: () => false,
};

const ALWAYS = ['file-converter', 'file-inspector'];

/** Tools that can open the given files, best matches first. */
export function suggestToolsForFiles(files: File[]): ToolMeta[] {
  if (files.length === 0) return [];
  const first = files[0];
  const ids: string[] = [];
  const push = (id: string) => {
    if (!ids.includes(id) && isToolEligible(id, first) && TOOL_METAS.some((t) => t.id === id)) ids.push(id);
  };

  (BY_EXTENSION[extensionOf(first.name)] ?? []).forEach(push);
  const fits = TOOL_METAS.filter((t) => BY_KIND[fileKind(first)](t) && isToolEligible(t.id, first));
  fits.filter((t) => t.popular).forEach((t) => push(t.id));
  fits.forEach((t) => push(t.id));
  if (files.length > 1) push('batch-rename');
  ALWAYS.forEach(push);

  return ids.map((id) => getToolMeta(id));
}
