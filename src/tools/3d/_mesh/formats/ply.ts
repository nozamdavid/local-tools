import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import type { MeshModel } from '../types';

/**
 * Parses binary or ASCII PLY into an indexed MeshModel.
 */
export function parsePLY(buffer: ArrayBuffer, name = 'model'): MeshModel {
  const warnings: string[] = ['PLY files are unitless; coordinates assumed to be in millimeters (mm).'];

  const loader = new PLYLoader();
  let geom;
  let ignoredAttributes = false;
  try {
    geom = loader.parse(buffer);
    const hasColors = Boolean(geom.getAttribute('color'));
    const hasUVs = Boolean(geom.getAttribute('uv'));
    ignoredAttributes = hasColors || hasUVs || Boolean(geom.getAttribute('normal'));
    if (!geom.getIndex()?.count && (hasColors || hasUVs)) {
      // Face attributes can make PLYLoader expand the geometry. Read the original
      // indices without those attributes so coincident vertices stay distinct.
      loader.setPropertyNameMapping({
        red: 'ignored_red',
        diffuse_red: 'ignored_diffuse_red',
        r: 'ignored_r',
        diffuse_r: 'ignored_diffuse_r',
        texcoord: 'ignored_texcoord',
      });
      geom.dispose();
      geom = loader.parse(buffer);
    }
  } catch (err) {
    throw new Error(`Failed to parse PLY file: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  try {
    const posAttr = geom.getAttribute('position');
    if (!posAttr?.count || posAttr.itemSize !== 3) {
      throw new Error('Corrupt PLY file: no vertex positions found.');
    }
    const indexAttr = geom.getIndex();
    if (!indexAttr?.count) {
      throw new Error('PLY contains no supported faces. Point clouds are not supported.');
    }
    if (ignoredAttributes) warnings.push('Vertex colors and custom attributes were ignored (geometry-only import).');

    return {
      name,
      positions: new Float32Array(posAttr.array),
      indices: new Uint32Array(indexAttr.array),
      warnings,
    };
  } finally {
    geom.dispose();
  }
}

/**
 * Serializes a MeshModel to ASCII PLY format.
 */
export function exportPLY(model: MeshModel): string {
  const { positions, indices } = model;
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;

  const header =
    [
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
