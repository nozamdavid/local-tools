import { warpPerspective, type PerspectiveCorners } from './perspective';

interface WarpRequest {
  source: ArrayBuffer;
  sourceWidth: number;
  sourceHeight: number;
  corners: PerspectiveCorners;
}

type WarpResponse = { ok: true; data: ArrayBuffer; width: number; height: number } | { ok: false; error: string };

self.onmessage = (event: MessageEvent<WarpRequest>) => {
  try {
    const { source, sourceWidth, sourceHeight, corners } = event.data;
    const result = warpPerspective(new Uint8ClampedArray(source), sourceWidth, sourceHeight, corners);
    const response: WarpResponse = { ok: true, data: result.data.buffer as ArrayBuffer, width: result.width, height: result.height };
    (self.postMessage as (message: WarpResponse, transfer: Transferable[]) => void)(response, [response.data]);
  } catch (error) {
    const response: WarpResponse = {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not correct this page perspective.',
    };
    self.postMessage(response);
  }
};
