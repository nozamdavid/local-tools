import { getToolMeta, TOOL_METAS, type ToolMeta } from '../tools/registry';
import { classifyFile, extensionOf, isToolEligibleForBatch, isToolEligibleForFile, mimeOf } from './toolInputs';

export { extensionOf };

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

/** Non-consuming: returns pending files for lazy initializers without consuming them. */
export function peekPendingFiles(path: string): File[] | null {
  if (!pending || pending.path !== path || Date.now() - pending.at > MAX_AGE_MS) return null;
  return pending.files;
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

/** Mirrors the browser's <input accept> rules: extensions, exact MIME types and type/* wildcards. */
export function matchesAccept(file: File, accept?: string): boolean {
  if (!accept || accept.trim() === '' || accept.trim() === '*') return true;
  const ext = `.${extensionOf(file.name)}`;
  const mime = mimeOf(file);
  const c = classifyFile(file);

  return accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .some((token) => {
      if (!token) return false;
      if (token === '*' || token === '*/*') return true;
      if (token.startsWith('.')) {
        if (token === ext) return true;
        if (c.is3d && token === `.${c.format}`) return true;
        if (c.isDocx && token === '.docx') return true;
        return false;
      }
      if (token.endsWith('/*')) {
        if (token === 'model/*') return c.is3d;
        if (mime.startsWith(token.slice(0, -1))) return true;
        return false;
      }
      if (token === mime) return true;
      if (c.isDocx && token === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return true;
      if (c.format === 'obj' && (token === 'model/obj' || token === 'text/obj' || token === 'application/x-tgif')) return true;
      if (c.format === 'stl' && (token === 'model/stl' || token === 'application/sla')) return true;
      if (
        c.format === 'step' &&
        (token === 'model/step' || token === 'application/step' || token === 'model/x-step' || token === 'model/x.step')
      )
        return true;
      if (
        c.format === 'iges' &&
        (token === 'model/iges' || token === 'application/iges' || token === 'model/x-iges' || token === 'model/x.iges')
      )
        return true;
      if (c.format === 'brep' && (token === 'model/brep' || token === 'model/x-brep' || token === 'application/x-brep')) return true;
      if (c.format === '3mf' && (token === 'model/3mf' || token === 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml')) return true;
      return false;
    });
}

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'word' | 'excel' | 'powerpoint' | 'web' | 'data' | 'text' | '3d' | 'other';

export function fileKind(file: File): FileKind {
  const c = classifyFile(file);
  if (c.is3d) return '3d';
  if (c.isPdf) return 'pdf';
  // ODB (database) and OXT (extension package) are not word category
  if (c.ext === 'odb') return 'data';
  if (c.ext === 'oxt') return 'other';
  if (['vsd', 'vsdx', 'pub'].includes(c.ext)) return 'other';
  if (c.isDocx || ['doc', 'dot', 'rtf', 'wps', 'odt', 'ott', 'odm', 'fodt'].includes(c.ext)) return 'word';
  if (c.isXlsx || ['xls', 'xlt', 'ods', 'ots', 'fods'].includes(c.ext)) return 'excel';
  if (c.isPptx || ['ppt', 'pps', 'odp', 'otp', 'fodp'].includes(c.ext)) return 'powerpoint';
  if (c.isHtml || c.isMhtml || c.isCss) return 'web';
  if (c.isJson || c.isCsv || c.isTsv || c.isGpx || c.isKml) return 'data';
  if (c.isAnyImage) return 'image';
  if (c.isVideo) return 'video';
  if (c.isAudio) return 'audio';
  if (c.isTxt || c.isLog) return 'text';
  return 'other';
}

/** Checks whether a tool is eligible to accept the given file. */
export function isToolEligible(toolId: string, file: File): boolean {
  const meta = getToolMeta(toolId);
  return isToolEligibleForFile(meta, file);
}

const THREE_SINGLE_TOOLS = ['three-convert', 'three-simplify', 'three-inspect', 'three-transform', 'three-normals', 'three-split'];

/** Primary format-specific tools to rank first for single files. */
const PRIMARY_SINGLE_TOOLS: Record<string, string[]> = {
  png: ['img-png-to-jpg'],
  jpg: ['img-jpg-to-png', 'pdf-jpg-to-pdf'],
  webp: ['img-webp-to-jpg', 'img-webp-to-png'],
  heic: ['img-heic-to-jpg', 'img-exif-viewer'],
  svg: ['img-svg-to-png'],
  ico: ['img-icon-converter', 'file-converter'],
  tiff: ['img-exif-viewer', 'img-exif-remover', 'file-converter'],

  mp4: ['video-health', 'convert', 'compress', 'trim', 'video-info'],
  mov: ['video-health', 'convert', 'compress', 'trim', 'video-info'],
  'webm-video': ['video-health', 'convert', 'compress', 'trim', 'video-info'],
  mkv: ['video-health', 'convert', 'compress', 'trim', 'video-info'],
  avi: ['video-health', 'convert', 'compress', 'trim', 'video-info'],

  mp3: ['video-to-text', 'subtitles', 'video-info', 'media-speed', 'file-converter'],
  wav: ['video-to-text', 'subtitles', 'video-info', 'media-speed', 'file-converter'],
  m4a: ['video-to-text', 'subtitles', 'video-info', 'media-speed', 'file-converter'],
  ogg: ['video-to-text', 'subtitles', 'video-info', 'media-speed', 'file-converter'],
  opus: ['video-to-text', 'subtitles', 'video-info', 'media-speed', 'file-converter'],
  flac: ['video-to-text', 'subtitles', 'video-info', 'media-speed', 'file-converter'],
  aiff: ['video-to-text', 'subtitles', 'video-info', 'media-speed', 'file-converter'],
  wma: ['video-to-text', 'subtitles', 'video-info', 'media-speed', 'file-converter'],
  'webm-audio': ['video-to-text', 'subtitles', 'video-info', 'media-speed', 'file-converter'],

  pdf: ['pdf-split', 'pdf-compress', 'pdf-pdf-to-jpg', 'pdf-pdf-to-word', 'img-pdf-to-image'],

  docx: ['pdf-word-to-pdf', 'img-docx-to-jpg', 'img-docx-to-png', 'file-converter'],
  xlsx: ['pdf-excel-to-pdf', 'file-converter'],
  pptx: ['pdf-powerpoint-to-pdf', 'file-converter'],
  opendocument: ['file-converter', 'file-inspector'],
  'legacy-office': ['file-converter', 'file-inspector'],
  epub: ['file-converter', 'file-inspector'],
  vsdx: ['file-converter', 'file-inspector'],

  stl: THREE_SINGLE_TOOLS,
  obj: THREE_SINGLE_TOOLS,
  ply: THREE_SINGLE_TOOLS,
  '3mf': THREE_SINGLE_TOOLS,
  step: THREE_SINGLE_TOOLS,
  iges: THREE_SINGLE_TOOLS,
  brep: THREE_SINGLE_TOOLS,

  html: ['pdf-html-to-pdf'],
  mhtml: ['mhtml-to-html'],
  css: ['css-viewer'],
  json: ['json-csv', 'file-converter'],
  csv: ['csv-viewer', 'json-csv', 'file-converter'],
  tsv: ['csv-viewer', 'txt-to-csv', 'json-csv', 'file-converter'],
  txt: ['txt-to-csv', 'csv-viewer', 'file-converter'],
  log: ['txt-to-csv'],
  gpx: ['gpx-kml'],
  kml: ['gpx-kml'],

  unknown: ['file-inspector'],
};

/** Tools that can open the given files, best matches first. */
export function suggestToolsForFiles(files: File[]): ToolMeta[] {
  if (files.length === 0) return [];

  const ids: string[] = [];
  const push = (id: string) => {
    if (!ids.includes(id) && TOOL_METAS.some((t) => t.id === id)) {
      ids.push(id);
    }
  };

  // Multiple files
  if (files.length > 1) {
    const eligible = TOOL_METAS.filter((t) => isToolEligibleForBatch(t, files));
    const eligibleIds = new Set(eligible.map((t) => t.id));

    // High priority batch operations per domain
    const batchPriority = [
      'pdf-merge',
      'pdf-compare',
      'merge',
      'three-merge',
      'img-bulk-convert',
      'img-icon-converter',
      'img-image-to-pdf',
      'pdf-jpg-to-pdf',
      'img-bulk-resize',
      'img-bulk-compress',
      'img-merge',
      'img-collage',
      'json-csv',
    ];

    batchPriority.filter((id) => eligibleIds.has(id)).forEach(push);

    // batch-rename is always promoted into top 12 for multi-file selections
    if (eligibleIds.has('batch-rename')) {
      push('batch-rename');
    }

    // Other eligible batch tools
    eligible.forEach((t) => push(t.id));

    return ids.map((id) => getToolMeta(id));
  }

  // Single file
  const file = files[0];
  const c = classifyFile(file);
  const eligible = TOOL_METAS.filter((t) => isToolEligibleForFile(t, file));
  const eligibleIds = new Set(eligible.map((t) => t.id));

  // 1. Primary format-specific tools first
  (PRIMARY_SINGLE_TOOLS[c.format] ?? []).filter((id) => eligibleIds.has(id)).forEach(push);
  if (c.isStandardImage) push('img-icon-converter');

  // 2. Popular eligible tools
  eligible.filter((t) => t.popular && t.id !== 'file-converter' && t.id !== 'file-inspector').forEach((t) => push(t.id));

  // 3. Remaining eligible category tools
  eligible.filter((t) => t.id !== 'file-converter' && t.id !== 'file-inspector').forEach((t) => push(t.id));

  // 4. Generic file-converter if eligible and supported
  if (eligibleIds.has('file-converter')) push('file-converter');

  // 5. Universal file-inspector fallback
  if (eligibleIds.has('file-inspector')) push('file-inspector');

  return ids.map((id) => getToolMeta(id));
}
