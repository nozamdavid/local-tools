import { pipeline, env, RawImage } from '@huggingface/transformers';
import type { SegmentWorkerInMessage, SegmentWorkerOutMessage } from './types';

// Configure transformers environment for browser/worker
env.allowLocalModels = false;
env.useBrowserCache = true;

// Default portrait segmentation model
const DEFAULT_MODEL = 'Xenova/modnet';

let segmenterPromise: Promise<any> | null = null;
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
      if (typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as any).gpu) {
        const adapter = await (navigator as any).gpu.requestAdapter();
        canUseWebGPU = !!adapter;
      }
    } catch {
      canUseWebGPU = false;
    }

    const progressCallback = (progress: any) => {
      const msg: SegmentWorkerOutMessage = {
        type: 'progress',
        progress: {
          status: progress?.status,
          file: progress?.file,
          progress: progress?.progress,
          total: progress?.total,
          loaded: progress?.loaded,
        },
      };
      (self as any).postMessage(msg);
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
      (self as any).postMessage(readyMsg);
    } catch (err: any) {
      const errMsg: SegmentWorkerOutMessage = {
        type: 'error',
        error: err?.message || String(err),
      };
      (self as any).postMessage(errMsg);
    }
    return;
  }

  if (msg.type === 'segment') {
    const { id, data, width, height } = msg;
    try {
      const pipe = await getSegmenter(currentModelId);
      const rawImage = new RawImage(data, width, height, 4);
      const out = await pipe(rawImage);

      if (!out || !out[0] || !out[0].mask) {
        throw new Error('Pipeline produced invalid mask output');
      }

      const maskData = out[0].mask.data as Uint8ClampedArray;
      const maskBuffer = maskData.buffer.slice(
        maskData.byteOffset,
        maskData.byteOffset + maskData.byteLength
      );
      const transferableMask = new Uint8ClampedArray(maskBuffer);

      const resultMsg: SegmentWorkerOutMessage = {
        type: 'result',
        id,
        mask: transferableMask,
        width,
        height,
      };
      (self as any).postMessage(resultMsg, [transferableMask.buffer]);
    } catch (err: any) {
      const errMsg: SegmentWorkerOutMessage = {
        type: 'error',
        id,
        error: err?.message || String(err),
      };
      (self as any).postMessage(errMsg);
    }
  }
};
