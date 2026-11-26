import type { MeshModel, MeshStats } from './types';
import { validateMeshModel } from './validation';

function vertexConnections(vertexCount: number) {
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;

  function find(index: number): number {
    while (index !== parent[index]) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }

  return {
    find,
    union(a: number, b: number) {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) parent[rootA] = rootB;
    },
  };
}

/**
 * Welds coincident vertices within a tolerance (default 1e-5 mm = 10 nm)
 * to convert triangle soups (like unindexed STLs) into manifold-ready indexed geometry.
 */
export function weldExactVertices(unindexedPositions: Float32Array, tolerance = 1e-5): { positions: Float32Array; indices: Uint32Array } {
  const { positions, remap } = weldPositions(unindexedPositions, tolerance);
  return { positions, indices: remap };
}

/**
 * Welds coincident vertices within a tolerance (default 1e-5 mm = 10 nm)
 * on an already-indexed mesh, resolving seam cracks and face-boundary vertex duplications
 * while preserving geometry.
 */
export function weldIndexedVertices(
  positions: Float32Array,
  indices: Uint32Array,
  tolerance = 1e-5,
): { positions: Float32Array; indices: Uint32Array } {
  const { positions: welded, remap } = weldPositions(positions, tolerance);
  return { positions: welded, indices: indices.map((index) => remap[index]) };
}

function weldPositions(positions: Float32Array, tolerance: number) {
  const factor = 1 / Math.max(tolerance, 1e-9);
  const vertexCount = positions.length / 3;
  const remap = new Uint32Array(vertexCount);
  const weldedPos: number[] = [];
  const map = new Map<string, number>();
  let nextIndex = 0;

  for (let i = 0; i < vertexCount; i++) {
    let x = positions[i * 3];
    let y = positions[i * 3 + 1];
    let z = positions[i * 3 + 2];
    if (x === 0) x = 0;
    if (y === 0) y = 0;
    if (z === 0) z = 0;

    const kx = Math.round(x * factor);
    const ky = Math.round(y * factor);
    const kz = Math.round(z * factor);
    const key = `${kx}_${ky}_${kz}`;

    let idx = map.get(key);
    if (idx === undefined) {
      idx = nextIndex++;
      map.set(key, idx);
      weldedPos.push(x, y, z);
    }
    remap[i] = idx;
  }

  return {
    positions: new Float32Array(weldedPos),
    remap,
  };
}

/**
 * Computes topological and geometric metrics for a MeshModel.
 */
export function analyzeMesh(model: MeshModel): MeshStats {
  validateMeshModel(model);

  const { positions, indices } = model;
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  if (vertexCount === 0) {
    minX = minY = minZ = maxX = maxY = maxZ = 0;
  }

  const bounds = {
    min: [minX, minY, minZ] as [number, number, number],
    max: [maxX, maxY, maxZ] as [number, number, number],
    size: [Math.max(0, maxX - minX), Math.max(0, maxY - minY), Math.max(0, maxZ - minZ)] as [number, number, number],
  };

  let surfaceArea = 0;
  let signedVolumeSum = 0;
  let degenerateTriangles = 0;

  // Track edge face count and directed half-edges
  // Edge key: (BigInt(min) << 32n) | BigInt(max)
  const edgeCountMap = new Map<bigint, number>();
  const directedEdgeMap = new Map<bigint, { forward: number; backward: number }>();

  const { find, union } = vertexConnections(vertexCount);
  const referencedVertices = new Uint8Array(vertexCount);

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];

    referencedVertices[i0] = 1;
    referencedVertices[i1] = 1;
    referencedVertices[i2] = 1;

    // Check for coincident vertex indices
    if (i0 === i1 || i1 === i2 || i0 === i2) {
      degenerateTriangles++;
      continue;
    }

    const x0 = positions[i0 * 3];
    const y0 = positions[i0 * 3 + 1];
    const z0 = positions[i0 * 3 + 2];

    const x1 = positions[i1 * 3];
    const y1 = positions[i1 * 3 + 1];
    const z1 = positions[i1 * 3 + 2];

    const x2 = positions[i2 * 3];
    const y2 = positions[i2 * 3 + 1];
    const z2 = positions[i2 * 3 + 2];

    const ux = x1 - x0;
    const uy = y1 - y0;
    const uz = z1 - z0;

    const wx = x2 - x0;
    const wy = y2 - y0;
    const wz = z2 - z0;

    const cx = uy * wz - uz * wy;
    const cy = uz * wx - ux * wz;
    const cz = ux * wy - uy * wx;

    const lenSq = cx * cx + cy * cy + cz * cz;
    if (lenSq < 1e-16) {
      degenerateTriangles++;
      continue;
    }

    const triArea = 0.5 * Math.sqrt(lenSq);
    surfaceArea += triArea;

    // Divergence theorem for closed polyhedron signed volume
    signedVolumeSum += (x0 * (y1 * z2 - y2 * z1) + y0 * (z1 * x2 - z2 * x1) + z0 * (x1 * y2 - x2 * y1)) / 6;

    // Connect vertices for component tracking
    union(i0, i1);
    union(i1, i2);

    // Track 3 edges of the triangle
    const edges: Array<[number, number]> = [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ];

    for (let e = 0; e < 3; e++) {
      const [u, v] = edges[e];
      const minIdx = u < v ? u : v;
      const maxIdx = u < v ? v : u;
      const key = (BigInt(minIdx) << 32n) | BigInt(maxIdx);

      edgeCountMap.set(key, (edgeCountMap.get(key) || 0) + 1);

      let dir = directedEdgeMap.get(key);
      if (!dir) {
        dir = { forward: 0, backward: 0 };
        directedEdgeMap.set(key, dir);
      }
      if (u < v) {
        dir.forward++;
      } else {
        dir.backward++;
      }
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;

  for (const [key, count] of edgeCountMap.entries()) {
    if (count === 1) {
      boundaryEdges++;
    } else if (count > 2) {
      nonManifoldEdges++;
    } else if (count === 2) {
      const dir = directedEdgeMap.get(key);
      // If two faces share an edge, they must traverse it in opposite directions for consistent winding
      if (dir && (dir.forward !== 1 || dir.backward !== 1)) {
        nonManifoldEdges++;
      }
    }
  }

  // Count connected components
  const rootSet = new Set<number>();
  for (let i = 0; i < vertexCount; i++) {
    if (referencedVertices[i]) {
      rootSet.add(find(i));
    }
  }
  const components = rootSet.size;

  const isWatertight = vertexCount >= 3 && triangleCount >= 1 && boundaryEdges === 0 && nonManifoldEdges === 0 && degenerateTriangles === 0;

  const volume = isWatertight ? Math.abs(signedVolumeSum) : null;

  return {
    vertices: vertexCount,
    triangles: triangleCount,
    bounds,
    surfaceArea,
    volume,
    boundaryEdges,
    nonManifoldEdges,
    degenerateTriangles,
    components,
    watertight: isWatertight,
  };
}

