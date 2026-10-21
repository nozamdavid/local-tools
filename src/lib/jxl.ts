import type { JxlWorkerRequest, JxlWorkerResponse } from './jxl.worker';

export interface JxlEncodeOptions {
  quality?: number; // 1 - 100
  lossless?: boolean;
}

/**
 * Checks whether the given byte buffer starts with a valid JPEG XL signature.
 * Recognizes both:
 * 1. Raw codestream magic: FF 0A
 * 2. 12-byte container signature: 00 00 00 0C 4A 58 4C 20 0D 0A 87 0A
 */
export function isJxlSignature(bytes: Uint8Array): boolean {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0x0a) {
    return true;
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x0c &&
    bytes[4] === 0x4a && // 'J'
    bytes[5] === 0x58 && // 'X'
    bytes[6] === 0x4c && // 'L'
    bytes[7] === 0x20 && // ' '
    bytes[8] === 0x0d && // '\r'
    bytes[9] === 0x0a && // '\n'
    bytes[10] === 0x87 &&
    bytes[11] === 0x0a // '\n'
  ) {
    return true;
  }
  return false;
}

/**
 * Inspects the content-based header of a File or Blob to detect JPEG XL format
 * independently of filename extension or declared MIME type.
 */
export async function isJxlFile(fileOrBlob: Blob): Promise<boolean> {
  if (fileOrBlob.size < 2) return false;
  try {
    const slice = fileOrBlob.slice(0, 12);
    const buf = await slice.arrayBuffer();
    return isJxlSignature(new Uint8Array(buf));
  } catch {
    return false;
  }
}

class JxlClient {
  private worker: Worker | null = null;
  private reqId = 0;
  private pending = new Map<
    number,
    {
      resolve: (res: JxlWorkerResponse) => void;
      reject: (err: Error) => void;
    }
  >();

  // Queue to serialize worker requests and avoid memory spikes
  private queue: Promise<unknown> = Promise.resolve();

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./jxl.worker.ts', import.meta.url), {
        type: 'module',
      });

      this.worker.onmessage = (event: MessageEvent<JxlWorkerResponse>) => {
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
        console.error('JXL Worker unhandled error:', err);
        // Terminate and clean up broken worker
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
      reject(new Error('JXL Worker terminated unexpectedly.'));
    }
    this.pending.clear();
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  public decode(buffer: ArrayBuffer): Promise<ImageData> {
    return this.enqueue(
      () =>
        new Promise<ImageData>((resolve, reject) => {
          const id = ++this.reqId;
          const worker = this.getWorker();
          this.pending.set(id, {
            resolve: (res) => {
              if (res.ok && res.type === 'decode') {
                const clamped = new Uint8ClampedArray(res.data);
                const imgData = new ImageData(clamped, res.width, res.height);
                resolve(imgData);
              } else {
                reject(new Error('Unexpected worker decode response'));
              }
            },
            reject,
          });

          const msg: JxlWorkerRequest = {
            id,
            type: 'decode',
            buffer,
          };
          worker.postMessage(msg, [buffer]);
        }),
    );
  }

  public encode(width: number, height: number, data: Uint8ClampedArray, options?: JxlEncodeOptions): Promise<ArrayBuffer> {
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

          // Copy pixel buffer if needed so we can transfer safely
          const copy = new Uint8ClampedArray(data);
          const msg: JxlWorkerRequest = {
            id,
            type: 'encode',
            width,
            height,
            data: copy,
            options,
          };
          worker.postMessage(msg, [copy.buffer]);
        }),
    );
  }
}

export const jxlClient = new JxlClient();

/**
 * Decodes a JPEG XL buffer into raw browser ImageData.
 */
export async function decodeJxl(buffer: ArrayBuffer | Uint8Array): Promise<ImageData> {
  const buf =
    buffer instanceof Uint8Array
      ? (buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
      : buffer.slice(0);
  return jxlClient.decode(buf);
}

/**
 * Decodes a JPEG XL buffer onto an HTMLCanvasElement.
 */
export async function decodeJxlToCanvas(buffer: ArrayBuffer | Uint8Array): Promise<HTMLCanvasElement> {
  const imgData = await decodeJxl(buffer);
  const canvas = document.createElement('canvas');
  canvas.width = imgData.width;
  canvas.height = imgData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is not available.');
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Decodes a JPEG XL buffer into a browser-displayable PNG Blob.
 */
export async function decodeJxlToBlob(buffer: ArrayBuffer | Uint8Array): Promise<Blob> {
  const canvas = await decodeJxlToCanvas(buffer);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to convert decoded JPEG XL to PNG blob.'));
    }, 'image/png');
  });
}

/**
 * Encodes browser ImageData into a JPEG XL (.jxl) Blob.
 */
export async function encodeJxl(imageData: ImageData, options?: JxlEncodeOptions): Promise<Blob> {
  const encoded = await jxlClient.encode(imageData.width, imageData.height, imageData.data, options);
  return new Blob([encoded], { type: 'image/jxl' });
}

/**
 * Encodes an HTMLCanvasElement into a JPEG XL (.jxl) Blob.
 */
export async function encodeJxlCanvas(canvas: HTMLCanvasElement, options?: JxlEncodeOptions): Promise<Blob> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is not available.');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return encodeJxl(imgData, options);
}

// -----------------------------------------------------------------------------
// Universal Preview Fallback for Browsers lacking native JPEG XL support:
// Intercepts failed <img> loads whose src is a blob: URL containing JPEG XL data,
// decodes it via the JXL worker, and replaces the element's src with a rendered PNG blob.
// -----------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window.addEventListener(
    'error',
    (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement && target.src && target.src.startsWith('blob:') && !target.dataset.jxlHandled) {
        target.dataset.jxlHandled = 'pending';
        fetch(target.src)
          .then((res) => res.blob())
          .then(async (blob) => {
            if (blob.type === 'image/jxl' || (await isJxlFile(blob))) {
              const pngBlob = await decodeJxlToBlob(await blob.arrayBuffer());
              const pngUrl = URL.createObjectURL(pngBlob);
              target.dataset.jxlHandled = 'true';
              target.src = pngUrl;
            } else {
              target.dataset.jxlHandled = 'ignored';
            }
          })
          .catch(() => {
            target.dataset.jxlHandled = 'error';
          });
      }
    },
    true, // capture phase
  );
}
