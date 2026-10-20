export interface StreamInfo {
  index: number;
  type: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment' | 'other';
  codecProfile: string;
  resolution?: string;
  sarDar?: string;
  pixelFormat?: string;
  fps?: string;
  bitrate?: string;
  rotation?: string;
  audioSampleRate?: string;
  channelsLayout?: string;
  language?: string;
  metadata: Record<string, string>;
  raw: string;
}

export interface ParsedVideoInfo {
  container: string;
  duration: string;
  bitrate: string;
  creationTime?: string;
  metadata: Record<string, string>;
  streams: StreamInfo[];
}

/**
 * Pure function to parse the textual output of `ffmpeg -hide_banner -i <file>`
 */
export function parseFFmpegLog(log: string): ParsedVideoInfo {
  const result: ParsedVideoInfo = {
    container: '',
    duration: '',
    bitrate: '',
    creationTime: undefined,
    metadata: {},
    streams: [],
  };

  const lines = log.split(/\r?\n/);
  let currentTarget: 'container' | 'stream' = 'container';
  let currentSection: 'metadata' | 'sidedata' | '' = '';
  let currentStream: StreamInfo | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Input #0 container line: Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'input.mp4':
    const inputMatch = line.match(/^\s*Input #\d+,\s*([^,]+(?:,[^,]+)*?),\s*from/);
    if (inputMatch) {
      result.container = inputMatch[1].trim();
      continue;
    }

    // Duration line: Duration: 00:00:03.00, start: 0.000000, bitrate: 134 kb/s
    const durMatch = line.match(/^\s*Duration:\s*([^,]+),\s*(?:start:\s*[^,]+,\s*)?bitrate:\s*([^\r\n,]+)/);
    if (durMatch) {
      result.duration = durMatch[1].trim();
      result.bitrate = durMatch[2].trim();
      continue;
    }

    // Stream line: Stream #0:0[0x1](und): Video: ...
    const streamMatch = line.match(
      /^\s*Stream #\d+:(\d+)(?:\[0x[0-9a-fA-F]+\])?(?:\(([a-zA-Z0-9_-]+)\))?(?:\s*\(([^)]+)\))?:\s*([A-Za-z]+):\s*(.*)$/
    );
    if (streamMatch) {
      const index = parseInt(streamMatch[1], 10);
      const langInHeader = streamMatch[2] || undefined;
      const rawType = streamMatch[4];
      const details = streamMatch[5].trim();

      let type: StreamInfo['type'] = 'other';
      const lowerType = rawType.toLowerCase();
      if (lowerType === 'video') type = 'video';
      else if (lowerType === 'audio') type = 'audio';
      else if (lowerType === 'subtitle') type = 'subtitle';
      else if (lowerType === 'data') type = 'data';
      else if (lowerType === 'attachment') type = 'attachment';

      currentStream = {
        index,
        type,
        codecProfile: '',
        resolution: undefined,
        sarDar: undefined,
        pixelFormat: undefined,
        fps: undefined,
        bitrate: undefined,
        rotation: undefined,
        audioSampleRate: undefined,
        channelsLayout: undefined,
        language: langInHeader,
        metadata: {},
        raw: details,
      };

      // 1. Codec + Profile
      // First segment up to first comma outside parentheses and brackets
      let depth = 0;
      let firstComma = -1;
      for (let c = 0; c < details.length; c++) {
        const char = details[c];
        if (char === '(' || char === '[') depth++;
        else if (char === ')' || char === ']') depth--;
        else if (char === ',' && depth === 0) {
          firstComma = c;
          break;
        }
      }
      const firstPart = (firstComma !== -1 ? details.slice(0, firstComma) : details).trim();
      // Remove trailing container/fourcc info like (avc1 / 0x31637661) or ([255][0][0][0] / 0x00FF)
      const cleanCodec = firstPart
        .replace(/\s*\([^)]*\/[^)]*\)$/, '')
        .replace(/\s*\[[^\]]*\]$/, '')
        .trim();
      currentStream.codecProfile = cleanCodec || firstPart;

      // 2. Resolution: e.g. 640x360 or 1920x1080
      const resMatch = details.match(/\b(\d{2,5}x\d{2,5})\b/);
      if (resMatch) {
        currentStream.resolution = resMatch[1];
      }

      // 3. SAR / DAR: e.g. [SAR 1:1 DAR 16:9]
      const sarDarMatch = details.match(/\[?(SAR\s+[^,\s\]]+(?:\s+DAR\s+[^,\s\]]+)?)\]?/);
      if (sarDarMatch) {
        currentStream.sarDar = sarDarMatch[1].trim();
      }

      // 4. Pixel format: e.g. yuv444p(progressive), yuv420p, etc.
      const pixMatch = details.match(
        /\b(yuv[a-z0-9]+(?:\([a-z0-9_,\s]+\))?|rgb[a-z0-9]+|bgr[a-z0-9]+|gray[a-z0-9]*)\b/i
      );
      if (pixMatch) {
        currentStream.pixelFormat = pixMatch[1];
      }

      // 5. FPS: e.g. 30 fps
      const fpsMatch = details.match(/\b([0-9.]+(?:\/[0-9.]+)?)\s*fps\b/);
      if (fpsMatch) {
        currentStream.fps = `${fpsMatch[1]} fps`;
      }

      // 6. Bitrate: e.g. 52 kb/s
      const brMatch = details.match(/\b([0-9.]+\s*[kKMGT]?b\/s)\b/);
      if (brMatch) {
        currentStream.bitrate = brMatch[1];
      }

      // 7. Audio sample rate: e.g. 44100 Hz
      const srMatch = details.match(/\b(\d+\s*Hz)\b/);
      if (srMatch) {
        currentStream.audioSampleRate = srMatch[1];
      }

      // 8. Channels layout: e.g. mono, stereo, 5.1(side), 7.1, 2 channels
      const chMatch = details.match(/\b(mono|stereo|downmix|quad|5\.1(?:\(side\))?|7\.1|\d+\s*channels?)\b/i);
      if (chMatch) {
        currentStream.channelsLayout = chMatch[1];
      }

      result.streams.push(currentStream);
      currentTarget = 'stream';
      currentSection = '';
      continue;
    }

    // Metadata header
    if (/^\s*Metadata:\s*$/i.test(line)) {
      currentSection = 'metadata';
      continue;
    }

    // Side data header
    if (/^\s*Side data:\s*$/i.test(line)) {
      currentSection = 'sidedata';
      continue;
    }

    // Parse metadata key: value
    if (currentSection === 'metadata') {
      const kvMatch = line.match(/^\s+([a-zA-Z0-9_\-\s]+?)\s*:\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        const val = kvMatch[2].trim();
        if (currentTarget === 'container') {
          result.metadata[key] = val;
          if (/^creation_time$/i.test(key)) {
            result.creationTime = val;
          }
        } else if (currentTarget === 'stream' && currentStream) {
          currentStream.metadata[key] = val;
          if (/^rotate$/i.test(key)) {
            currentStream.rotation = `${val}°`;
          }
          if (/^language$/i.test(key) && !currentStream.language) {
            currentStream.language = val;
          }
        }
        continue;
      }
    }

    // Parse side data (e.g. rotation matrix)
    if (currentSection === 'sidedata' && currentTarget === 'stream' && currentStream) {
      const rotMatch = line.match(/displaymatrix:\s*rotation\s*of\s*(-?[0-9.]+)\s*degrees/i);
      if (rotMatch) {
        const deg = parseFloat(rotMatch[1]);
        currentStream.rotation = `${Math.abs(deg)}°`;
        continue;
      }
    }
  }

  return result;
}
