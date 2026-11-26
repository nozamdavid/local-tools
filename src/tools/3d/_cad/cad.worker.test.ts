import { expect, it, vi } from 'vitest';
import { analyzeMesh } from '../_mesh/topology';
import type { CadWorkerConvertJob, CadWorkerResponse } from './types';

vi.mock('occt-import-js', () => ({
  default: async () => ({
    ReadStepFile: () => ({
      success: true,
      meshes: [
        { attributes: { position: { array: [0, 0, 0, 2, 0, 0, 0, 2, 0] } }, index: { array: [0, 1, 2] } },
        { attributes: { position: { array: [0, 0, 0, -2, 0, 0, 0, -2, 0] } }, index: { array: [0, 1, 2] } },
      ],
    }),
  }),
}));

it('keeps distinct CAD parts separate when their tessellated vertices touch', async () => {
  let worker: { onmessage?: (event: { data: CadWorkerConvertJob }) => void; postMessage: (response: CadWorkerResponse) => void };
  const response = new Promise<CadWorkerResponse>((resolve) => {
    worker = { postMessage: resolve };
  });
  vi.stubGlobal('self', worker!);
  try {
    await import('./cad.worker');
    worker!.onmessage!({
      data: { type: 'convert', id: 1, fileName: 'touching.step', format: 'step', buffer: new ArrayBuffer(1), quality: 'standard' },
    });
    const result = await response;
    if (!result.ok) throw new Error(result.error);
    expect(analyzeMesh(result.model)).toMatchObject({
      vertices: 6,
      triangles: 2,
      components: 2,
      bounds: { min: [-2, -2, 0], max: [2, 2, 0], size: [4, 4, 0] },
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
