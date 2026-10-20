import type {
  AvifEncodeOptions,
  AvifWorkerRequest,
  AvifWorkerResponse,
} from './avif.worker';

export type { AvifEncodeOptions };

/**
 * Checks whether the given byte buffer starts with a valid AVIF signature.
 * AVIF is an ISOBMFF container file with:
 * - Total length >= 12 bytes
 * - Box type at offset 4: "ftyp" (0x66, 0x74, 0x79, 0x70)
 * - Major brand or compatible brands in header slice containing "avif" or "avis"
 */
export function isAvifSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (
    bytes[4] !== 0x66 || // 'f'
    bytes[5] !== 0x74 || // 't'
    bytes[6] !== 0x79 || // 'y'
    bytes[7] !== 0x70 // 'p'
  ) {
    return false;
  }
  const slice = Array.from(bytes.slice(8, Math.min(bytes.length, 64)))
    .map((b) => String.fromCharCode(b))
    .join('');
  return slice.includes('avif') || slice.includes('avis');
}

/**
 * Inspects the content-based header of a File or Blob to detect AVIF format
 * independently of filename extension or declared MIME type.
 */
export async function isAvifFile(fileOrBlob: Blob): Promise<boolean> {
  if (fileOrBlob.size < 12) return false;
  try {
    const slice = fileOrBlob.slice(0, 64);
    const buf = await slice.arrayBuffer();
    return isAvifSignature(new Uint8Array(buf));
  } catch {
    return false;
  }
}

class AvifClient {
  private worker: Worker | null = null;
  private reqId = 0;
  private pending = new Map<
    number,
    {
      resolve: (res: AvifWorkerResponse) => void;
      reject: (err: Error) => void;
    }
  >();

  // Queue to serialize worker requests and avoid memory spikes
  private queue: Promise<unknown> = Promise.resolve();

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./avif.worker.ts', import.meta.url), {
        type: 'module',
      });

      this.worker.onmessage = (event: MessageEvent<AvifWorkerResponse>) => {
        const res = event.data;
        if (!res || typeof res.id !== 'number') return;
        const entry = this.pending.get(res.id);
        if (entry) {
          this.pending.delete(res.id);
          if (res.ok) {
            entry.resolve(res);
          } else {
            entry.reject(new Error(res.error));
          }
        }
      };

      this.worker.onerror = (err) => {
        console.error('AVIF Worker unhandled error:', err);
        this.terminate();
      };
    }
    return this.worker;
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, { reject }] of this.pending) {
      reject(new Error('AVIF Worker terminated unexpectedly.'));
    }
    this.pending.clear();
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.then(
      () => {},
      () => {}
    );
    return next;
  }

  public encode(
    width: number,
    height: number,
    data: Uint8ClampedArray,
    options?: AvifEncodeOptions
  ): Promise<ArrayBuffer> {
    return this.enqueue(
      () =>
        new Promise<ArrayBuffer>((resolve, reject) => {
          const id = ++this.reqId;
          const worker = this.getWorker();
          this.pending.set(id, {
            resolve: (res) => {
              if (res.ok && res.type === 'encode') {
                resolve(res.data);
              } else {
                reject(new Error('Unexpected worker encode response'));
              }
            },
            reject,
          });

          const copy = new Uint8ClampedArray(data);
          const msg: AvifWorkerRequest = {
            id,
            type: 'encode',
            width,
            height,
            data: copy,
            options,
          };
          worker.postMessage(msg, [copy.buffer]);
        })
    );
  }
}

export const avifClient = new AvifClient();

/**
 * Encodes raw RGBA pixel data to an AVIF ArrayBuffer using the lazy WASM worker.
 */
export async function encodeAvif(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  options?: AvifEncodeOptions
): Promise<ArrayBuffer> {
  return avifClient.encode(width, height, data, options);
}

/**
 * Encodes an HTMLCanvasElement directly into an AVIF Blob using the lazy WASM worker.
 */
export async function encodeAvifCanvas(
  canvas: HTMLCanvasElement,
  options?: AvifEncodeOptions
): Promise<Blob> {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D is not available in this browser.');
  }
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const buffer = await avifClient.encode(
    imgData.width,
    imgData.height,
    imgData.data,
    options
  );
  return new Blob([buffer], { type: 'image/avif' });
}
