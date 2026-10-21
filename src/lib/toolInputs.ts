import type { ToolMeta } from '../tools/registry';

export const EXT_MIME: Record<string, string> = {
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jif: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  dib: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  jxl: 'image/jxl',
  svg: 'image/svg+xml',
  svgz: 'image/svg+xml',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',

  // Video
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  flv: 'video/x-flv',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mts: 'video/mp2t',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp',
  wmv: 'video/x-ms-wmv',
  ogv: 'video/ogg',

  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  opus: 'audio/opus',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  wma: 'audio/x-ms-wma',
  weba: 'audio/webm',

  // Documents
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',

  // Web, Data, Text
  html: 'text/html',
  htm: 'text/html',
  mhtml: 'message/rfc822',
  mht: 'message/rfc822',
  mime: 'message/rfc822',
  css: 'text/css',
  json: 'application/json',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  log: 'text/plain',
  gpx: 'application/gpx+xml',
  kml: 'application/vnd.google-earth.kml+xml',
  xml: 'application/xml',
};

export type CanonicalFormat =
  | 'jpg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'bmp'
  | 'avif'
  | 'heic'
  | 'jxl'
  | 'svg'
  | 'ico'
  | 'tiff'
  | 'image-other'
  | 'mp4'
  | 'webm-video'
  | 'mov'
  | 'mkv'
  | 'avi'
  | 'flv'
  | 'ts'
  | '3gp'
  | 'wmv'
  | 'ogv'
  | 'video-other'
  | 'mp3'
  | 'wav'
  | 'm4a'
  | 'flac'
  | 'ogg'
  | 'opus'
  | 'aiff'
  | 'wma'
  | 'webm-audio'
  | 'audio-other'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'legacy-office'
  | 'html'
  | 'mhtml'
  | 'css'
  | 'json'
  | 'csv'
  | 'tsv'
  | 'txt'
  | 'log'
  | 'gpx'
  | 'kml'
  | 'xml'
  | 'unknown';

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function mimeOf(file: File): string {
  const ext = extensionOf(file.name);
  const raw = (file.type || '').trim().toLowerCase();
  if (raw === '' || raw === 'application/octet-stream') {
    return EXT_MIME[ext] || raw;
  }
  return raw;
}

export interface FileClassification {
  ext: string;
  mime: string;
  format: CanonicalFormat;
  isStandardImage: boolean;
  isAnyImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  isPdf: boolean;
  isDocx: boolean;
  isXlsx: boolean;
  isPptx: boolean;
  isLegacyOffice: boolean;
  isHtml: boolean;
  isMhtml: boolean;
  isCss: boolean;
  isJson: boolean;
  isCsv: boolean;
  isTsv: boolean;
  isTxt: boolean;
  isLog: boolean;
  isGpx: boolean;
  isKml: boolean;
}

