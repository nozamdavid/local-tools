import { fileTypeFromBuffer } from 'file-type';

export type FormatFamily = 'image' | 'video' | 'audio' | 'document' | 'text' | 'unknown';

export interface DetectedFormat {
  id: string;
  label: string;
  family: FormatFamily;
  mime: string;
  ext: string;
  extensionMismatch: boolean;
  actualExtension: string;
}

const FORMAT_METAS: Record<string, { label: string; family: FormatFamily; mime: string; ext: string; aliases: string[] }> = {
  // Images
  png: { label: 'PNG Image', family: 'image', mime: 'image/png', ext: 'png', aliases: ['png'] },
  jpg: { label: 'JPEG Image', family: 'image', mime: 'image/jpeg', ext: 'jpg', aliases: ['jpg', 'jpeg', 'jpe', 'jif', 'jfif'] },
  webp: { label: 'WebP Image', family: 'image', mime: 'image/webp', ext: 'webp', aliases: ['webp'] },
  gif: { label: 'GIF Image', family: 'image', mime: 'image/gif', ext: 'gif', aliases: ['gif'] },
  bmp: { label: 'BMP Image', family: 'image', mime: 'image/bmp', ext: 'bmp', aliases: ['bmp', 'dib'] },
  tiff: { label: 'TIFF Image', family: 'image', mime: 'image/tiff', ext: 'tiff', aliases: ['tiff', 'tif'] },
  ico: { label: 'ICO Icon', family: 'image', mime: 'image/x-icon', ext: 'ico', aliases: ['ico', 'cur'] },
  avif: { label: 'AVIF Image', family: 'image', mime: 'image/avif', ext: 'avif', aliases: ['avif'] },
  heic: { label: 'HEIC Image', family: 'image', mime: 'image/heic', ext: 'heic', aliases: ['heic', 'heif'] },
  jxl: { label: 'JPEG XL Image', family: 'image', mime: 'image/jxl', ext: 'jxl', aliases: ['jxl'] },
  svg: { label: 'SVG Image', family: 'image', mime: 'image/svg+xml', ext: 'svg', aliases: ['svg', 'svgz'] },

  // Video
  mp4: { label: 'MP4 Video', family: 'video', mime: 'video/mp4', ext: 'mp4', aliases: ['mp4', 'm4v'] },
  webm: { label: 'WebM Video', family: 'video', mime: 'video/webm', ext: 'webm', aliases: ['webm'] },
  mkv: { label: 'MKV Video', family: 'video', mime: 'video/x-matroska', ext: 'mkv', aliases: ['mkv'] },
  mov: { label: 'MOV Video', family: 'video', mime: 'video/quicktime', ext: 'mov', aliases: ['mov', 'qt'] },
  avi: { label: 'AVI Video', family: 'video', mime: 'video/x-msvideo', ext: 'avi', aliases: ['avi'] },
  flv: { label: 'FLV Video', family: 'video', mime: 'video/x-flv', ext: 'flv', aliases: ['flv'] },
  ts: { label: 'MPEG-TS Video', family: 'video', mime: 'video/mp2t', ext: 'ts', aliases: ['ts', 'm2ts', 'mts'] },
  '3gp': { label: '3GP Video', family: 'video', mime: 'video/3gpp', ext: '3gp', aliases: ['3gp', '3g2'] },
  wmv: { label: 'WMV Video', family: 'video', mime: 'video/x-ms-wmv', ext: 'wmv', aliases: ['wmv', 'asf'] },
  ogv: { label: 'OGV Video', family: 'video', mime: 'video/ogg', ext: 'ogv', aliases: ['ogv'] },

  // Audio
  mp3: { label: 'MP3 Audio', family: 'audio', mime: 'audio/mpeg', ext: 'mp3', aliases: ['mp3'] },
  m4a: { label: 'M4A Audio', family: 'audio', mime: 'audio/mp4', ext: 'm4a', aliases: ['m4a', 'aac'] },
  wav: { label: 'WAV Audio', family: 'audio', mime: 'audio/wav', ext: 'wav', aliases: ['wav'] },
  flac: { label: 'FLAC Audio', family: 'audio', mime: 'audio/flac', ext: 'flac', aliases: ['flac'] },
  ogg: { label: 'OGG Audio', family: 'audio', mime: 'audio/ogg', ext: 'ogg', aliases: ['ogg', 'oga'] },
  opus: { label: 'Opus Audio', family: 'audio', mime: 'audio/opus', ext: 'opus', aliases: ['opus'] },
  aiff: { label: 'AIFF Audio', family: 'audio', mime: 'audio/aiff', ext: 'aiff', aliases: ['aiff', 'aif'] },
  wma: { label: 'WMA Audio', family: 'audio', mime: 'audio/x-ms-wma', ext: 'wma', aliases: ['wma', 'asf'] },
  'webm-audio': { label: 'WebM Audio', family: 'audio', mime: 'audio/webm', ext: 'webm', aliases: ['webm', 'weba'] },

  // Documents
  pdf: { label: 'PDF Document', family: 'document', mime: 'application/pdf', ext: 'pdf', aliases: ['pdf'] },
  docx: {
    label: 'Word Document (DOCX)',
    family: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
    aliases: ['docx'],
  },

  // Text
  json: { label: 'JSON Document', family: 'text', mime: 'application/json', ext: 'json', aliases: ['json'] },
  csv: { label: 'CSV Document', family: 'text', mime: 'text/csv', ext: 'csv', aliases: ['csv'] },
  tsv: { label: 'TSV Document', family: 'text', mime: 'text/tab-separated-values', ext: 'tsv', aliases: ['tsv'] },
  txt: { label: 'Plain Text', family: 'text', mime: 'text/plain', ext: 'txt', aliases: ['txt', 'text'] },
};

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

