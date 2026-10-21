import type { MeshFormat, MeshModel, MeshOperation, MeshStats } from './types';
import { MESH_ACCEPT, MESH_CAPABILITIES } from './types';
import { MAX_FILE_SIZE_BYTES, MAX_CAD_FILE_SIZE_BYTES } from './validation';
import type { WorkerRequest, WorkerResponse } from './mesh.worker';

export { MESH_ACCEPT, MESH_CAPABILITIES };
export type { MeshFormat, MeshModel, MeshOperation, MeshStats };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

let activeWorker: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingRequest>();

let cancelGeneration = 0;
let meshQueue: Promise<unknown> = Promise.resolve();

let cadModulePromise: Promise<typeof import('../_cad/client')> | null = null;
let cadModule: typeof import('../_cad/client') | null = null;
let cadImportGeneration = 0;

function enqueueWorkerJob<T>(task: () => Promise<T>): Promise<T> {
  const next = meshQueue.then(task, task);
  meshQueue = next.then(
    () => {},
    () => {},
  );
  return next;
}

function getOrCreateWorker(): Worker {
  if (!activeWorker) {
    activeWorker = new Worker(new URL('./mesh.worker.ts', import.meta.url), {
      type: 'module',
    });

    activeWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, ok } = event.data;
      const pending = pendingRequests.get(id);
      if (!pending) return;

      pendingRequests.delete(id);
      if (ok) {
        pending.resolve(event.data.result);
      } else {
        pending.reject(new Error(event.data.error));
      }
    };

    activeWorker.onerror = (event: ErrorEvent) => {
      const err = new Error(event.message || 'Mesh worker error occurred.');
      for (const pending of pendingRequests.values()) {
        pending.reject(err);
      }
      pendingRequests.clear();
      if (activeWorker) {
        activeWorker.terminate();
        activeWorker = null;
      }
    };
  }

  return activeWorker;
}