export function classifyFile(file: File): FileClassification {
  const ext = extensionOf(file.name);
  const mime = mimeOf(file);

  let format: CanonicalFormat = 'unknown';

  // 1. Audio first to prevent audio/webm or audio/mp4 being caught by video
  if (
    ext === 'weba' ||
    mime === 'audio/webm' ||
    (ext === 'webm' && mime.startsWith('audio/'))
  ) {
    format = 'webm-audio';
  } else if (ext === 'mp3' || mime === 'audio/mpeg' || mime === 'audio/mp3') {
    format = 'mp3';
  } else if (ext === 'wav' || mime === 'audio/wav' || mime === 'audio/x-wav') {
    format = 'wav';
  } else if (ext === 'ogg' || ext === 'oga' || mime === 'audio/ogg') {
    format = 'ogg';
  } else if (
    ext === 'm4a' ||
    ext === 'aac' ||
    mime === 'audio/aac' ||
    mime === 'audio/x-m4a' ||
    (mime === 'audio/mp4' && ext !== 'mp4')
  ) {
    format = 'm4a';
  } else if (ext === 'flac' || mime === 'audio/flac' || mime === 'audio/x-flac') {
    format = 'flac';
  } else if (ext === 'opus' || mime === 'audio/opus') {
    format = 'opus';
  } else if (ext === 'aiff' || ext === 'aif' || mime === 'audio/aiff' || mime === 'audio/x-aiff') {
    format = 'aiff';
  } else if (ext === 'wma' || mime === 'audio/x-ms-wma') {
    format = 'wma';
  } else if (mime.startsWith('audio/')) {
    format = 'audio-other';
  }

  // 2. Images
  else if (['jpg', 'jpeg', 'jpe', 'jif', 'jfif'].includes(ext) || mime === 'image/jpeg') {
    format = 'jpg';
  } else if (ext === 'png' || mime === 'image/png') {
    format = 'png';
  } else if (ext === 'webp' || mime === 'image/webp') {
    format = 'webp';
  } else if (ext === 'gif' || mime === 'image/gif') {
    format = 'gif';
  } else if (['bmp', 'dib'].includes(ext) || mime === 'image/bmp' || mime === 'image/x-ms-bmp') {
    format = 'bmp';
  } else if (ext === 'avif' || mime === 'image/avif') {
    format = 'avif';
  } else if (['heic', 'heif'].includes(ext) || mime === 'image/heic' || mime === 'image/heif') {
    format = 'heic';
  } else if (ext === 'jxl' || mime === 'image/jxl') {
    format = 'jxl';
  } else if (['svg', 'svgz'].includes(ext) || mime === 'image/svg+xml') {
    format = 'svg';
  } else if (['ico', 'cur'].includes(ext) || mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon') {
    format = 'ico';
  } else if (['tif', 'tiff'].includes(ext) || mime === 'image/tiff') {
    format = 'tiff';
  } else if (mime.startsWith('image/')) {
    format = 'image-other';
  }

  // 3. Video
  else if (['mp4', 'm4v'].includes(ext) || (mime === 'video/mp4' && !format.startsWith('audio'))) {
    format = 'mp4';
  } else if (ext === 'webm' || mime === 'video/webm') {
    format = 'webm-video';
  } else if (['mov', 'qt'].includes(ext) || mime === 'video/quicktime') {
    format = 'mov';
  } else if (ext === 'mkv' || mime === 'video/x-matroska') {
    format = 'mkv';
  } else if (ext === 'avi' || mime === 'video/x-msvideo') {
    format = 'avi';
  } else if (ext === 'flv' || mime === 'video/x-flv') {
    format = 'flv';
  } else if (['ts', 'm2ts', 'mts'].includes(ext) || mime === 'video/mp2t') {
    format = 'ts';
  } else if (['3gp', '3g2'].includes(ext) || mime === 'video/3gpp') {
    format = '3gp';
  } else if (ext === 'wmv' || mime === 'video/x-ms-wmv') {
    format = 'wmv';
  } else if (ext === 'ogv' || mime === 'video/ogg') {
    format = 'ogv';
  } else if (mime.startsWith('video/')) {
    format = 'video-other';
  }

  // 4. Documents & Office
  else if (ext === 'pdf' || mime === 'application/pdf') {
    format = 'pdf';
  } else if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    format = 'docx';
  } else if (ext === 'xlsx' || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    format = 'xlsx';
  } else if (ext === 'pptx' || mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    format = 'pptx';
  } else if (
    ['doc', 'xls', 'ppt', 'odt', 'ods', 'odp', 'rtf'].includes(ext) ||
    mime === 'application/msword' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.ms-powerpoint' ||
    mime.startsWith('application/vnd.oasis.opendocument') ||
    mime === 'application/rtf'
  ) {
    format = 'legacy-office';
  }

  // 5. Web, Data, Text
  else if (
    ['mhtml', 'mht', 'mime'].includes(ext) ||
    mime === 'message/rfc822' ||
    mime === 'multipart/related'
  ) {
    format = 'mhtml';
  } else if (['html', 'htm'].includes(ext) || mime === 'text/html') {
    format = 'html';
  } else if (ext === 'css' || mime === 'text/css') {
    format = 'css';
  } else if (ext === 'json' || mime === 'application/json') {
    format = 'json';
  } else if (ext === 'csv' || mime === 'text/csv') {
    format = 'csv';
  } else if (ext === 'tsv' || mime === 'text/tab-separated-values') {
    format = 'tsv';
  } else if (ext === 'gpx' || mime === 'application/gpx+xml') {
    format = 'gpx';
  } else if (ext === 'kml' || mime === 'application/vnd.google-earth.kml+xml') {
    format = 'kml';
  } else if (ext === 'xml' || mime === 'application/xml' || mime === 'text/xml') {
    format = 'xml';
  } else if (ext === 'log') {
    format = 'log';
  } else if (['txt', 'text'].includes(ext) || mime.startsWith('text/')) {
    format = 'txt';
  }

  const isStandardImage = [
    'jpg',
    'png',
    'webp',
    'gif',
    'bmp',
    'avif',
    'heic',
    'jxl',
    'svg',
  ].includes(format);

  const isAnyImage = isStandardImage || format === 'ico' || format === 'tiff' || format === 'image-other';

  const isVideo = [
    'mp4',
    'webm-video',
    'mov',
    'mkv',
    'avi',
    'flv',
    'ts',
    '3gp',
    'wmv',
    'ogv',
    'video-other',
  ].includes(format);

  const isAudio = [
    'mp3',
    'wav',
    'm4a',
    'flac',
    'ogg',
    'opus',
    'aiff',
    'wma',
    'webm-audio',
    'audio-other',
  ].includes(format);

  return {
    ext,
    mime,
    format,
    isStandardImage,
    isAnyImage,
    isVideo,
    isAudio,
    isPdf: format === 'pdf',
    isDocx: format === 'docx',
    isXlsx: format === 'xlsx',
    isPptx: format === 'pptx',
    isLegacyOffice: format === 'legacy-office',
    isHtml: format === 'html',
    isMhtml: format === 'mhtml',
    isCss: format === 'css',
    isJson: format === 'json',
    isCsv: format === 'csv',
    isTsv: format === 'tsv',
    isTxt: format === 'txt',
    isLog: format === 'log',
    isGpx: format === 'gpx',
    isKml: format === 'kml',
  };
}

