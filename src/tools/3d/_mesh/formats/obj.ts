import type { MeshModel } from '../types';

/**
 * Parses Wavefront OBJ into an indexed MeshModel (geometry only).
 * Ignores mtl / texture references without network requests.
 * Handles negative indices and polygon fan triangulation.
 */
export function parseOBJ(text: string, name = 'model'): MeshModel {
  const warnings: string[] = ['OBJ files are unitless; coordinates assumed to be in millimeters (mm).'];

  let hasMaterials = false;
  let hasUVs = false;

  const rawPositions: number[] = [];
  const rawIndices: number[] = [];

  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('mtllib ') || line.startsWith('usemtl ')) {
      hasMaterials = true;
      continue;
    }

    if (line.startsWith('vt ')) {
      hasUVs = true;
      continue;
    }

    if (line.startsWith('v ')) {
      const parts = line.substring(2).trim().split(/\s+/);
      if (parts.length >= 3) {
        rawPositions.push(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]));
      }
      continue;
    }

    if (line.startsWith('f ')) {
      const parts = line.substring(2).trim().split(/\s+/);
      if (parts.length < 3) continue;

      const totalVerticesSoFar = rawPositions.length / 3;
      const faceIndices: number[] = [];

      for (let p = 0; p < parts.length; p++) {
        const token = parts[p];
        const slashIdx = token.indexOf('/');
        const vertexStr = slashIdx === -1 ? token : token.substring(0, slashIdx);
        const vIdx = parseInt(vertexStr, 10);

        if (isNaN(vIdx)) continue;

        if (vIdx > 0) {
          // 1-based index
          faceIndices.push(vIdx - 1);
        } else if (vIdx < 0) {
          // Relative negative index
          faceIndices.push(totalVerticesSoFar + vIdx);
        }
      }

      // Fan triangulation for convex polygons / quads
      for (let t = 1; t < faceIndices.length - 1; t++) {
        rawIndices.push(faceIndices[0], faceIndices[t], faceIndices[t + 1]);
      }
    }
  }

  if (hasMaterials || hasUVs) {
    warnings.push('Materials, textures, and UV coordinates were ignored (geometry-only import).');
  }

  if (rawPositions.length === 0 || rawIndices.length === 0) {
    throw new Error('Corrupt or empty OBJ file: no vertices or faces found.');
  }

  // Validate indices are within bounds
  const vertexCount = rawPositions.length / 3;
  for (let i = 0; i < rawIndices.length; i++) {
    const idx = rawIndices[i];
    if (idx < 0 || idx >= vertexCount) {
      throw new Error(`Corrupt OBJ file: face index ${idx} is out of bounds (vertex count: ${vertexCount}).`);
    }
  }

  return {
    name,
    positions: new Float32Array(rawPositions),
    indices: new Uint32Array(rawIndices),
    warnings,
  };
}

/**
 * Serializes a MeshModel to OBJ text format.
 */
export function exportOBJ(model: MeshModel): string {
  const { positions, indices } = model;
  const lines: string[] = [
    '# Loconvert OBJ Export - Local Browser Processing',
    `# Vertices: ${positions.length / 3}`,
    `# Triangles: ${indices.length / 3}`,
  ];

  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`v ${positions[i]} ${positions[i + 1]} ${positions[i + 2]}`);
  }

  for (let t = 0; t < indices.length; t += 3) {
    lines.push(`f ${indices[t] + 1} ${indices[t + 1] + 1} ${indices[t + 2] + 1}`);
  }

  return lines.join('\n') + '\n';
}
