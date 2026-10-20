import { pipeline, env, type ProgressInfo } from '@huggingface/transformers';
import type { AiWorkerInMessage, AiWorkerOutMessage } from './types';

// Configure transformers environment for browser execution
env.allowLocalModels = false;
env.useBrowserCache = true;

const pipelineCache = new Map<string, any>();

async function getPipeline(
  task: 'summarization' | 'translation',
  modelId: string,
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
  const cacheKey = `${task}:${modelId}:${primaryDevice}:${primaryDtype}`;

  if (pipelineCache.has(cacheKey)) {
    return pipelineCache.get(cacheKey);
  }

  try {
    const pipe = await pipeline(task, modelId, {
      device: primaryDevice,
      dtype: primaryDtype,
      progress_callback: onProgress,
    });
    pipelineCache.set(cacheKey, pipe);
    return pipe;
  } catch (primaryErr) {
    if (primaryDevice === 'webgpu') {
      console.warn(`WebGPU ${task} initialization failed, falling back to WASM (q8):`, primaryErr);
      const fallbackKey = `${task}:${modelId}:wasm:q8`;
      if (pipelineCache.has(fallbackKey)) {
        return pipelineCache.get(fallbackKey);
      }
      const pipe = await pipeline(task, modelId, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: onProgress,
      });
      pipelineCache.set(fallbackKey, pipe);
      return pipe;
    }
    throw primaryErr;
  }
}

self.onmessage = async (e: MessageEvent<AiWorkerInMessage>) => {
  const msg = e.data;
  if (!msg || !msg.type) return;

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
      const progressMsg: AiWorkerOutMessage = {
        type: 'download_progress',
        progress: Math.min(1, Math.max(0, ratio)),
        loaded: totalLoaded,
        total: totalBytes,
        file: info.file,
      };
      self.postMessage(progressMsg);
    } else if (info.status === 'progress_total') {
      const progressMsg: AiWorkerOutMessage = {
        type: 'download_progress',
        progress: Math.min(1, Math.max(0, info.progress / 100)),
        loaded: info.loaded,
        total: info.total,
      };
      self.postMessage(progressMsg);
    }
  };

  try {
    if (msg.type === 'summarize') {
      const summarizer = await getPipeline('summarization', msg.modelId, progressHandler);

      self.postMessage({
        type: 'status',
        phase: 'inferring',
        current: 1,
        total: 1,
      } as AiWorkerOutMessage);

      const output = await summarizer(msg.text, {
        max_new_tokens: msg.maxLength || 140,
        min_new_tokens: msg.minLength || 20,
      });

      const summaryText =
        Array.isArray(output) && output[0]?.summary_text ? output[0].summary_text : String(output);

      self.postMessage({
        type: 'complete',
        result: summaryText.trim(),
      } as AiWorkerOutMessage);
    } else if (msg.type === 'translate') {
      const translator = await getPipeline('translation', msg.modelId, progressHandler);
      const totalChunks = msg.chunks.length;
      const translatedChunks: string[] = [];

      for (let i = 0; i < totalChunks; i++) {
        self.postMessage({
          type: 'status',
          phase: 'inferring',
          current: i + 1,
          total: totalChunks,
        } as AiWorkerOutMessage);

        const chunk = msg.chunks[i];
        const output = await translator(chunk, {
          max_new_tokens: 400,
        });

        const transText =
          Array.isArray(output) && output[0]?.translation_text
            ? output[0].translation_text
            : String(output);

        translatedChunks.push(transText.trim());

        self.postMessage({
          type: 'chunk_complete',
          index: i,
          text: transText.trim(),
        } as AiWorkerOutMessage);
      }

      self.postMessage({
        type: 'complete',
        result: translatedChunks.join('\n\n'),
      } as AiWorkerOutMessage);
    }
  } catch (err: unknown) {
    const errorMsg: AiWorkerOutMessage = {
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(errorMsg);
  }
};