/**
 * Splits a mesh into independent disconnected components.
 */
export function splitComponents(model: MeshModel): MeshModel[] {
  validateMeshModel(model);

  const { positions, indices } = model;
  const vertexCount = positions.length / 3;

  const { find, union } = vertexConnections(vertexCount);
  for (let t = 0; t < indices.length; t += 3) {
    union(indices[t], indices[t + 1]);
    union(indices[t + 1], indices[t + 2]);
  }

  // Group triangles by component root
  const componentTriangles = new Map<number, number[]>();
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(indices[t]);
    let list = componentTriangles.get(root);
    if (!list) {
      list = [];
      componentTriangles.set(root, list);
    }
    list.push(indices[t], indices[t + 1], indices[t + 2]);
  }

  if (componentTriangles.size <= 1) {
    return [
      {
        name: model.name,
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        warnings: [...model.warnings],
      },
    ];
  }

  const results: MeshModel[] = [];
  let partIndex = 1;
  // Each input vertex belongs to exactly one component.
  const oldToNew = new Int32Array(vertexCount).fill(-1);

  for (const triList of componentTriangles.values()) {
    const newPositions: number[] = [];
    const newIndices = new Uint32Array(triList.length);
    let nextIdx = 0;

    for (let i = 0; i < triList.length; i++) {
      const oldIdx = triList[i];
      let newIdx = oldToNew[oldIdx];
      if (newIdx === -1) {
        newIdx = nextIdx++;
        oldToNew[oldIdx] = newIdx;
        newPositions.push(positions[oldIdx * 3], positions[oldIdx * 3 + 1], positions[oldIdx * 3 + 2]);
      }
      newIndices[i] = newIdx;
    }

    results.push({
      name: `${model.name}_part${partIndex++}`,
      positions: new Float32Array(newPositions),
      indices: newIndices,
      warnings: [...model.warnings],
    });
  }

  return results;
}

/**
 * Merges multiple MeshModels into a single unified MeshModel.
 */
export function mergeMeshModels(models: MeshModel[]): MeshModel {
  if (models.length === 0) {
    return {
      name: 'empty',
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      warnings: [],
    };
  }

  if (models.length === 1) {
    const m = models[0];
    validateMeshModel(m);
    return {
      name: m.name,
      positions: new Float32Array(m.positions),
      indices: new Uint32Array(m.indices),
      warnings: [...m.warnings],
    };
  }

  let totalPositions = 0;
  let totalIndices = 0;
  const warningsSet = new Set<string>();
  const names: string[] = [];

  for (const m of models) {
    validateMeshModel(m);
    totalPositions += m.positions.length;
    totalIndices += m.indices.length;
    names.push(m.name);
    for (const w of m.warnings) {
      warningsSet.add(w);
    }
  }

  const mergedPositions = new Float32Array(totalPositions);
  const mergedIndices = new Uint32Array(totalIndices);

  let posOffset = 0;
  let indOffset = 0;
  let vertexOffset = 0;

  for (const m of models) {
    mergedPositions.set(m.positions, posOffset);
    for (let i = 0; i < m.indices.length; i++) {
      mergedIndices[indOffset + i] = m.indices[i] + vertexOffset;
    }

    posOffset += m.positions.length;
    indOffset += m.indices.length;
    vertexOffset += m.positions.length / 3;
  }

  return {
    name: names.join('_merged_'),
    positions: mergedPositions,
    indices: mergedIndices,
    warnings: Array.from(warningsSet),
  };
}
