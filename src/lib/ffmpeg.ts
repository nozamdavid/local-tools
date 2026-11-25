import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { withMediaJobLock } from './mediaQueue';

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
      const [core, wasm] = await Promise.allSettled([toBlobURL(coreURL, 'text/javascript'), toBlobURL(wasmURL, 'application/wasm')]);
      try {
        if (core.status === 'rejected') throw core.reason;
        if (wasm.status === 'rejected') throw wasm.reason;
        await ffmpeg.load({ coreURL: core.value, wasmURL: wasm.value });
        ffmpegInstance = ffmpeg;
        return ffmpeg;
      } catch (error) {
        ffmpeg.terminate();
        loadPromise = null;
        throw error;
      } finally {
        if (core.status === 'fulfilled') URL.revokeObjectURL(core.value);
        if (wasm.status === 'fulfilled') URL.revokeObjectURL(wasm.value);
      }
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
  signal?: AbortSignal;
}

export function runFFmpeg(opts: RunFFmpegOptions): Promise<Blob> {
  return withMediaJobLock(() => runFFmpegWithinMediaJob(opts));
}

/** Use only inside a `withMediaJobLock` callback, such as an adapter fallback. */
export async function runFFmpegWithinMediaJob(opts: RunFFmpegOptions): Promise<Blob> {
  opts.signal?.throwIfAborted();
  const ffmpeg = await getFFmpeg();
  const logLines: string[] = [];
  let aborted = false;
  // Aborting a worker message alone does not stop the synchronous WASM job.
  // Only the operation holding the media lock may terminate this instance.
  const abort = () => {
    aborted = true;
    ffmpeg.terminate();
    if (ffmpegInstance === ffmpeg) {
      ffmpegInstance = null;
      loadPromise = null;
    }
  };
  opts.signal?.addEventListener('abort', abort, { once: true });

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
    if (opts.signal?.aborted) {
      abort();
      opts.signal.throwIfAborted();
    }
    for (const input of opts.inputs) {
      let buffer: Uint8Array;
      if (input.data instanceof Uint8Array) {
        // FFmpeg transfers this buffer to its worker. Keep the caller's input reusable.
        buffer = input.data.slice();
      } else {
        const ab = await input.data.arrayBuffer();
        buffer = new Uint8Array(ab);
      }
      opts.signal?.throwIfAborted();
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
    opts.signal?.throwIfAborted();
    opts.onProgress?.(1);

    const mime = mimeFromName(opts.output);
    if (typeof outData === 'string') {
      return new Blob([outData], { type: mime });
    }
    const raw = outData as Uint8Array;
    const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    return new Blob([buffer as ArrayBuffer], { type: mime });
  } catch (error) {
    opts.signal?.throwIfAborted();
    throw error;
  } finally {
    opts.signal?.removeEventListener('abort', abort);
    for (const file of filesToCleanup) {
      if (aborted) break;
      try {
        await ffmpeg.deleteFile(file);
      } catch {
        // Ignore deletion error
      }
    }
    ffmpeg.off('log', handleLog);
    ffmpeg.off('progress', handleProgress);
  }
}
