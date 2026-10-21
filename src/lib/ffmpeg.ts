import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

export function mimeFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : name.toLowerCase();
  switch (ext) {
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'mkv':
      return 'video/x-matroska';
    case 'avi':
      return 'video/x-msvideo';
    case 'gif':
      return 'image/gif';
    case 'mp3':
      return 'audio/mpeg';
    case 'aac':
      return 'audio/aac';
    case 'm4a':
      return 'audio/mp4';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'srt':
      return 'text/plain';
    case 'vtt':
      return 'text/vtt';
    case 'txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      const [blobCoreURL, blobWasmURL] = await Promise.all([toBlobURL(coreURL, 'text/javascript'), toBlobURL(wasmURL, 'application/wasm')]);
      await ffmpeg.load({
        coreURL: blobCoreURL,
        wasmURL: blobWasmURL,
      });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
  }
  return loadPromise;
}

export interface RunFFmpegInput {
  name: string;
  data: File | Blob | Uint8Array;
}

export interface RunFFmpegOptions {
  inputs: RunFFmpegInput[];
  args: string[];
  output: string;
  onProgress?: (ratio: number) => void;
  onLog?: (line: string) => void;
}

let queue: Promise<unknown> = Promise.resolve();

function enqueueJob<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue = queue.then(async () => {
      try {
        const result = await task();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  });
}

export function runFFmpeg(opts: RunFFmpegOptions): Promise<Blob> {
  return enqueueJob(async () => {
    const ffmpeg = await getFFmpeg();
    const logLines: string[] = [];

    const handleLog = ({ message }: { message: string }) => {
      logLines.push(message);
      if (logLines.length > 50) {
        logLines.shift();
      }
      opts.onLog?.(message);
    };

    const handleProgress = ({ progress }: { progress: number }) => {
      const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
      opts.onProgress?.(clamped);
    };

    ffmpeg.on('log', handleLog);
    ffmpeg.on('progress', handleProgress);

    const filesToCleanup = new Set<string>();

    try {
      for (const input of opts.inputs) {
        let buffer: Uint8Array;
        if (input.data instanceof Uint8Array) {
          buffer = input.data;
        } else {
          const ab = await input.data.arrayBuffer();
          buffer = new Uint8Array(ab);
        }
        await ffmpeg.writeFile(input.name, buffer);
        filesToCleanup.add(input.name);
      }

      filesToCleanup.add(opts.output);

      const exitCode = await ffmpeg.exec(opts.args);

      if (exitCode !== 0) {
        const recentLogs = logLines.slice(-20).join('\n');
        throw new Error(`FFmpeg exited with code ${exitCode}${recentLogs ? `:\n${recentLogs}` : ''}`);
      }

      const outData = await ffmpeg.readFile(opts.output);
      opts.onProgress?.(1);

      const mime = mimeFromName(opts.output);
      if (typeof outData === 'string') {
        return new Blob([outData], { type: mime });
      }
      const raw = outData as Uint8Array;
      const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      return new Blob([buffer as ArrayBuffer], { type: mime });
    } finally {
      for (const file of filesToCleanup) {
        try {
          await ffmpeg.deleteFile(file);
        } catch {
          // Ignore deletion error
        }
      }
      ffmpeg.off('log', handleLog);
      ffmpeg.off('progress', handleProgress);
    }
  });
}