function isJxlHeader(uint8: Uint8Array): boolean {
  // Raw codestream magic FF 0A
  if (uint8.length >= 2 && uint8[0] === 0xff && uint8[1] === 0x0a) {
    return true;
  }
  // 12-byte container signature 00 00 00 0C 4A 58 4C 20 0D 0A 87 0A
  if (
    uint8.length >= 12 &&
    uint8[0] === 0x00 &&
    uint8[1] === 0x00 &&
    uint8[2] === 0x00 &&
    uint8[3] === 0x0c &&
    uint8[4] === 0x4a && // 'J'
    uint8[5] === 0x58 && // 'X'
    uint8[6] === 0x4c && // 'L'
    uint8[7] === 0x20 && // ' '
    uint8[8] === 0x0d && // '\r'
    uint8[9] === 0x0a && // '\n'
    uint8[10] === 0x87 &&
    uint8[11] === 0x0a // '\n'
  ) {
    return true;
  }
  return false;
}

function checkFtypBrand(uint8: Uint8Array): 'avif' | 'heic' | null {
  if (uint8.length < 16) return null;
  // bytes 4..7 must be 'ftyp'
  const isFtyp = uint8[4] === 0x66 && uint8[5] === 0x74 && uint8[6] === 0x79 && uint8[7] === 0x70;
  if (!isFtyp) return null;

  const headerSlice = new TextDecoder('ascii').decode(uint8.slice(8, Math.min(uint8.length, 64)));
  if (headerSlice.includes('avif') || headerSlice.includes('avis')) {
    return 'avif';
  }
  if (
    headerSlice.includes('heic') ||
    headerSlice.includes('heix') ||
    headerSlice.includes('hevc') ||
    headerSlice.includes('hevx') ||
    headerSlice.includes('mif1') ||
    headerSlice.includes('msf1')
  ) {
    return 'heic';
  }
  return null;
}

function checkSvg(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes('<svg')) return false;
  try {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (root && root.nodeName.toLowerCase() === 'svg' && !doc.querySelector('parsererror')) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function checkJson(text: string): boolean {
  const trimmed = text.trim();
  if ((!trimmed.startsWith('{') && !trimmed.startsWith('[')) || (!trimmed.endsWith('}') && !trimmed.endsWith(']'))) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

function checkCsvOrTsv(text: string): 'csv' | 'tsv' | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 10);

  if (lines.length < 2) return null;

  for (const delim of ['\t', ',', ';'] as const) {
    const counts = lines.map((line) => {
      let count = 0;
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === delim && !inQuotes) count++;
      }
      return count;
    });

    const first = counts[0];
    if (first > 0 && counts.every((c) => c === first)) {
      return delim === '\t' ? 'tsv' : 'csv';
    }
  }
  return null;
}

function checkPlainText(uint8: Uint8Array): boolean {
  if (uint8.length === 0) return true;
  for (let i = 0; i < Math.min(uint8.length, 8192); i++) {
    const byte = uint8[i];
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(uint8.slice(0, 8192));
    return true;
  } catch {
    return false;
  }
}

async function checkDocx(file: File): Promise<boolean> {
  try {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(file);
    return !!zip.file('word/document.xml');
  } catch {
    return false;
  }
}

