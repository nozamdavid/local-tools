import jxlDecWasmUrl from '@jsquash/jxl/codec/dec/jxl_dec.wasm?url';
import jxlEncWasmUrl from '@jsquash/jxl/codec/enc/jxl_enc.wasm?url';
import decode, { init as initDecode } from '@jsquash/jxl/decode.js';
import encode, { init as initEncode } from '@jsquash/jxl/encode.js';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_DIMENSION = 16384;
const MAX_PIXELS = 40_000_000; // 40 Megapixels

export interface JxlWorkerDecodeRequest {
  id: number;
  type: 'decode';
  buffer: ArrayBuffer;
}

export interface JxlWorkerEncodeRequest {
  id: number;
  type: 'encode';
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
  options?: {
    quality?: number;
    lossless?: boolean;
  };
}

export interface JxlWorkerPingRequest {
  id: number;
  type: 'ping';
}

export type JxlWorkerRequest = JxlWorkerDecodeRequest | JxlWorkerEncodeRequest | JxlWorkerPingRequest;

export type JxlWorkerResponse =
  | { id: number; ok: true; type: 'decode'; width: number; height: number; data: ArrayBuffer }
  | { id: number; ok: true; type: 'encode'; data: ArrayBuffer }
  | { id: number; ok: true; type: 'ping' }
  | { id: number; ok: false; error: string };

declare const self: {
  onmessage: (event: MessageEvent<JxlWorkerRequest>) => void;
  postMessage(response: JxlWorkerResponse, transfer?: Transferable[]): void;
};

let decodeReadyPromise: Promise<void> | null = null;
let encodeReadyPromise: Promise<void> | null = null;

async function getDecoder() {
  if (!decodeReadyPromise) {
    decodeReadyPromise = (async () => {
      const res = await fetch(jxlDecWasmUrl);
      if (!res.ok) {
        throw new Error(`Failed to load JXL decoder WASM asset: ${res.statusText}`);
      }
      const bytes = await res.arrayBuffer();
      const module = await WebAssembly.compile(bytes);
      await initDecode(module);
    })().catch((error: unknown) => {
      decodeReadyPromise = null;
      throw error;
    });
  }
  return decodeReadyPromise;
}

async function getEncoder() {
  if (!encodeReadyPromise) {
    encodeReadyPromise = (async () => {
      const res = await fetch(jxlEncWasmUrl);
      if (!res.ok) {
        throw new Error(`Failed to load JXL encoder WASM asset: ${res.statusText}`);
      }
      const bytes = await res.arrayBuffer();
      const module = await WebAssembly.compile(bytes);
      await initEncode(module);
    })().catch((error: unknown) => {
      encodeReadyPromise = null;
      throw error;
    });
  }
  return encodeReadyPromise;
}

function validateJxlSignature(bytes: Uint8Array): void {
  if (bytes.length < 2) {
    throw new Error('Invalid JPEG XL file: file is too small.');
  }

  // 1. Raw codestream magic FF 0A
  if (bytes[0] === 0xff && bytes[1] === 0x0a) {
    return;
  }

  // 2. 12-byte container signature: 00 00 00 0C 4A 58 4C 20 0D 0A 87 0A
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
    return;
  }

  throw new Error('Invalid JPEG XL file: unrecognized file signature.');
}

self.onmessage = async (event: MessageEvent<JxlWorkerRequest>) => {
  const req = event.data;
  if (!req || typeof req.id !== 'number') return;
  const { type } = req;

  try {
    if (req.type === 'ping') {
      await getDecoder();
      await getEncoder();
      const res: JxlWorkerResponse = { id: req.id, ok: true, type: 'ping' };
      self.postMessage(res);
      return;
    }

    if (req.type === 'decode') {
      if (req.buffer.byteLength > MAX_FILE_SIZE) {
        throw new Error('JPEG XL file exceeds the 100 MB limit.');
      }

      const bytes = new Uint8Array(req.buffer);
      validateJxlSignature(bytes);

      await getDecoder();

      let result: ImageData;
      try {
        result = await decode(req.buffer);
      } catch (err) {
        throw new Error('Failed to decode JPEG XL image: corrupted or invalid codestream.', { cause: err });
      }

      if (!result || !result.data || result.width <= 0 || result.height <= 0) {
        throw new Error('Failed to decode JPEG XL image: output buffer is empty.');
      }

      if (result.width > MAX_DIMENSION || result.height > MAX_DIMENSION || result.width * result.height > MAX_PIXELS) {
        throw new Error(`Decoded image dimensions (${result.width}x${result.height}) exceed the maximum supported size (40 megapixels).`);
      }

      const { data } = result;
      const pixelBuffer =
        data.buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
          ? data.buffer
          : data.slice().buffer;
      const res: JxlWorkerResponse = {
        id: req.id,
        ok: true,
        type: 'decode',
        width: result.width,
        height: result.height,
        data: pixelBuffer,
      };
      self.postMessage(res, [pixelBuffer]);
      return;
    }

    if (req.type === 'encode') {
      const { width, height, data, options } = req;
      if (width <= 0 || height <= 0) {
        throw new Error('Invalid image dimensions for JPEG XL encoding.');
      }

      if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
        throw new Error(`Image dimensions (${width}x${height}) exceed the maximum supported size (40 megapixels).`);
      }

      if (data.length !== width * height * 4) {
        throw new Error('Pixel buffer size does not match specified dimensions.');
      }

      await getEncoder();

      const isLossless = Boolean(options?.lossless);
      const quality = typeof options?.quality === 'number' ? options.quality : 90;
      const clampedQuality = Math.max(1, Math.min(100, Math.round(quality)));

      let encodedBuffer: ArrayBuffer;
      try {
        const imgData = new ImageData(data, width, height);
        if (isLossless) {
          encodedBuffer = await encode(imgData, { lossless: true, quality: 100 });
        } else {
          encodedBuffer = await encode(imgData, { lossless: false, quality: clampedQuality });
        }
      } catch (err) {
        throw new Error(`Failed to encode JPEG XL image: ${err instanceof Error ? err.message : 'Unknown encoding error'}`, { cause: err });
      }

      const res: JxlWorkerResponse = {
        id: req.id,
        ok: true,
        type: 'encode',
        data: encodedBuffer,
      };
      self.postMessage(res, [encodedBuffer]);
      return;
    }

    throw new Error(`Unsupported request type: ${type}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unexpected JPEG XL error';
    const res: JxlWorkerResponse = { id: req.id, ok: false, error: errorMsg };
    self.postMessage(res);
  }
};
