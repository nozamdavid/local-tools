import type { FormatFamily, DetectedFormat } from './detect';
import { checkAvifSupport } from '../image/_convert/convert';

export interface TargetFormat {
  id: string;
  label: string;
  family: FormatFamily;
  ext: string;
  description?: string;
}

export async function isAnimatedGif(file: File): Promise<boolean> {
  const slice = file.slice(0, 1024 * 1024);
  const buf = new Uint8Array(await slice.arrayBuffer());
  if (buf.length < 6) return false;
  // Check 'GIF87a' or 'GIF89a'
  if (buf[0] !== 0x47 || buf[1] !== 0x49 || buf[2] !== 0x46) return false;

  let gceCount = 0;
  for (let i = 0; i < buf.length - 1; i++) {
    // 0x21 0xF9 is Graphic Control Extension
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9) {
      gceCount++;
      if (gceCount > 1) return true;
    }
  }
  return false;
}

const ALL_TARGETS: Record<string, TargetFormat> = {
  // Images
  jpg: { id: 'jpg', label: 'JPG', family: 'image', ext: 'jpg', description: 'Compressed JPEG image' },
  png: { id: 'png', label: 'PNG', family: 'image', ext: 'png', description: 'Lossless PNG image' },
  webp: { id: 'webp', label: 'WebP', family: 'image', ext: 'webp', description: 'Modern WebP image' },
  gif: { id: 'gif', label: 'GIF', family: 'image', ext: 'gif', description: 'Animated or static GIF' },
  bmp: { id: 'bmp', label: 'BMP', family: 'image', ext: 'bmp', description: 'Uncompressed bitmap' },
  ico: { id: 'ico', label: 'ICO', family: 'image', ext: 'ico', description: 'Website favicon icon' },
  avif: { id: 'avif', label: 'AVIF', family: 'image', ext: 'avif', description: 'Next-gen AV1 image' },
  jxl: { id: 'jxl', label: 'JXL', family: 'image', ext: 'jxl', description: 'Next-generation JPEG XL' },

  // Video
  mp4: { id: 'mp4', label: 'MP4', family: 'video', ext: 'mp4', description: 'Universal H.264/AAC video' },
  webm: { id: 'webm', label: 'WebM', family: 'video', ext: 'webm', description: 'Open VP8/Opus video' },
  mov: { id: 'mov', label: 'MOV', family: 'video', ext: 'mov', description: 'Apple QuickTime video' },
  mkv: { id: 'mkv', label: 'MKV', family: 'video', ext: 'mkv', description: 'Matroska video container' },
  avi: { id: 'avi', label: 'AVI', family: 'video', ext: 'avi', description: 'Classic AVI video' },

  // Audio
  mp3: { id: 'mp3', label: 'MP3', family: 'audio', ext: 'mp3', description: 'Universal MP3 audio' },
  m4a: { id: 'm4a', label: 'M4A', family: 'audio', ext: 'm4a', description: 'AAC audio in MP4 container' },
  wav: { id: 'wav', label: 'WAV', family: 'audio', ext: 'wav', description: 'Uncompressed PCM audio' },
  ogg: { id: 'ogg', label: 'OGG', family: 'audio', ext: 'ogg', description: 'Vorbis audio' },
  flac: { id: 'flac', label: 'FLAC', family: 'audio', ext: 'flac', description: 'Lossless audio' },
  opus: { id: 'opus', label: 'Opus', family: 'audio', ext: 'opus', description: 'High-efficiency Opus audio' },

  // Documents
  pdf: { id: 'pdf', label: 'PDF', family: 'document', ext: 'pdf', description: 'Portable Document Format' },
  html: { id: 'html', label: 'HTML', family: 'document', ext: 'html', description: 'Standalone HTML page' },

  // Text
  csv: { id: 'csv', label: 'CSV', family: 'text', ext: 'csv', description: 'Comma-separated values' },
  tsv: { id: 'tsv', label: 'TSV', family: 'text', ext: 'tsv', description: 'Tab-separated values' },
  json: { id: 'json', label: 'JSON', family: 'text', ext: 'json', description: 'Formatted JSON data' },
  txt: { id: 'txt', label: 'TXT', family: 'text', ext: 'txt', description: 'Plain text extract' },
};

export async function getTargetFormats(detected: DetectedFormat, file?: File): Promise<Record<FormatFamily, TargetFormat[]>> {
  const result: Record<FormatFamily, TargetFormat[]> = {
    image: [],
    video: [],
    audio: [],
    document: [],
    text: [],
    unknown: [],
  };

  const add = (id: string) => {
    const target = ALL_TARGETS[id];
    if (target && !result[target.family].some((t) => t.id === target.id)) {
      result[target.family].push(target);
    }
  };

  const hasAvif = await checkAvifSupport();
  const inputId = detected.id;

  // 1. Images (jpg, png, webp, gif, bmp, avif, heic, jxl, svg, ico, tiff)
  if (detected.family === 'image') {
    if (inputId === 'svg') {
      add('png');
      add('jpg');
      add('webp');
      add('jxl');
      add('pdf');
    } else {
      const standardImages = ['jpg', 'png', 'webp', 'gif', 'bmp', 'ico', 'jxl'];
      if (hasAvif) standardImages.push('avif');
      for (const fmt of standardImages) {
        if (fmt !== inputId) add(fmt);
      }
      add('pdf');

      // Animated GIF can also convert to MP4 and WebM
      if (inputId === 'gif' && file) {
        const animated = await isAnimatedGif(file);
        if (animated) {
          add('mp4');
          add('webm');
        }
      }
    }
  }

  // 2. Video (mp4, mov, webm, mkv, avi, flv, ts, 3gp, wmv, ogv)
  else if (detected.family === 'video') {
    const videoTargets = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'gif'];
    for (const fmt of videoTargets) {
      if (fmt !== inputId) add(fmt);
    }
    const audioTargets = ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'opus'];
    for (const fmt of audioTargets) {
      add(fmt);
    }
  }

  // 3. Audio (mp3, wav, flac, ogg, opus, m4a, aiff, wma, webm-audio)
  else if (detected.family === 'audio') {
    const audioTargets = ['mp3', 'm4a', 'wav', 'ogg', 'flac', 'opus'];
    for (const fmt of audioTargets) {
      if (fmt !== inputId) add(fmt);
    }
  }

  // 4. PDF Document
  else if (inputId === 'pdf') {
    add('png');
    add('jpg');
    add('txt');
  }

  // 5. DOCX Document
  else if (inputId === 'docx') {
    add('pdf');
    add('png');
    add('jpg');
    add('txt');
    add('html');
  }

  // 6. Text (JSON, CSV, TSV, TXT)
  else if (detected.family === 'text') {
    if (inputId === 'json') {
      add('csv');
      add('json'); // pretty json
    } else if (inputId === 'csv') {
      add('json');
      add('tsv');
    } else if (inputId === 'tsv') {
      add('json');
      add('csv');
    } else if (inputId === 'txt') {
      add('pdf');
    }
  }

  return result;
}
