/// <reference lib="webworker" />

import occtimportjs, { type OcctImportParams, type OcctModule } from 'occt-import-js';
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import type {
  CadQuality,
  CadWorkerConvertJob,
  CadWorkerRequest,
  CadWorkerResponse,
  MeshModel,
} from './types';
import { weldIndexedVertices } from '../_mesh/topology';

const MAX_VERTICES = 1_000_000;
const MAX_TRIANGLES = 1_000_000;

let occtModulePromise: Promise<OcctModule> | null = null;

/**
 * Initializes the occt-import-js WebAssembly module.
 * Uses locally bundled WASM file via Vite ?url import.
 * No remote host requests or unbundled CDN calls are made.
 */
async function getOcct(): Promise<OcctModule> {
  if (!occtModulePromise) {
    const factory =
      typeof occtimportjs === 'function'
        ? occtimportjs
        : (occtimportjs as unknown as { default: (overrides?: unknown) => Promise<OcctModule> })
            ?.default;

    if (typeof factory !== 'function') {
      throw new Error('occt-import-js factory could not be resolved from module exports.');
    }

    occtModulePromise = factory({
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) {
          return wasmUrl;
        }
        return path;
      },
    });
  }
  return occtModulePromise;
}

/**
 * Maps CAD quality settings to OCCT deflection parameters.
 * Output linearUnit is always enforced to 'millimeter'.
 */
function getQualityParams(quality: CadQuality): OcctImportParams {
  switch (quality) {
    case 'coarse':
      return {
        linearUnit: 'millimeter',
        linearDeflectionType: 'bounding_box_ratio',
        linearDeflection: 0.005,
        angularDeflection: 0.8,
      };
    case 'fine':
      return {
        linearUnit: 'millimeter',
        linearDeflectionType: 'bounding_box_ratio',
        linearDeflection: 0.0002,
        angularDeflection: 0.25,
      };
    case 'standard':
    default:
      return {
        linearUnit: 'millimeter',
        linearDeflectionType: 'bounding_box_ratio',
        linearDeflection: 0.001,
        angularDeflection: 0.5,
      };
  }
}

/**
 * Tessellates CAD file buffer and normalizes geometry into flattened MeshModel.
 */
