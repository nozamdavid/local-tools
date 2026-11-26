import type { ImageFilter, WorkerMessageRequest, WorkerMessageResponse } from './worker';

class FilterWorkerClient {
  private worker: Worker | null = null;
  private reqId = 0;
  private pending = new Map<
    number,
    {
      resolve: (data: Uint8ClampedArray) => void;
      reject: (err: Error) => void;
    }
  >();

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<WorkerMessageResponse>) => {
        const { id, data, error } = e.data;
        const entry = this.pending.get(id);
        if (entry) {
          this.pending.delete(id);
          if (error) {
            entry.reject(new Error(error));
          } else {
            entry.resolve(data);
          }
        }
      };
      this.worker.onerror = (event) => {
        this.worker?.terminate();
        this.worker = null;
        for (const { reject } of this.pending.values()) {
          reject(new Error(event.message || 'Image filter worker failed.'));
        }
        this.pending.clear();
      };
    }
    return this.worker;
  }

  public process(image: ImageData, filter: ImageFilter): Promise<Uint8ClampedArray> {
    return new Promise((resolve, reject) => {
      const id = ++this.reqId;
      const worker = this.getWorker();
      this.pending.set(id, { resolve, reject });

      // Copy buffer if we need to keep caller's copy intact
      const copy = new Uint8ClampedArray(image.data);
      const msg: WorkerMessageRequest = { ...filter, id, width: image.width, height: image.height, data: copy };
      try {
        worker.postMessage(msg, [copy.buffer]);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}

export const filterWorkerClient = new FilterWorkerClient();
