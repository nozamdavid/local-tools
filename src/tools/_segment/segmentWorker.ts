/// <reference lib="webworker" />

import { pipeline, env, RawImage, type ImageSegmentationPipeline, type ProgressInfo } from '@huggingface/transformers';
import { getSegmentErrorMessage } from './errors';
import type { SegmentWorkerInMessage, SegmentWorkerOutMessage } from './types';

// Configure transformers environment for browser/worker
env.allowLocalModels = false;
env.useBrowserCache = true;

// Default portrait segmentation model
const DEFAULT_MODEL = 'Xenova/modnet';

let segmenterPromise: Promise<ImageSegmentationPipeline> | null = null;
let currentModelId = DEFAULT_MODEL;
let activeDevice = 'wasm';

async function getSegmenter(modelId: string = DEFAULT_MODEL) {
  if (segmenterPromise && currentModelId === modelId) {
    return segmenterPromise;
  }

  currentModelId = modelId;
  segmenterPromise = (async () => {
    let canUseWebGPU = false;
    try {
      if (typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter();
        canUseWebGPU = !!adapter;
      }
    } catch {
      canUseWebGPU = false;
    }

    const progressCallback = (info: ProgressInfo) => {
      const bytes = info?.status === 'progress' || info?.status === 'progress_total' ? info : undefined;
      const msg: SegmentWorkerOutMessage = {
        type: 'progress',
        progress: {
          status: info?.status,
          file: info && 'file' in info ? info.file : undefined,
          progress: bytes?.progress,
          total: bytes?.total,
          loaded: bytes?.loaded,
        },
      };
      postMessage(msg);
    };

    if (canUseWebGPU) {
      try {
        const pipe = await pipeline('image-segmentation', modelId, {
          device: 'webgpu',
          dtype: 'fp32',
          progress_callback: progressCallback,
        });
        activeDevice = 'webgpu';
        return pipe;
      } catch (err) {
        console.warn('WebGPU segmentation init failed, falling back to WASM:', err);
      }
    }

    const pipe = await pipeline('image-segmentation', modelId, {
      device: 'wasm',
      dtype: 'fp32',
      progress_callback: progressCallback,
    });
    activeDevice = 'wasm';
    return pipe;
  })();

  return segmenterPromise;
}

self.onmessage = async (e: MessageEvent<SegmentWorkerInMessage>) => {
  const msg = e.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'init') {
    try {
      const model = msg.modelId || DEFAULT_MODEL;
      await getSegmenter(model);
      const readyMsg: SegmentWorkerOutMessage = {
        type: 'ready',
        device: activeDevice,
        model: currentModelId,
      };
      postMessage(readyMsg);
    } catch (err) {
      const errMsg: SegmentWorkerOutMessage = {
        type: 'error',
        error: getSegmentErrorMessage(err) || String(err),
      };
      postMessage(errMsg);
    }
    return;
  }

  if (msg.type === 'segment') {
    const { id, data, width, height } = msg;
    try {
      const pipe = await getSegmenter(currentModelId);
      const rawImage = new RawImage(data, width, height, 4);
      const out = await pipe(rawImage);

      const mask = out?.[0]?.mask;
      if (!mask) {
        throw new Error('Pipeline produced invalid mask output');
      }

      const transferableMask = new Uint8ClampedArray(mask.data);

      const resultMsg: SegmentWorkerOutMessage = {
        type: 'result',
        id,
        mask: transferableMask,
        width,
        height,
      };
      postMessage(resultMsg, [transferableMask.buffer]);
    } catch (err) {
      const errMsg: SegmentWorkerOutMessage = {
        type: 'error',
        id,
        error: getSegmentErrorMessage(err) || String(err),
      };
      postMessage(errMsg);
    }
  }
};
