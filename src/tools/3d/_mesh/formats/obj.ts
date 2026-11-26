import { ShapeUtils, Vector2 } from 'three';
import type { MeshModel } from '../types';

function triangulateFace(face: number[], positions: number[], indices: number[]): void {
  if (face.length === 3) {
    indices.push(face[0], face[1], face[2]);
    return;
  }

  // Project onto the plane perpendicular to the dominant polygon normal.
  const origin = face[0] * 3;
  const normal = [0, 0, 0];
  for (let i = 1; i < face.length - 1; i++) {
    const a = face[i] * 3;
    const b = face[i + 1] * 3;
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      normal[axis] +=
        (positions[a + u] - positions[origin + u]) * (positions[b + v] - positions[origin + v]) -
        (positions[a + v] - positions[origin + v]) * (positions[b + u] - positions[origin + u]);
    }
  }
  const abs = normal.map(Math.abs);
  const axis = abs.indexOf(Math.max(...abs));
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  const contour = face.map(
    (index) => new Vector2(positions[index * 3 + u] - positions[origin + u], positions[index * 3 + v] - positions[origin + v]),
  );
  const clockwise = ShapeUtils.isClockWise(contour);
  const triangles = ShapeUtils.triangulateShape(contour, []);
  if (triangles.length < face.length - 2) {
    // A folded face can have distinct 3D corners that coincide in this projection.
    const nonplanar = face.some((index) => {
      const dx = positions[index * 3] - positions[origin];
      const dy = positions[index * 3 + 1] - positions[origin + 1];
      const dz = positions[index * 3 + 2] - positions[origin + 2];
      const distance = dx * normal[0] + dy * normal[1] + dz * normal[2];
      return Math.abs(distance) > 1e-10 * abs[axis] * Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    });
    if (nonplanar) {
      for (let i = 1; i < face.length - 1; i++) indices.push(face[0], face[i], face[i + 1]);
      return;
    }
  }
  if (!triangles.length) throw new Error('Corrupt OBJ file: could not triangulate face.');
  for (const [a, b, c] of triangles) {
    indices.push(face[a], face[clockwise ? c : b], face[clockwise ? b : c]);
  }
}

/**
 * Parses Wavefront OBJ into an indexed MeshModel (geometry only).
 * Ignores mtl / texture references without network requests.
 * Handles negative indices and triangulates planar polygons.
 */
export function parseOBJ(text: string, name = 'model'): MeshModel {
  const warnings: string[] = ['OBJ files are unitless; coordinates assumed to be in millimeters (mm).'];

  let hasMaterials = false;
  let hasUVs = false;

  const rawPositions: number[] = [];
  const faces: number[][] = [];

  const lines = text.split(/\r\n|\r|\n/);

  for (const sourceLine of lines) {
    const line = sourceLine.split('#', 1)[0].trim();
    if (!line) continue;
    const [keyword, ...parts] = line.split(/\s+/);

    if (keyword === 'mtllib' || keyword === 'usemtl') {
      hasMaterials = true;
      continue;
    }

    if (keyword === 'vt') {
      hasUVs = true;
      continue;
    }

    if (keyword === 'v') {
      const coords = parts.slice(0, 3);
      const values = coords.map(Number);
      if (
        coords.length !== 3 ||
        !coords.every((value) => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) ||
        !values.every((value) => Number.isFinite(Math.fround(value)))
      ) {
        throw new Error('Corrupt OBJ file: invalid vertex coordinates.');
      }
      rawPositions.push(...values);
      continue;
    }

    if (keyword === 'f') {
      if (parts.length < 3) continue;

      const totalVerticesSoFar = rawPositions.length / 3;
      const faceIndices: number[] = [];

      for (let p = 0; p < parts.length; p++) {
        const token = parts[p];
        const slashIdx = token.indexOf('/');
        const vertexStr = slashIdx === -1 ? token : token.substring(0, slashIdx);
        const vIdx = parseInt(vertexStr, 10);

        if (!/^[+-]?\d+$/.test(vertexStr) || vIdx === 0) {
          throw new Error(`Corrupt OBJ file: invalid face index "${vertexStr}".`);
        }

        if (vIdx > 0) {
          // 1-based index
          faceIndices.push(vIdx - 1);
        } else if (vIdx < 0) {
          // Relative negative index
          const relativeIndex = totalVerticesSoFar + vIdx;
          if (relativeIndex < 0) throw new Error(`Corrupt OBJ file: relative face index ${vIdx} is out of bounds.`);
          faceIndices.push(relativeIndex);
        }
      }

      faces.push(faceIndices);
    }
  }

  if (hasMaterials || hasUVs) {
    warnings.push('Materials, textures, and UV coordinates were ignored (geometry-only import).');
  }

  if (rawPositions.length === 0 || faces.length === 0) {
    throw new Error('Corrupt or empty OBJ file: no vertices or faces found.');
  }

  const vertexCount = rawPositions.length / 3;
  const rawIndices: number[] = [];
  for (const face of faces) {
    for (const idx of face) {
      if (idx < 0 || idx >= vertexCount) {
        throw new Error(`Corrupt OBJ file: face index ${idx} is out of bounds (vertex count: ${vertexCount}).`);
      }
    }
    triangulateFace(face, rawPositions, rawIndices);
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
