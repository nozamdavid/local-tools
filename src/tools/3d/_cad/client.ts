import type {
  CadFormat,
  CadQuality,
  CadWorkerRequest,
  CadWorkerResponse,
  MeshModel,
} from './types';

export type { CadQuality, MeshModel };

/**
 * Accept attribute string for CAD file inputs.
 */
export const CAD_ACCEPT =
  '.step,.stp,.iges,.igs,.brep,model/step,application/step,model/x-step,model/x.step,model/iges,application/iges,model/x-iges,model/x.iges,model/brep,model/x-brep,application/x-brep';

/** Maximum CAD file size: 25 Megabytes */
export const MAX_CAD_FILE_SIZE = 25 * 1024 * 1024;

interface PendingJob {
  resolve: (model: MeshModel) => void;
  reject: (err: Error) => void;
}

class CadJobManager {
  private worker: Worker | null = null;
  private reqId = 0;
  private pendingJobs = new Map<number, PendingJob>();
  private queue: Promise<unknown> = Promise.resolve();
  private cancelGeneration = 0;

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./cad.worker.ts', import.meta.url), {
        type: 'module',
      });

      this.worker.onmessage = (event: MessageEvent<CadWorkerResponse>) => {
        const res = event.data;
        if (!res || typeof res.id !== 'number') return;

        const pending = this.pendingJobs.get(res.id);
        if (pending) {
          this.pendingJobs.delete(res.id);
          if (res.ok) {
            pending.resolve(res.model);
          } else {
            pending.reject(new Error(res.error));
          }
        }
      };

      this.worker.onerror = (event: ErrorEvent) => {
        const message = event.message || 'CAD worker failed during execution.';
        this.terminateAndReject(new Error(message));
      };
    }
    return this.worker;
  }

  private terminateAndReject(error: Error): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, pending] of this.pendingJobs) {
      pending.reject(error);
    }
    this.pendingJobs.clear();
  }

  public cancel(): void {
    this.cancelGeneration++;
    this.terminateAndReject(new Error('CAD import job was cancelled.'));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(
      () => {},
      () => {}
    );
    return next;
  }

  public convert(file: File, quality: CadQuality = 'standard'): Promise<MeshModel> {
    // 1. Validation upfront before touching worker, queues, or memory
    if (file.size === 0) {
      return Promise.reject(new Error(`File "${file.name}" is empty (0 bytes).`));
    }

    if (file.size > MAX_CAD_FILE_SIZE) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      return Promise.reject(
        new Error(`CAD file size (${mb} MB) exceeds maximum allowed limit of 25 MB.`)
      );
    }

    const format = getCadFormat(file.name, file.type);
    const jobGen = this.cancelGeneration;

    return this.enqueue(async () => {
      if (jobGen !== this.cancelGeneration) {
        throw new Error('CAD import job was cancelled.');
      }

      const buffer = await file.arrayBuffer();

      if (jobGen !== this.cancelGeneration) {
        throw new Error('CAD import job was cancelled.');
      }

      return new Promise<MeshModel>((resolve, reject) => {
        if (jobGen !== this.cancelGeneration) {
          reject(new Error('CAD import job was cancelled.'));
          return;
        }

        const id = ++this.reqId;
        const worker = this.getWorker();

        this.pendingJobs.set(id, { resolve, reject });

        const req: CadWorkerRequest = {
          id,
          type: 'convert',
          fileName: file.name,
          format,
          buffer,
          quality,
        };

        worker.postMessage(req, [buffer]);
      });
    });
  }
}

export function getCadFormat(fileName: string, mimeType?: string): CadFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.step') || lower.endsWith('.stp')) {
    return 'step';
  }
  if (lower.endsWith('.iges') || lower.endsWith('.igs')) {
    return 'iges';
  }
  if (lower.endsWith('.brep')) {
    return 'brep';
  }
  if (mimeType) {
    const m = mimeType.trim().toLowerCase();
    if (
      m === 'model/step' ||
      m === 'application/step' ||
      m === 'model/x-step' ||
      m === 'model/x.step'
    ) {
      return 'step';
    }
    if (
      m === 'model/iges' ||
      m === 'application/iges' ||
      m === 'model/x-iges' ||
      m === 'model/x.iges'
    ) {
      return 'iges';
    }
    if (
      m === 'model/brep' ||
      m === 'model/x-brep' ||
      m === 'application/x-brep'
    ) {
      return 'brep';
    }
  }
  throw new Error(
    `Unsupported file format for "${fileName}". Supported CAD formats are STEP (.step, .stp), IGES (.iges, .igs), and BREP (.brep).`
  );
}

const manager = new CadJobManager();

/**
 * Imports a CAD model (STEP, IGES, or BREP) and tessellates it into a normalized triangular MeshModel.
 *
 * @param file The CAD file to import (.step, .stp, .iges, .igs, or .brep).
 * @param quality Tessellation quality preset ('coarse', 'standard', or 'fine').
 * @returns Promise resolving to a MeshModel with coordinates normalized to millimeters.
 */
export function importCadModel(
  file: File,
  quality: CadQuality = 'standard'
): Promise<MeshModel> {
  return manager.convert(file, quality);
}

/**
 * Cancels all active and queued CAD processing jobs by terminating the dedicated worker.
 * The worker will be lazily recreated on the next importCadModel call.
 */
export function cancelCadJobs(): void {
  manager.cancel();
}