async function processCadJob(job: CadWorkerConvertJob): Promise<MeshModel> {
  const { fileName, format, buffer, quality } = job;
  const occt = await getOcct();
  const params = getQualityParams(quality);
  const uint8 = new Uint8Array(buffer);

  let result;
  switch (format) {
    case 'step':
      result = occt.ReadStepFile(uint8, params);
      break;
    case 'iges':
      result = occt.ReadIgesFile(uint8, params);
      break;
    case 'brep':
      result = occt.ReadBrepFile(uint8, params);
      break;
    default:
      throw new Error(`Unsupported CAD format "${format}".`);
  }

  if (!result || !result.success) {
    throw new Error(
      `Failed to parse ${format.toUpperCase()} model. File may be corrupted or contain unsupported CAD entity types.`
    );
  }

  if (!result.meshes || result.meshes.length === 0) {
    throw new Error('CAD model produced empty geometry: no 3D solids or surfaces were found.');
  }

  // 1. Validate coordinate and index buffer lengths before allocating
  let totalVertices = 0;
  let totalIndices = 0;

  for (const mesh of result.meshes) {
    const pos = mesh.attributes?.position?.array;
    const idx = mesh.index?.array;
    if (!pos || !idx || pos.length === 0 || idx.length === 0) {
      continue;
    }
    if (pos.length % 3 !== 0) {
      throw new Error(`Corrupted CAD vertex buffer: length ${pos.length} not divisible by 3.`);
    }
    if (idx.length % 3 !== 0) {
      throw new Error(`Corrupted CAD index buffer: length ${idx.length} not divisible by 3.`);
    }
    totalVertices += pos.length / 3;
    totalIndices += idx.length;
  }

  if (totalVertices === 0 || totalIndices === 0) {
    throw new Error('CAD model produced no triangles after tessellation.');
  }

  const totalTriangles = totalIndices / 3;
  if (!Number.isInteger(totalTriangles)) {
    throw new Error(`Corrupted index buffer: total indices (${totalIndices}) not divisible by 3.`);
  }

  if (totalVertices > MAX_VERTICES) {
    throw new Error(
      `CAD model exceeds vertex limit: tessellated to ${totalVertices.toLocaleString()} vertices (limit is ${MAX_VERTICES.toLocaleString()}). Try selecting 'coarse' quality.`
    );
  }

  if (totalTriangles > MAX_TRIANGLES) {
    throw new Error(
      `CAD model exceeds triangle limit: tessellated to ${totalTriangles.toLocaleString()} triangles (limit is ${MAX_TRIANGLES.toLocaleString()}). Try selecting 'coarse' quality.`
    );
  }

  const rawPositions = new Float32Array(totalVertices * 3);
  const rawIndices = new Uint32Array(totalIndices);

  let vertexOffset = 0;
  let indexOffset = 0;

  // Assembly transforms: occt-import-js already applies shape locations and transforms
  // directly to face vertex coordinates during B-Rep face iteration.
  // Do NOT apply node transforms again (avoid applying transforms twice).
  for (const mesh of result.meshes) {
    const pos = mesh.attributes?.position?.array;
    const idx = mesh.index?.array;
    if (!pos || !idx || pos.length === 0 || idx.length === 0) {
      continue;
    }

    const currentMeshVertexCount = pos.length / 3;

    // Validate finite coordinates
    for (let i = 0; i < pos.length; i++) {
      const val = pos[i];
      if (!Number.isFinite(val)) {
        throw new Error(`Invalid non-finite coordinate (${val}) encountered in CAD mesh.`);
      }
      rawPositions[vertexOffset * 3 + i] = val;
    }

    // Validate bounded indices and copy with global vertex offset
    for (let i = 0; i < idx.length; i++) {
      const localIdx = idx[i];
      if (!Number.isInteger(localIdx) || localIdx < 0 || localIdx >= currentMeshVertexCount) {
        throw new Error(
          `Invalid index ${localIdx} for mesh face with ${currentMeshVertexCount} vertices.`
        );
      }
      const globalIdx = vertexOffset + localIdx;
      if (globalIdx > 0xffffffff) {
        throw new Error('32-bit index overflow encountered while merging CAD assembly parts.');
      }
      rawIndices[indexOffset + i] = globalIdx;
    }

    vertexOffset += currentMeshVertexCount;
    indexOffset += idx.length;
  }

  // 2. Apply canonical index welding at normalization:
  // OpenCASCADE produces discrete face meshes that duplicate vertices along shared face edges.
  // Index welding stitches shared face boundary edges into a manifold solid topology
  // without altering or losing any geometric coordinates.
  const { positions, indices } = weldIndexedVertices(rawPositions, rawIndices);

  const baseName = fileName.replace(/\.[^/.]+$/, '') || 'CAD_Model';
  const warnings: string[] = [
    'Tessellation loses exact CAD curves and parametric surfaces; geometry has been converted to faceted planar triangles.',
    'Exporting geometry-only mesh in millimeters (CAD materials, textures, and appearances are omitted).',
    `Quality preset "${quality}" applied (linear deflection: ${params.linearDeflection}, angular deflection: ${params.angularDeflection} rad) with units normalized to millimeters.`,
  ];

  if (result.meshes.length > 1) {
    warnings.push(
      `Flattened assembly containing ${result.meshes.length} parts into a unified single-mesh model.`
    );
  }

  return {
    name: baseName,
    positions,
    indices,
    warnings,
  };
}

let cadWorkerQueue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<CadWorkerRequest>) => {
  const req = event.data;
  if (!req || typeof req.id !== 'number') return;

  if (req.type === 'cancel') {
    return;
  }

  if (req.type === 'convert') {
    cadWorkerQueue = cadWorkerQueue
      .then(async () => {
        try {
          const model = await processCadJob(req);
          const res: CadWorkerResponse = {
            id: req.id,
            ok: true,
            model,
          };
          (self.postMessage as unknown as (message: unknown, transfer: Transferable[]) => void)(res, [
            model.positions.buffer,
            model.indices.buffer,
          ]);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          const res: CadWorkerResponse = {
            id: req.id,
            ok: false,
            error,
          };
          self.postMessage(res);
        }
      })
      .catch((err) => {
        const error = err instanceof Error ? err.message : String(err);
        const res: CadWorkerResponse = {
          id: req.id,
          ok: false,
          error,
        };
        self.postMessage(res);
      });
  }
};
