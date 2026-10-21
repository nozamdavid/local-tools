import { MeshoptSimplifier } from 'meshoptimizer';
import type { MeshModel } from './types';
import { validateMeshModel } from './validation';

/**
 * Executes polygon reduction via MeshoptSimplifier (WASM).
 * Operates on indexed geometry and compacts unreferenced vertices.
 */
export async function simplifyMesh(model: MeshModel, ratio: number, targetError: number, lockBorder: boolean): Promise<MeshModel> {
  validateMeshModel(model);

  await MeshoptSimplifier.ready;

  const { positions, indices } = model;
  const originalTriangles = indices.length / 3;

  if (originalTriangles === 0) {
    return {
      name: model.name,
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      warnings: [...model.warnings],
    };
  }

  // Bound ratio between 0.01 and 1.0
  const clampedRatio = Math.max(0.01, Math.min(1.0, ratio));
  const targetIndexCount = Math.max(3, Math.floor((indices.length * clampedRatio) / 3) * 3);
  const flags: Array<'LockBorder'> = lockBorder ? ['LockBorder'] : [];

  const [simplifiedIndices, achievedError] = MeshoptSimplifier.simplify(
    indices,
    positions,
    3, // stride in floats
    targetIndexCount,
    targetError,
    flags,
  );

  // Compact mesh to strip unreferenced vertices
  const oldVertexCount = positions.length / 3;
  const remap = new Int32Array(oldVertexCount).fill(-1);
  let newVertexCount = 0;

  for (let i = 0; i < simplifiedIndices.length; i++) {
    const oldIdx = simplifiedIndices[i];
    if (remap[oldIdx] === -1) {
      remap[oldIdx] = newVertexCount++;
    }
  }

  const compactedPositions = new Float32Array(newVertexCount * 3);
  for (let oldIdx = 0; oldIdx < oldVertexCount; oldIdx++) {
    const newIdx = remap[oldIdx];
    if (newIdx !== -1) {
      compactedPositions[newIdx * 3] = positions[oldIdx * 3];
      compactedPositions[newIdx * 3 + 1] = positions[oldIdx * 3 + 1];
      compactedPositions[newIdx * 3 + 2] = positions[oldIdx * 3 + 2];
    }
  }

  const compactedIndices = new Uint32Array(simplifiedIndices.length);
  for (let i = 0; i < simplifiedIndices.length; i++) {
    compactedIndices[i] = remap[simplifiedIndices[i]];
  }

  const achievedTriangles = compactedIndices.length / 3;
  const warnings = [...model.warnings];
  warnings.push(
    `Simplification achieved: ${achievedTriangles.toLocaleString()} triangles (${((achievedTriangles / originalTriangles) * 100).toFixed(1)}% of original ${originalTriangles.toLocaleString()}) with relative error ${achievedError.toExponential(2)}.`,
  );

  return {
    name: model.name,
    positions: compactedPositions,
    indices: compactedIndices,
    warnings,
  };
}
