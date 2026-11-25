import type { MeshModel } from './types';

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_CAD_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_TRIANGLE_COUNT = 1_000_000; // 1 million triangles
export const MAX_VERTEX_COUNT = 3_000_000; // 3 million coordinates (1M vertices)
export const MAX_ZIP_UNCOMPRESSED_BYTES = 128 * 1024 * 1024; // 128 MB expanded ZIP
export const MAX_ZIP_ENTRY_COUNT = 10_000;

export interface MeshGeometryLimits {
  readonly maxTriangles: number;
  readonly maxVertices: number;
}

export const DEFAULT_MESH_GEOMETRY_LIMITS: MeshGeometryLimits = {
  maxTriangles: MAX_TRIANGLE_COUNT,
  maxVertices: MAX_VERTEX_COUNT / 3,
};

export const VIEWER_3MF_GEOMETRY_LIMITS: MeshGeometryLimits = {
  maxTriangles: 4_000_000,
  maxVertices: 4_000_000,
};

export function validateFileSize(sizeBytes: number, filename: string, maxBytes: number = MAX_FILE_SIZE_BYTES): void {
  if (sizeBytes > maxBytes) {
    const maxMb = (maxBytes / (1024 * 1024)).toFixed(0);
    throw new Error(`File "${filename}" (${(sizeBytes / (1024 * 1024)).toFixed(1)} MB) exceeds maximum supported size of ${maxMb} MB.`);
  }
}

export function validateMeshModel(model: MeshModel, limits = DEFAULT_MESH_GEOMETRY_LIMITS): void {
  if (!model) {
    throw new Error('MeshModel cannot be null or undefined.');
  }

  const { positions, indices } = model;
  if (!positions || !indices) {
    throw new Error('MeshModel must contain positions and indices buffers.');
  }

  if (positions.length % 3 !== 0) {
    throw new Error(`Invalid positions buffer length: ${positions.length} is not a multiple of 3 (X, Y, Z).`);
  }

  if (indices.length % 3 !== 0) {
    throw new Error(`Invalid indices buffer length: ${indices.length} is not a multiple of 3 (triangle indices).`);
  }

  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;

  if (triangleCount > limits.maxTriangles) {
    throw new Error(
      `Triangle count (${triangleCount.toLocaleString()}) exceeds maximum allowed limit of ${limits.maxTriangles.toLocaleString()}.`,
    );
  }

  if (vertexCount > limits.maxVertices) {
    throw new Error(`Vertex coordinate count (${positions.length.toLocaleString()}) exceeds maximum allowed limit.`);
  }

  // Check finite coordinates
  for (let i = 0; i < positions.length; i++) {
    const val = positions[i];
    if (!Number.isFinite(val)) {
      throw new Error(`Invalid mesh: coordinate at index ${i} is non-finite (${val}).`);
    }
  }

  // Check index bounds
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (idx >= vertexCount) {
      throw new Error(`Invalid mesh: triangle index ${idx} at position ${i} is out of bounds (vertex count: ${vertexCount}).`);
    }
  }
}
