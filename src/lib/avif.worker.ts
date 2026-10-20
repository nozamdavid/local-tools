import avifEncWasmUrl from '@jsquash/avif/codec/enc/avif_enc.wasm?url';
import encode, { init as initEncode } from '@jsquash/avif/encode.js';

const MAX_DIMENSION = 16384;
const MAX_PIXELS = 40_000_000; // 40 Megapixels

export interface AvifEncodeOptions {
  quality?: number; // 1 - 100
  lossless?: boolean;
  speed?: number; // 0 - 10 (default 6)
}

export interface AvifWorkerEncodeRequest {
  id: number;
  type: 'encode';
  width: number;
  height: number;
  data: Uint8ClampedArray;
  options?: AvifEncodeOptions;
}

export interface AvifWorkerPingRequest {
  id: number;
  type: 'ping';
}

export type AvifWorkerRequest = AvifWorkerEncodeRequest | AvifWorkerPingRequest;

export type AvifWorkerResponse =
  | { id: number; ok: true; type: 'encode'; data: ArrayBuffer }
  | { id: number; ok: true; type: 'ping' }
  | { id: number; ok: false; error: string };

let encodeReadyPromise: Promise<void> | null = null;

async function getEncoder() {
  if (!encodeReadyPromise) {
    encodeReadyPromise = (async () => {
      const res = await fetch(avifEncWasmUrl);
      if (!res.ok) {
        throw new Error(`Failed to load AVIF encoder WASM asset: ${res.statusText}`);
      }
      const bytes = await res.arrayBuffer();
      const module = await WebAssembly.compile(bytes);
      await initEncode(module);
    })();
  }
  return encodeReadyPromise;
}

self.onmessage = async (event: MessageEvent<AvifWorkerRequest>) => {
  const req = event.data;
  if (!req || typeof req.id !== 'number') return;

  if (req.type === 'ping') {
    self.postMessage({ id: req.id, ok: true, type: 'ping' });
    return;
  }

  if (req.type === 'encode') {
    try {
      if (req.width <= 0 || req.height <= 0) {
        throw new Error('Image dimensions must be greater than zero.');
      }
      if (req.width > MAX_DIMENSION || req.height > MAX_DIMENSION) {
        throw new Error(`Image dimensions exceed maximum allowed (${MAX_DIMENSION}px).`);
      }
      if (req.width * req.height > MAX_PIXELS) {
        throw new Error(`Total pixels exceed maximum allowed (${MAX_PIXELS}px).`);
      }

      await getEncoder();

      const { width, height, data, options } = req;
      const isLossless = options?.lossless ?? false;
      const quality =
        options?.quality !== undefined
          ? Math.max(1, Math.min(100, Math.round(options.quality)))
          : 75;
      const speed =
        options?.speed !== undefined
          ? Math.max(0, Math.min(10, Math.round(options.speed)))
          : 6;

      const clampedData =
        data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
      const imgData = { data: clampedData, width, height } as unknown as ImageData;

      const encodedBuffer = await encode(imgData, {
        quality,
        lossless: isLossless,
        speed,
      });

      (self.postMessage as any)(
        { id: req.id, ok: true, type: 'encode', data: encodedBuffer },
        [encodedBuffer]
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      self.postMessage({ id: req.id, ok: false, error: errorMsg });
    }
  }
};
