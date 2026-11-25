import type { SegmentWorkerOutMessage } from './types';
import { translate } from '../../lib/i18n';

function translateSegmentError(message: string): string {
  if (message === 'Pipeline produced invalid mask output') return translate(message);
  return translate('Video segmentation failed: {message}', { message });
}

export class SegmentClient {
  private worker: Worker | null = null;
  private reqIdCounter = 0;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: { mask: Uint8ClampedArray; width: number; height: number }) => void;
      reject: (reason: any) => void;
    }
  >();
  private initPromise: Promise<{ device: string; model: string }> | null = null;
  private initResolve: ((val: { device: string; model: string }) => void) | null = null;
  private initReject: ((err: any) => void) | null = null;
  private onProgressCallback?: (progress: any) => void;

  constructor() {
    this.spawnWorker();
  }

  private spawnWorker() {
    this.worker = new Worker(new URL('./segmentWorker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (e: MessageEvent<SegmentWorkerOutMessage>) => {
      const msg = e.data;
      if (!msg) return;

      switch (msg.type) {
        case 'progress':
          this.onProgressCallback?.(msg.progress);
          break;

        case 'ready':
          if (this.initResolve) {
            this.initResolve({ device: msg.device, model: msg.model });
            this.initResolve = null;
            this.initReject = null;
          }
          break;

        case 'result': {
          const pending = this.pendingRequests.get(msg.id);
          if (pending) {
            this.pendingRequests.delete(msg.id);
            pending.resolve({ mask: msg.mask, width: msg.width, height: msg.height });
          }
          break;
        }

        case 'error':
          if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
            const pending = this.pendingRequests.get(msg.id);
            this.pendingRequests.delete(msg.id);
            pending?.reject(new Error(translateSegmentError(msg.error)));
          } else if (this.initReject) {
            this.initReject(new Error(translateSegmentError(msg.error)));
            this.initResolve = null;
            this.initReject = null;
          }
          break;
      }
    };

    this.worker.onerror = (err) => {
      const errorMsg = err.message || translate('Worker encountered an error.');
      const localizedError = translate('Video segmentation worker failed: {message}', { message: errorMsg });
      if (this.initReject) {
        this.initReject(new Error(localizedError));
        this.initResolve = null;
        this.initReject = null;
      }
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(localizedError));
      }
      this.pendingRequests.clear();
    };
  }

  public async init(onProgress?: (progress: any) => void, modelId?: string): Promise<{ device: string; model: string }> {
    const worker = this.worker;
    if (!worker) throw new Error(translate('Video segmentation worker is not running.'));
    if (this.initPromise) {
      this.onProgressCallback = onProgress;
      return this.initPromise;
    }

    this.onProgressCallback = onProgress;
    this.initPromise = new Promise((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
      worker.postMessage({ type: 'init', modelId });
    });

    return this.initPromise;
  }

  public async segmentFrame(
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ): Promise<{ mask: Uint8ClampedArray; width: number; height: number }> {
    if (!this.worker) {
      throw new Error(translate('Video segmentation worker is not running.'));
    }

    const id = ++this.reqIdCounter;

    // Clone/transfer buffer to worker
    const transferableData = new Uint8ClampedArray(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker?.postMessage(
        {
          type: 'segment',
          id,
          data: transferableData,
          width,
          height,
        },
        [transferableData.buffer],
      );
    });
  }

  public terminate() {
    const error = new Error(translate('Video segmentation was cancelled.'));
    this.initReject?.(error);
    for (const [, pending] of this.pendingRequests) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.initPromise = null;
    this.initResolve = null;
    this.initReject = null;
  }
}
