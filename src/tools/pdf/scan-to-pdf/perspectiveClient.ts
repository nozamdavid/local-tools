import { MAX_PERSPECTIVE_SIDE, type PerspectiveCorners } from './perspective';

interface WarpRequest {
  source: ArrayBuffer;
  sourceWidth: number;
  sourceHeight: number;
  corners: PerspectiveCorners;
}

type WarpResponse = { ok: true; data: ArrayBuffer; width: number; height: number } | { ok: false; error: string };

export interface PerspectiveCorrectionJob {
  promise: Promise<Blob>;
  cancel: () => void;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the corrected page.'))), 'image/jpeg', 0.92),
  );
}

export function createPerspectiveCorrectionJob(blob: Blob, corners: PerspectiveCorners): PerspectiveCorrectionJob {
  const worker = new Worker(new URL('./perspective.worker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  let rejectJob: ((error: Error) => void) | null = null;

  const promise = new Promise<Blob>((resolve, reject) => {
    rejectJob = reject;
    const finish = () => {
      if (settled) return false;
      settled = true;
      worker.terminate();
      return true;
    };

    worker.onmessage = async (event: MessageEvent<WarpResponse>) => {
      const response = event.data;
      if (!finish()) return;
      if (!response.ok) {
        reject(new Error(response.error));
        return;
      }

      const canvas = makeCanvas(response.width, response.height);
      try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D is unavailable.');
        context.putImageData(new ImageData(new Uint8ClampedArray(response.data), response.width, response.height), 0, 0);
        resolve(await toJpeg(canvas));
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Could not encode the corrected page.'));
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    };

    worker.onerror = (event) => {
      if (!finish()) return;
      reject(new Error(event.message || 'Perspective correction failed.'));
    };

    void (async () => {
      let bitmap: ImageBitmap | null = null;
      let canvas: HTMLCanvasElement | null = null;
      try {
        bitmap = await createImageBitmap(blob);
        if (settled) return;
        if (
          bitmap.width < 1 ||
          bitmap.height < 1 ||
          bitmap.width > MAX_PERSPECTIVE_SIDE ||
          bitmap.height > MAX_PERSPECTIVE_SIDE ||
          bitmap.width * bitmap.height > MAX_PERSPECTIVE_SIDE * MAX_PERSPECTIVE_SIDE
        ) {
          throw new RangeError(`Page dimensions exceed ${MAX_PERSPECTIVE_SIDE} pixels per side.`);
        }

        canvas = makeCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas 2D is unavailable.');
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
        const request: WarpRequest = {
          source: pixels.data.buffer as ArrayBuffer,
          sourceWidth: bitmap.width,
          sourceHeight: bitmap.height,
          corners,
        };
        bitmap.close();
        bitmap = null;
        canvas.width = 0;
        canvas.height = 0;
        canvas = null;
        if (settled) return;
        worker.postMessage(request, [request.source]);
      } catch (error) {
        if (settled) return;
        settled = true;
        worker.terminate();
        reject(error instanceof Error ? error : new Error('Could not read the page image.'));
      } finally {
        bitmap?.close();
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    })();
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectJob?.(new DOMException('Perspective correction was canceled.', 'AbortError'));
    },
  };
}
