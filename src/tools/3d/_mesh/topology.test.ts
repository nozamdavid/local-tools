import { expect, it } from 'vitest';
import { analyzeMesh, mergeMeshModels, splitComponents } from './topology';
import { flipNormals, transformMesh } from './transforms';

it('preserves reflected winding and local indices through merge and split', () => {
  const triangle = {
    name: 'triangle',
    positions: new Float32Array([1, 0, 4, 2, 0, 4, 1, 2, 4]),
    indices: new Uint32Array([0, 1, 2]),
    warnings: [],
  };
  const reflected = transformMesh(triangle, [-2, 1, 1], [0, 0, 0], false, true);
  expect([...reflected.indices]).toEqual([0, 2, 1]);
  expect([...flipNormals(reflected, true).indices]).toEqual([0, 1, 2]);
  const merged = mergeMeshModels([triangle, reflected]);
  expect(analyzeMesh(merged)).toMatchObject({ vertices: 6, triangles: 2, components: 2 });
  const parts = splitComponents(merged);
  expect(parts.map((part) => [...part.indices])).toEqual([
    [0, 1, 2],
    [0, 1, 2],
  ]);
  expect(parts.map((part) => analyzeMesh(part).bounds)).toEqual([
    { min: [1, 0, 4], max: [2, 2, 4], size: [1, 2, 0] },
    { min: [-4, 0, 0], max: [-2, 2, 0], size: [2, 2, 0] },
  ]);
});
