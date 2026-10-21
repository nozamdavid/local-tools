import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import type { MeshModel } from '../types';
import { weldExactVertices } from '../topology';

/**
 * Parses binary or ASCII PLY into an indexed MeshModel.
 */
export function parsePLY(buffer: ArrayBuffer, name = 'model'): MeshModel {
  const warnings: string[] = [
    'PLY files are unitless; coordinates assumed to be in millimeters (mm).',
  ];

  const loader = new PLYLoader();
  let geom;
  try {
    geom = loader.parse(buffer);
  } catch (err) {
    throw new Error(`Failed to parse PLY file: ${err instanceof Error ? err.message : String(err)}`);
  }

  const posAttr = geom.getAttribute('position');
  if (!posAttr || posAttr.count === 0) {
    throw new Error('Corrupt PLY file: no vertex positions found.');
  }

  const rawPositions = new Float32Array(posAttr.array);
  const indexAttr = geom.getIndex();

  if (geom.getAttribute('color') || geom.getAttribute('normal')) {
    warnings.push('Vertex colors and custom attributes were ignored (geometry-only import).');
  }

  if (indexAttr) {
    const indices = new Uint32Array(indexAttr.array);
    return {
      name,
      positions: rawPositions,
      indices,
      warnings,
    };
  }

  // Non-indexed PLY (triangle soup): weld exact vertices
  const { positions, indices } = weldExactVertices(rawPositions);

  return {
    name,
    positions,
    indices,
    warnings,
  };
}

/**
 * Serializes a MeshModel to ASCII PLY format.
 */
export function exportPLY(model: MeshModel): string {
  const { positions, indices } = model;
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;

  const header = [
    'ply',
    'format ascii 1.0',
    'comment Loconvert PLY Export - Local Browser Processing',
    `element vertex ${vertexCount}`,
    'property float x',
    'property float y',
    'property float z',
    `element face ${triangleCount}`,
    'property list uchar uint vertex_indices',
    'end_header',
  ].join('\n') + '\n';

  let body = '';
  for (let i = 0; i < positions.length; i += 3) {
    body += `${positions[i]} ${positions[i + 1]} ${positions[i + 2]}\n`;
  }

  for (let t = 0; t < indices.length; t += 3) {
    body += `3 ${indices[t]} ${indices[t + 1]} ${indices[t + 2]}\n`;
  }

  return header + body;
}
