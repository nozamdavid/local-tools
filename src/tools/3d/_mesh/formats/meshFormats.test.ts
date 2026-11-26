import { expect, it } from 'vitest';
import { analyzeMesh } from '../topology';
import { exportOBJ, parseOBJ } from './obj';
import { exportPLY, parsePLY } from './ply';
import { exportSTL, parseSTL } from './stl';

const encode = (text: string) => new TextEncoder().encode(text).buffer;

it('retains a folded OBJ quad when two distinct corners project to the same point', () => {
  const model = parseOBJ('v 0 0 0\nv 2 0 0\nv 0 2 0\nv 0 0 1\nf 1 2 3 4');
  expect([...model.indices]).toEqual([0, 1, 2, 0, 2, 3]);
  expect(analyzeMesh(model)).toMatchObject({ triangles: 2, surfaceArea: 3 });
});

it('roundtrips ASCII STL decimals through binary STL', () => {
  const ascii = `solid triangle
  facet normal 0 0 1
    outer loop
      vertex .5 0 0.
      vertex 2. 0 0.
      vertex .5 3 0.
    endloop
  endfacet
endsolid triangle`;
  const mesh = parseSTL(encode(ascii));
  const binary = exportSTL(mesh);
  const padded = new Uint8Array(binary.byteLength + 2);
  padded.set(new Uint8Array(binary));
  const result = parseSTL(padded.buffer);
  expect([...result.indices]).toEqual([0, 1, 2]);
  expect(analyzeMesh(result).bounds).toEqual({ min: [0.5, 0, 0], max: [2, 3, 0], size: [1.5, 3, 0] });
});

it('keeps separate indexed PLY faces that share a position when dropping face colors', () => {
  const ply = `ply
format ascii 1.0
element vertex 6
property float x
property float y
property float z
element face 2
property list uchar uint vertex_indices
property uchar red
property uchar green
property uchar blue
end_header
0 0 0
2 0 0
0 2 0
0 0 0
-2 0 0
0 -2 0
3 0 1 2 255 0 0
3 3 4 5 0 0 255
`;
  const mesh = parsePLY(encode(ply));
  const result = parsePLY(encode(exportPLY(mesh)));
  expect([...result.indices]).toEqual([0, 1, 2, 3, 4, 5]);
  expect(analyzeMesh(result)).toMatchObject({ vertices: 6, triangles: 2, components: 2 });
});

it('roundtrips a concave clockwise OBJ polygon without covering its notch', () => {
  const mesh = parseOBJ('v 0 0 0\nv 0 3 0\nv 3 3 0\nv 3 2 0\nv 1 2 0\nv 1 1 0\nv 3 1 0\nv 3 0 0\nf -8 -7 -6 -5 -4 -3 -2 -1');
  const result = parseOBJ(exportOBJ(mesh));
  expect(analyzeMesh(result)).toMatchObject({ vertices: 8, triangles: 6, surfaceArea: 7 });
  const { indices, positions } = result;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.subarray(i, i + 3).map((index) => index * 3);
    const cross =
      (positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1]) -
      (positions[b + 1] - positions[a + 1]) * (positions[c] - positions[a]);
    expect(cross).toBeLessThan(0);
  }
});
