import type { MeshModel } from '../types';
import { weldExactVertices } from '../topology';

/**
 * Parses binary or ASCII STL into an indexed MeshModel.
 */
export function parseSTL(buffer: ArrayBuffer, name = 'model'): MeshModel {
  if (buffer.byteLength < 15) {
    throw new Error('STL file is too small to be valid.');
  }

  const warnings: string[] = ['STL files are unitless; coordinates assumed to be in millimeters (mm).'];

  // Try binary detection first
  const decoder = new TextDecoder();
  if (buffer.byteLength >= 84) {
    const view = new DataView(buffer);
    const triangleCount = view.getUint32(80, true);
    const expectedBinarySize = 84 + triangleCount * 50;
    const header = decoder.decode(new Uint8Array(buffer, 0, 80));
    if (
      buffer.byteLength === expectedBinarySize ||
      (triangleCount > 0 && buffer.byteLength > expectedBinarySize && !/^\s*solid\b/i.test(header))
    ) {
      return parseBinarySTL(buffer, name, warnings);
    }
  }

  // Fallback to ASCII
  const text = decoder.decode(buffer);
  if (/^\s*solid/i.test(text) || text.includes('facet') || text.includes('vertex')) {
    try {
      return parseAsciiSTL(text, name, warnings);
    } catch (asciiErr) {
      // If ASCII failed but size could be binary (e.g. trailing bytes), try binary if header looks reasonable
      if (buffer.byteLength >= 84) {
        try {
          return parseBinarySTL(buffer, name, warnings);
        } catch {
          // ignore
        }
      }
      throw asciiErr;
    }
  }

  throw new Error('Unrecognized STL format: neither valid binary nor ASCII STL.');
}

function parseBinarySTL(buffer: ArrayBuffer, name: string, warnings: string[]): MeshModel {
  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  const expectedSize = 84 + triangleCount * 50;
  if (triangleCount === 0) throw new Error('Corrupt binary STL: no triangles found.');

  if (buffer.byteLength < expectedSize) {
    throw new Error(
      `Corrupt binary STL: expected at least ${expectedSize} bytes for ${triangleCount} triangles, found ${buffer.byteLength} bytes.`,
    );
  }

  const rawPositions = new Float32Array(triangleCount * 9);
  let posIdx = 0;
  let offset = 84;

  for (let t = 0; t < triangleCount; t++) {
    // Skip 12 bytes normal (offset + 0..11)
    offset += 12;

    // 3 vertices (36 bytes)
    for (let v = 0; v < 3; v++) {
      rawPositions[posIdx++] = view.getFloat32(offset, true);
      rawPositions[posIdx++] = view.getFloat32(offset + 4, true);
      rawPositions[posIdx++] = view.getFloat32(offset + 8, true);
      offset += 12;
    }

    // Skip 2 bytes attribute byte count
    offset += 2;
  }

  const { positions, indices } = weldExactVertices(rawPositions);

  return {
    name,
    positions,
    indices,
    warnings,
  };
}

function parseAsciiSTL(text: string, name: string, warnings: string[]): MeshModel {
  const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  const rawCoords: number[] = [];
  for (const line of text.matchAll(/^[^\S\r\n]*vertex\b([^\r\n]*)/gim)) {
    const coordinates = line[1].trim().split(/\s+/);
    if (coordinates.length !== 3 || !coordinates.every((value) => number.test(value))) {
      throw new Error('Corrupt ASCII STL: invalid or incomplete triangle definitions.');
    }
    rawCoords.push(...coordinates.map(Number));
  }

  if (rawCoords.length === 0 || rawCoords.length % 9 !== 0) {
    throw new Error('Corrupt ASCII STL: invalid or incomplete triangle definitions.');
  }

  const { positions, indices } = weldExactVertices(new Float32Array(rawCoords));

  return {
    name,
    positions,
    indices,
    warnings,
  };
}

/**
 * Serializes a MeshModel to binary STL.
 */
export function exportSTL(model: MeshModel): ArrayBuffer {
  const { positions, indices } = model;
  const triangleCount = indices.length / 3;
  const totalBytes = 84 + triangleCount * 50;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  // The first 80 bytes are reserved for the header and stay zero-filled.

  // 4 bytes triangle count
  view.setUint32(80, triangleCount, true);

  let offset = 84;

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];

    const x0 = positions[i0 * 3];
    const y0 = positions[i0 * 3 + 1];
    const z0 = positions[i0 * 3 + 2];

    const x1 = positions[i1 * 3];
    const y1 = positions[i1 * 3 + 1];
    const z1 = positions[i1 * 3 + 2];

    const x2 = positions[i2 * 3];
    const y2 = positions[i2 * 3 + 1];
    const z2 = positions[i2 * 3 + 2];

    // Compute surface normal
    const ux = x1 - x0,
      uy = y1 - y0,
      uz = z1 - z0;
    const wx = x2 - x0,
      wy = y2 - y0,
      wz = z2 - z0;
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0;
      ny = 0;
      nz = 0;
    }

    // Normal
    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);
    offset += 12;

    // V0
    view.setFloat32(offset, x0, true);
    view.setFloat32(offset + 4, y0, true);
    view.setFloat32(offset + 8, z0, true);
    offset += 12;

    // V1
    view.setFloat32(offset, x1, true);
    view.setFloat32(offset + 4, y1, true);
    view.setFloat32(offset + 8, z1, true);
    offset += 12;

    // V2
    view.setFloat32(offset, x2, true);
    view.setFloat32(offset + 4, y2, true);
    view.setFloat32(offset + 8, z2, true);
    offset += 12;

    // Attribute byte count = 0
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return buffer;
}
