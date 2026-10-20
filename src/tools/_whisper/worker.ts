import { pipeline, env, type ProgressInfo } from '@huggingface/transformers';
import type { WhisperChunk, WorkerInMessage, WorkerOutMessage } from './types';

// Configure transformers environment for browser execution
env.allowLocalModels = false;
env.useBrowserCache = true;

let cachedPipeline: any = null;
let cachedModelKey = '';

async function getTranscriber(
  model: string,
  onProgress: (info: ProgressInfo) => void
): Promise<any> {
  let isWebGpu = false;
  if (typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean(navigator.gpu)) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        isWebGpu = true;
      }
    } catch {
      isWebGpu = false;
    }
  }

  const primaryDevice = isWebGpu ? 'webgpu' : 'wasm';
  const primaryDtype = isWebGpu ? 'fp32' : 'q8';
  const modelKey = `${model}:${primaryDevice}:${primaryDtype}`;

  if (cachedPipeline && cachedModelKey === modelKey) {
    return cachedPipeline;
  }

  try {
    const p = await pipeline('automatic-speech-recognition', model, {
      device: primaryDevice,
      dtype: primaryDtype,
      progress_callback: onProgress,
    });
    cachedPipeline = p;
    cachedModelKey = modelKey;
    return p;
  } catch (primaryErr) {
    if (primaryDevice === 'webgpu') {
      console.warn('WebGPU Whisper initialization failed, falling back to WASM (q8):', primaryErr);
      const fallbackKey = `${model}:wasm:q8`;
      if (cachedPipeline && cachedModelKey === fallbackKey) {
        return cachedPipeline;
      }
      const p = await pipeline('automatic-speech-recognition', model, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: onProgress,
      });
      cachedPipeline = p;
      cachedModelKey = fallbackKey;
      return p;
    }
    throw primaryErr;
  }
}

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  if (!msg || msg.type !== 'transcribe') return;

  let timerId: ReturnType<typeof setInterval> | null = null;

  try {
    const fileProgress = new Map<string, { loaded: number; total: number }>();

    const progressHandler = (info: ProgressInfo) => {
      if (!info) return;

      if (info.status === 'progress' && info.file) {
        fileProgress.set(info.file, {
          loaded: info.loaded || 0,
          total: info.total || 0,
        });

        let totalLoaded = 0;
        let totalBytes = 0;
        for (const item of fileProgress.values()) {
          totalLoaded += item.loaded;
          totalBytes += item.total;
        }

        const ratio = totalBytes > 0 ? totalLoaded / totalBytes : (info.progress ?? 0) / 100;
        const msg: WorkerOutMessage = {
          type: 'download_progress',
          progress: Math.min(1, Math.max(0, ratio)),
          loaded: totalLoaded,
          total: totalBytes,
          file: info.file,
        };
        self.postMessage(msg);
      } else if (info.status === 'progress_total') {
        const msg: WorkerOutMessage = {
          type: 'download_progress',
          progress: Math.min(1, Math.max(0, info.progress / 100)),
          loaded: info.loaded,
          total: info.total,
        };
        self.postMessage(msg);
      }
    };

    const transcriber = await getTranscriber(msg.model, progressHandler);

    let elapsed = 0;
    const initialStatus: WorkerOutMessage = {
      type: 'status',
      phase: 'transcribing',
      elapsedSeconds: 0,
    };
    self.postMessage(initialStatus);

    timerId = setInterval(() => {
      elapsed += 1;
      const statusMsg: WorkerOutMessage = {
        type: 'status',
        phase: 'transcribing',
        elapsedSeconds: elapsed,
      };
      self.postMessage(statusMsg);
    }, 1000);

    const transcribeOptions: Record<string, unknown> = {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    };

    if (msg.language) {
      transcribeOptions.language = msg.language;
    }
    if (msg.task) {
      transcribeOptions.task = msg.task;
    }

    const output = await transcriber(msg.audio, transcribeOptions);

    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }

    const rawChunks = Array.isArray(output?.chunks) ? output.chunks : [];
    const chunks: WhisperChunk[] = rawChunks.map((chunk: any) => ({
      text: chunk.text ?? '',
      timestamp: chunk.timestamp ?? [0, null],
    }));

    if (chunks.length === 0 && output?.text) {
      chunks.push({
        text: output.text,
        timestamp: [0, null],
      });
    }

    const completeMsg: WorkerOutMessage = {
      type: 'complete',
      text: output?.text ?? '',
      chunks,
    };
    self.postMessage(completeMsg);
  } catch (err: unknown) {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
    const errorMsg: WorkerOutMessage = {
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(errorMsg);
  }
};