const EXCLUDED_GENERATORS = new Set([
  'img-hex-rgb-converter',
  'img-color-contrast',
  'img-qr-code-generator',
  'img-barcode-generator',
  'img-label-designer',
  'pdf-scan-to-pdf',
]);

const FILE_CONVERTER_FORMATS = new Set<CanonicalFormat>([
  'jpg',
  'png',
  'webp',
  'gif',
  'bmp',
  'ico',
  'avif',
  'heic',
  'jxl',
  'svg',
  'tiff',
  'mp4',
  'webm-video',
  'mkv',
  'mov',
  'avi',
  'flv',
  'ts',
  '3gp',
  'wmv',
  'ogv',
  'mp3',
  'm4a',
  'wav',
  'flac',
  'ogg',
  'opus',
  'aiff',
  'wma',
  'webm-audio',
  'pdf',
  'docx',
  'json',
  'csv',
  'tsv',
  'txt',
]);

const VIDEO_CONTAINERS = new Set<CanonicalFormat>(['mp4', 'mov', 'webm-video', 'mkv', 'avi']);

const EXIF_VIEWER_FORMATS = new Set<CanonicalFormat>(['jpg', 'heic', 'png', 'webp', 'tiff']);

/** Checks whether a tool is eligible to accept a single file. */
export function isToolEligibleForFile(tool: ToolMeta, file: File): boolean {
  if (EXCLUDED_GENERATORS.has(tool.id)) return false;

  const c = classifyFile(file);

  // Universal File Inspector
  if (tool.id === 'file-inspector') return true;

  // Batch rename is only for multiple files
  if (tool.id === 'batch-rename') return false;

  // File Converter (general multi-output converter)
  if (tool.id === 'file-converter') {
    return FILE_CONVERTER_FORMATS.has(c.format);
  }

  // 1. Audio / Speech tools
  if (['video-to-text', 'subtitles', 'video-info', 'media-speed'].includes(tool.id)) {
    return c.isVideo || c.isAudio;
  }

  // 2. Video container health
  if (tool.id === 'video-health') {
    return VIDEO_CONTAINERS.has(c.format);
  }

  // 3. Other Video Tools (single video)
  if (tool.media === 'video') {
    if (tool.id === 'merge') return false; // min 2
    if (tool.id === 'text-behind-image') return c.isStandardImage;
    return c.isVideo;
  }

  // 4. PDF Tools
  if (tool.media === 'pdf') {
    // Multi-PDF tools
    if (tool.id === 'pdf-merge' || tool.id === 'pdf-compare') return false;

    // Convert to PDF
    if (tool.id === 'pdf-word-to-pdf') return c.isDocx;
    if (tool.id === 'pdf-excel-to-pdf') return c.isXlsx;
    if (tool.id === 'pdf-powerpoint-to-pdf') return c.isPptx;
    if (tool.id === 'pdf-html-to-pdf') return c.isHtml;
    if (tool.id === 'pdf-jpg-to-pdf') return c.format === 'jpg';

    // Single-file PDF tools require PDF input
    return c.isPdf;
  }

  // 5. Image Tools
  if (tool.media === 'image') {
    // PDF inputs
    if (['img-pdf-to-image', 'img-extract-pdf-images'].includes(tool.id)) {
      return c.isPdf;
    }

    // Word inputs
    if (['img-docx-to-jpg', 'img-docx-to-png'].includes(tool.id)) {
      return c.isDocx;
    }

    // Batch-only image tools
    if (['img-bulk-resize', 'img-bulk-compress', 'img-bulk-convert', 'img-merge', 'img-collage'].includes(tool.id)) {
      return false;
    }

    // Directional image converters
    if (tool.id === 'img-png-to-jpg') return c.format === 'png';
    if (tool.id === 'img-jpg-to-png') return c.format === 'jpg';
    if (tool.id === 'img-webp-to-jpg' || tool.id === 'img-webp-to-png') return c.format === 'webp';
    if (tool.id === 'img-heic-to-jpg') return c.format === 'heic';
    if (tool.id === 'img-svg-to-png') return c.format === 'svg';

    // Fixed-target WebP converter: not for WebP
    if (tool.id === 'img-image-to-webp') return c.isStandardImage && c.format !== 'webp';

    // Raster to SVG: not for SVG
    if (tool.id === 'img-image-to-svg') return c.isStandardImage && c.format !== 'svg';

    // EXIF viewer: only JPEG, HEIC, PNG, WebP, TIFF
    if (tool.id === 'img-exif-viewer') return EXIF_VIEWER_FORMATS.has(c.format);

    // EXIF remover & Photo to Sketch: not for vector SVG
    if (tool.id === 'img-exif-remover') return c.isStandardImage && c.format !== 'svg';
    if (tool.id === 'img-photo-to-sketch') return c.isStandardImage && c.format !== 'svg';

    // Icon converter: ICO or raster images
    if (tool.id === 'img-icon-converter') return c.format === 'ico' || ['jpg', 'png', 'webp'].includes(c.format);

    // ICO only supports icon-converter, file-converter, file-inspector
    if (c.format === 'ico') return false;

    // TIFF only supports exif-viewer, file-converter, file-inspector
    if (c.format === 'tiff') return false;

    // General standard image tools
    return c.isStandardImage;
  }

  // 6. File Tools (MHTML, GPX/KML, CSS, CSV, JSON, TXT)
  if (tool.id === 'mhtml-to-html') return c.isMhtml;
  if (tool.id === 'gpx-kml') return c.isGpx || c.isKml;
  if (tool.id === 'css-viewer') return c.isCss;
  if (tool.id === 'json-csv') return c.isJson || c.isCsv || c.isTsv;
  if (tool.id === 'csv-viewer') return c.isCsv || c.isTsv || c.isTxt;
  if (tool.id === 'txt-to-csv') return c.isTxt || c.isLog || c.isTsv;

  return false;
}