async function probeStreamsWithFFmpeg(file: File): Promise<{ hasVideo: boolean; hasAudio: boolean }> {
  try {
    const { getFFmpeg } = await import('../../lib/ffmpeg');
    const ffmpeg = await getFFmpeg();
    const logLines: string[] = [];
    const handleLog = ({ message }: { message: string }) => {
      logLines.push(message);
    };
    ffmpeg.on('log', handleLog);
    const inputName = `probe_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`;
    try {
      const buffer = await file.arrayBuffer();
      await ffmpeg.writeFile(inputName, new Uint8Array(buffer));
      await ffmpeg.exec(['-hide_banner', '-i', inputName]);
    } catch {
      // Expected: ffmpeg exits with code 1 because no output file was specified
    } finally {
      try {
        await ffmpeg.deleteFile(inputName);
      } catch {
        /* ignore */
      }
      ffmpeg.off('log', handleLog);
    }
    const hasVideo = logLines.some((l) => /Stream #.*:\s*Video:/i.test(l) && !/attached pic/i.test(l));
    const hasAudio = logLines.some((l) => /Stream #.*:\s*Audio:/i.test(l));
    return { hasVideo, hasAudio };
  } catch {
    return { hasVideo: false, hasAudio: false };
  }
}

export async function detectFormat(file: File): Promise<DetectedFormat> {
  const actualExt = getFileExtension(file.name);
  const headSlice = file.slice(0, 65536);
  const headBuffer = await headSlice.arrayBuffer();
  const uint8 = new Uint8Array(headBuffer);

  let rawId: string | null = null;

  // 0. Check JXL signature (raw codestream FF 0A or 12-byte container)
  if (isJxlHeader(uint8)) {
    rawId = 'jxl';
  }

  // 1. Check FTYP brands (HEIC / AVIF)
  if (!rawId) {
    const ftypBrand = checkFtypBrand(uint8);
    if (ftypBrand) {
      rawId = ftypBrand;
    }
  }

  // 2. Sniff via file-type
  if (!rawId) {
    const ftResult = await fileTypeFromBuffer(uint8);
    if (ftResult) {
      const ext = ftResult.ext.toLowerCase();
      if (ext === 'tif') rawId = 'tiff';
      else if (ext === 'jpg' || ext === 'jpeg') rawId = 'jpg';
      else if (ext === 'aif' || ext === 'aiff') rawId = 'aiff';
      else if (ext === 'zip' || ext === 'docx') {
        const isDocx = await checkDocx(file);
        if (isDocx) rawId = 'docx';
        else rawId = ext;
      } else {
        rawId = ext;
      }
    }
  }

  // 3. Ambiguous audio vs video containers (mp4, m4a, webm, mkv, ogg, mov, asf)
  if (rawId && ['mp4', 'm4a', 'webm', 'mkv', 'ogg', 'mov', 'asf'].includes(rawId)) {
    const { hasVideo, hasAudio } = await probeStreamsWithFFmpeg(file);
    if (rawId === 'asf') {
      rawId = hasVideo ? 'wmv' : 'wma';
    } else if (rawId === 'ogg') {
      rawId = hasVideo ? 'ogv' : 'ogg';
    } else if (rawId === 'webm') {
      rawId = hasVideo ? 'webm' : 'webm-audio';
    } else if (rawId === 'mp4' || rawId === 'm4a' || rawId === 'mov') {
      if (!hasVideo && hasAudio) {
        rawId = 'm4a';
      } else {
        rawId = rawId === 'mov' ? 'mov' : 'mp4';
      }
    }
  }

  // 4. Content checks for formats not covered by file-type (SVG, JSON, CSV/TSV, TXT)
  if (!rawId || rawId === 'xml' || rawId === 'zip') {
    // If ZIP and wasn't confirmed as docx earlier, check DOCX again
    if (rawId === 'zip' || (uint8[0] === 0x50 && uint8[1] === 0x4b && uint8[2] === 0x03 && uint8[3] === 0x04)) {
      const isDocx = await checkDocx(file);
      if (isDocx) rawId = 'docx';
    }

    if (!rawId || rawId === 'xml') {
      let headText = '';
      try {
        headText = new TextDecoder('utf-8', { fatal: false }).decode(uint8);
      } catch {
        /* ignore */
      }

      if (headText) {
        if (checkSvg(headText)) {
          rawId = 'svg';
        } else if (rawId === 'xml') {
          rawId = 'txt';
        } else if (file.size < 5000000 && checkJson(await file.text())) {
          rawId = 'json';
        } else {
          const csvTsv = checkCsvOrTsv(headText);
          if (csvTsv) {
            rawId = csvTsv;
          } else if (checkPlainText(uint8)) {
            rawId = 'txt';
          }
        }
      } else if (rawId === 'xml') {
        rawId = 'txt';
      }
    }
  }

  // Fallback / Unknown format
  const meta = rawId && FORMAT_METAS[rawId] ? FORMAT_METAS[rawId] : null;

  if (!meta) {
    const isMismatch = Boolean(rawId && rawId !== 'unknown' && actualExt.length > 0 && actualExt !== rawId);
    return {
      id: rawId || 'unknown',
      label: rawId ? `${rawId.toUpperCase()} File` : 'Unknown Format',
      family: 'unknown',
      mime: file.type || 'application/octet-stream',
      ext: rawId || '',
      extensionMismatch: isMismatch,
      actualExtension: actualExt,
    };
  }

  const isMismatch = actualExt.length > 0 && !meta.aliases.includes(actualExt);

  return {
    id: rawId!,
    label: meta.label,
    family: meta.family,
    mime: meta.mime,
    ext: meta.ext,
    extensionMismatch: isMismatch,
    actualExtension: actualExt,
  };
}