function sendWorkerMessage<T>(
  reqFactory: (id: number) => WorkerRequest,
  transferList: Transferable[] = [],
  expectedGen: number = cancelGeneration,
): Promise<T> {
  if (expectedGen !== cancelGeneration) {
    return Promise.reject(new Error('Mesh operation cancelled.'));
  }

  const worker = getOrCreateWorker();
  const id = nextRequestId++;

  return new Promise<T>((resolve, reject) => {
    if (expectedGen !== cancelGeneration) {
      reject(new Error('Mesh operation cancelled.'));
      return;
    }

    pendingRequests.set(id, {
      resolve: resolve as (val: unknown) => void,
      reject,
    });

    try {
      const req = reqFactory(id);
      // CAUTION: Caller buffers must NEVER be transferred to prevent detachment.
      // Only ephemeral buffers created inside this client (e.g. fresh arrayBuffers) may be transferred.
      worker.postMessage(req, transferList);
    } catch (err) {
      pendingRequests.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

const CAD_EXTENSIONS = ['step', 'stp', 'iges', 'igs', 'brep'];
const CAD_MIME_TYPES = [
  'model/step',
  'application/step',
  'model/x.step',
  'model/x-step',
  'model/iges',
  'application/iges',
  'model/x.iges',
  'model/x-iges',
  'model/brep',
  'model/x-brep',
  'application/x-brep',
];

/**
 * Imports a 3D model file (STL, OBJ, PLY, 3MF, STEP, IGES, BREP) inside a Web Worker.
 * Expresses positions in millimeters (mm) with indexed geometry.
 * Automatically routes CAD formats to lazy CAD adapter and mesh formats to mesh worker.
 */
export async function importModel(file: File): Promise<MeshModel> {
  if (file.size === 0) {
    throw new Error(`File "${file.name}" is empty (0 bytes).`);
  }

  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  const rawMime = (file.type || '').trim().toLowerCase();

  const isCad = CAD_EXTENSIONS.includes(ext) || CAD_MIME_TYPES.includes(rawMime);

  if (isCad) {
    if (file.size > MAX_CAD_FILE_SIZE_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      throw new Error(`CAD file size (${mb} MB) exceeds maximum allowed limit of 25 MB.`);
    }

    const currentCadGen = ++cadImportGeneration;
    const jobGen = cancelGeneration;

    if (!cadModulePromise) {
      cadModulePromise = import('../_cad/client').then((m) => {
        cadModule = m;
        return m;
      });
    }

    const cad = await cadModulePromise;
    if (jobGen !== cancelGeneration || currentCadGen !== cadImportGeneration) {
      throw new Error('Mesh operation cancelled.');
    }
    return await cad.importCadModel(file, 'standard');
  }

  // Mesh formats
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(`File "${file.name}" (${mb} MB) exceeds maximum supported size of 100 MB.`);
  }

  const jobGen = cancelGeneration;
  const buffer = await file.arrayBuffer();

  if (jobGen !== cancelGeneration) {
    throw new Error('Mesh operation cancelled.');
  }

  let effectiveExt = ext;
  if (!effectiveExt || !['stl', 'obj', 'ply', '3mf'].includes(effectiveExt)) {
    if (rawMime === 'model/stl' || rawMime === 'application/sla') {
      effectiveExt = 'stl';
    } else if (rawMime === 'model/obj' || rawMime === 'text/obj' || rawMime === 'application/x-tgif') {
      effectiveExt = 'obj';
    } else if (rawMime === 'model/ply') {
      effectiveExt = 'ply';
    } else if (rawMime === 'model/3mf' || rawMime === 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml') {
      effectiveExt = '3mf';
    } else {
      throw new Error(`Unsupported 3D model format for "${file.name}". Supported formats are STL, OBJ, PLY, 3MF, STEP, IGES, and BREP.`);
    }
  }

  return enqueueWorkerJob(() => {
    if (jobGen !== cancelGeneration) {
      return Promise.reject(new Error('Mesh operation cancelled.'));
    }
    return sendWorkerMessage<MeshModel>(
      (id) => ({
        id,
        type: 'import',
        buffer,
        filename: file.name,
        extension: effectiveExt,
      }),
      [buffer],
      jobGen,
    );
  });
}

/**
 * Computes topological and geometric metrics (bounds, area, volume, manifoldness)
 * in the Web Worker without blocking the main UI thread.
 * Live caller buffers are preserved and never detached.\n */
export async function inspectModel(model: MeshModel): Promise<MeshStats> {
  const jobGen = cancelGeneration;
  return enqueueWorkerJob(() => {
    if (jobGen !== cancelGeneration) {
      return Promise.reject(new Error('Mesh operation cancelled.'));
    }
    return sendWorkerMessage<MeshStats>(
      (id) => ({
        id,
        type: 'inspect',
        model, // structured clone preserves caller buffers
      }),
      [],
      jobGen,
    );
  });
}

/**
 * Executes a mesh operation (simplification, affine transform, or normal flip) in the Web Worker.
 * Live caller buffers are preserved and never detached.
 */
export async function processModel(model: MeshModel, operation: MeshOperation): Promise<MeshModel> {
  const jobGen = cancelGeneration;
  return enqueueWorkerJob(() => {
    if (jobGen !== cancelGeneration) {
      return Promise.reject(new Error('Mesh operation cancelled.'));
    }
    return sendWorkerMessage<MeshModel>(
      (id) => ({
        id,
        type: 'process',
        model, // structured clone preserves caller buffers
        operation,
      }),
      [],
      jobGen,
    );
  });
}

/**
 * Splits a mesh into independent disconnected components in the Web Worker.
 * Live caller buffers are preserved and never detached.
 */
export async function splitModel(model: MeshModel): Promise<MeshModel[]> {
  const jobGen = cancelGeneration;
  return enqueueWorkerJob(() => {
    if (jobGen !== cancelGeneration) {
      return Promise.reject(new Error('Mesh operation cancelled.'));
    }
    return sendWorkerMessage<MeshModel[]>(
      (id) => ({
        id,
        type: 'split',
        model, // structured clone preserves caller buffers
      }),
      [],
      jobGen,
    );
  });
}

/**
 * Merges multiple MeshModels into a single unified MeshModel in the Web Worker.
 * Live caller buffers are preserved and never detached.
 */
export async function mergeModels(models: MeshModel[]): Promise<MeshModel> {
  const jobGen = cancelGeneration;
  return enqueueWorkerJob(() => {
    if (jobGen !== cancelGeneration) {
      return Promise.reject(new Error('Mesh operation cancelled.'));
    }
    return sendWorkerMessage<MeshModel>(
      (id) => ({
        id,
        type: 'merge',
        models, // structured clone preserves caller buffers
      }),
      [],
      jobGen,
    );
  });
}

/**
 * Serializes a MeshModel to an export Blob (STL, OBJ, PLY, 3MF) in the Web Worker.
 * Live caller buffers are preserved and never detached.
 */
export async function exportModel(model: MeshModel, format: MeshFormat): Promise<Blob> {
  const jobGen = cancelGeneration;
  const res = await enqueueWorkerJob(() => {
    if (jobGen !== cancelGeneration) {
      return Promise.reject(new Error('Mesh operation cancelled.'));
    }
    return sendWorkerMessage<{ buffer: ArrayBuffer; mimeType: string }>(
      (id) => ({
        id,
        type: 'export',
        model, // structured clone preserves caller buffers
        format,
      }),
      [],
      jobGen,
    );
  });

  return new Blob([res.buffer], { type: res.mimeType });
}

/**
 * Terminates the active Web Worker immediately, cancels all pending and queued jobs,
 * and resets worker state so subsequent operations start cleanly.
 * Cancels CAD jobs in parallel without eager import if never requested.
 */
export function cancelMeshJobs(): void {
  cancelGeneration++;
  const cancelledCadGen = ++cadImportGeneration;

  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }

  const cancelErr = new Error('Mesh operation cancelled.');
  for (const pending of pendingRequests.values()) {
    pending.reject(cancelErr);
  }
  pendingRequests.clear();

  // If CAD module was already loaded or requested, cancel CAD jobs safely.
  // CRITICAL: NEVER initiate a new CAD module import here if it was never loaded/requested!
  if (cadModule) {
    cadModule.cancelCadJobs();
  } else if (cadModulePromise) {
    cadModulePromise
      .then((cad) => {
        if (cancelledCadGen === cadImportGeneration) {
          cad.cancelCadJobs();
        }
      })
      .catch(() => {});
  }
}