/** Checks whether a tool is eligible to accept a multi-file batch. */
export function isToolEligibleForBatch(tool: ToolMeta, files: File[]): boolean {
  if (files.length <= 1) return false;
  if (EXCLUDED_GENERATORS.has(tool.id)) return false;

  const count = files.length;
  const classes = files.map(classifyFile);

  // Batch rename is valid for ANY batch of files
  if (tool.id === 'batch-rename') return true;

  // PDF Merge (min 2 PDFs)
  if (tool.id === 'pdf-merge') {
    return count >= 2 && classes.every((c) => c.isPdf);
  }

  // PDF Compare (exactly 2 PDFs)
  if (tool.id === 'pdf-compare') {
    return count === 2 && classes.every((c) => c.isPdf);
  }

  // Video Merge (min 2 videos)
  if (tool.id === 'merge' && tool.media === 'video') {
    return count >= 2 && classes.every((c) => c.isVideo);
  }

  // JSON <-> CSV (batches must share direction: either all JSON, or all CSV/TSV)
  if (tool.id === 'json-csv') {
    const allJson = classes.every((c) => c.isJson);
    const allCsvTsv = classes.every((c) => c.isCsv || c.isTsv);
    return allJson || allCsvTsv;
  }

  // Image Multi-file Tools
  const allStandardImages = classes.every((c) => c.isStandardImage);

  if (tool.id === 'img-merge') {
    return count >= 2 && allStandardImages;
  }

  if (tool.id === 'img-collage') {
    return count >= 2 && count <= 9 && allStandardImages;
  }

  if (
    tool.id === 'img-bulk-convert' ||
    tool.id === 'img-bulk-resize' ||
    tool.id === 'img-bulk-compress' ||
    tool.id === 'img-image-to-pdf' ||
    tool.id === 'img-screenshot-to-pdf' ||
    tool.id === 'img-watermark'
  ) {
    return allStandardImages;
  }

  if (tool.id === 'pdf-jpg-to-pdf') {
    return classes.every((c) => c.format === 'jpg');
  }

  if (tool.id === 'img-exif-remover') {
    return classes.every((c) => c.isStandardImage && c.format !== 'svg');
  }

  if (tool.id === 'img-icon-converter') {
    const allIco = classes.every((c) => c.format === 'ico');
    const allRaster = classes.every((c) => ['jpg', 'png', 'webp'].includes(c.format));
    return allIco || allRaster;
  }

  // All other single-file tools cannot consume batches
  return false;
}
