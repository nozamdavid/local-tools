import type { MeshModel } from './types';
import { validateMeshModel } from './validation';

/**
 * Applies affine transformation to a MeshModel.
 * Transform execution order:
 * 1. Scale [sx, sy, sz]
 * 2. Euler Rotation [rx, ry, rz] in degrees (XYZ order)
 * 3. Center all axes [X, Y, Z] to origin (0, 0, 0) if center is true
 * 4. Ground Z (shift so minZ = 0) if ground is true
 */
export function transformMesh(
  model: MeshModel,
  scale: [number, number, number],
  rotation: [number, number, number],
  center: boolean,
  ground: boolean
): MeshModel {
  validateMeshModel(model);

  const [sx, sy, sz] = scale;
  const [degX, degY, degZ] = rotation;

  if (
    !Number.isFinite(sx) ||
    !Number.isFinite(sy) ||
    !Number.isFinite(sz) ||
    sx === 0 ||
    sy === 0 ||
    sz === 0
  ) {
    throw new Error('Invalid transform: scale factors must be non-zero finite numbers.');
  }

  if (
    !Number.isFinite(degX) ||
    !Number.isFinite(degY) ||
    !Number.isFinite(degZ)
  ) {
    throw new Error('Invalid transform: rotation angles must be finite numbers.');
  }

  const { positions, indices } = model;
  const newPositions = new Float32Array(positions.length);

  const radX = (degX * Math.PI) / 180;
  const radY = (degY * Math.PI) / 180;
  const radZ = (degZ * Math.PI) / 180;

  const cosX = Math.cos(radX), sinX = Math.sin(radX);
  const cosY = Math.cos(radY), sinY = Math.sin(radY);
  const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);

  // 1. Scale and Rotate
  for (let i = 0; i < positions.length; i += 3) {
    let x = positions[i] * sx;
    let y = positions[i + 1] * sy;
    let z = positions[i + 2] * sz;

    // Rotate around X
    const y1 = y * cosX - z * sinX;
    const z1 = y * sinX + z * cosX;
    y = y1;
    z = z1;

    // Rotate around Y
    const x2 = x * cosY + z * sinY;
    const z2 = -x * sinY + z * cosY;
    x = x2;
    z = z2;

    // Rotate around Z
    const x3 = x * cosZ - y * sinZ;
    const y3 = x * sinZ + y * cosZ;
    x = x3;
    y = y3;

    newPositions[i] = x;
    newPositions[i + 1] = y;
    newPositions[i + 2] = z;
  }

  // 2. Compute bounding box after scale and rotation
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < newPositions.length; i += 3) {
    const x = newPositions[i];
    const y = newPositions[i + 1];
    const z = newPositions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  if (newPositions.length === 0) {
    minX = minY = minZ = maxX = maxY = maxZ = 0;
  }

  let shiftX = 0;
  let shiftY = 0;
  let shiftZ = 0;

  // 3. Center all axes XYZ
  if (center) {
    shiftX = -(minX + maxX) / 2;
    shiftY = -(minY + maxY) / 2;
    shiftZ = -(minZ + maxZ) / 2;
  }

  // 4. Ground Z axis (place lowest point at Z = 0)
  if (ground) {
    // If center was already applied, the new minZ would be minZ + shiftZ
    const currentMinZ = minZ + shiftZ;
    shiftZ += -currentMinZ;
  }

  if (shiftX !== 0 || shiftY !== 0 || shiftZ !== 0) {
    for (let i = 0; i < newPositions.length; i += 3) {
      newPositions[i] += shiftX;
      newPositions[i + 1] += shiftY;
      newPositions[i + 2] += shiftZ;
    }
  }

  // If transformation reflected geometry (negative volume determinant),
  // invert triangle winding to preserve outward face orientation.
  const isReflected = sx * sy * sz < 0;
  const newIndices = new Uint32Array(indices.length);

  if (isReflected) {
    for (let t = 0; t < indices.length; t += 3) {
      newIndices[t] = indices[t];
      newIndices[t + 1] = indices[t + 2]; // swap v1 and v2
      newIndices[t + 2] = indices[t + 1];
    }
  } else {
    newIndices.set(indices);
  }

  return {
    name: model.name,
    positions: newPositions,
    indices: newIndices,
    warnings: [...model.warnings],
  };
}

/**
 * Modifies normals / triangle winding order.
 */
export function flipNormals(model: MeshModel, flip: boolean): MeshModel {
  validateMeshModel(model);

  if (!flip) {
    return {
      name: model.name,
      positions: new Float32Array(model.positions),
      indices: new Uint32Array(model.indices),
      warnings: [...model.warnings],
    };
  }

  const { indices } = model;
  const flippedIndices = new Uint32Array(indices.length);

  for (let t = 0; t < indices.length; t += 3) {
    flippedIndices[t] = indices[t];
    flippedIndices[t + 1] = indices[t + 2]; // swap v1 and v2
    flippedIndices[t + 2] = indices[t + 1];
  }

  return {
    name: model.name,
    positions: new Float32Array(model.positions),
    indices: flippedIndices,
    warnings: [...model.warnings],
  };
}
