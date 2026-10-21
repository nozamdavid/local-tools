import type { MeshFormat, MeshModel, MeshOperation, MeshStats } from './types';
import { validateFileSize, validateMeshModel } from './validation';
import { analyzeMesh, mergeMeshModels, splitComponents } from './topology';
import { flipNormals, transformMesh } from './transforms';
import { simplifyMesh } from './simplify';
import { exportSTL, parseSTL } from './formats/stl';
import { exportOBJ, parseOBJ } from './formats/obj';
import { exportPLY, parsePLY } from './formats/ply';
import { export3MF, parse3MF } from './formats/threemf';

export type WorkerRequest =
  | { id: number; type: 'import'; buffer: ArrayBuffer; filename: string; extension: string }
  | { id: number; type: 'inspect'; model: MeshModel }
  | { id: number; type: 'process'; model: MeshModel; operation: MeshOperation }
  | { id: number; type: 'split'; model: MeshModel }
  | { id: number; type: 'merge'; models: MeshModel[] }
  | { id: number; type: 'export'; model: MeshModel; format: MeshFormat };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

let workerQueue: Promise<void> = Promise.resolve();

async function handleWorkerRequest(req: WorkerRequest): Promise<void> {
  const { id } = req;

  try {
    switch (req.type) {
      case 'import': {
        const { buffer, filename, extension } = req;
        validateFileSize(buffer.byteLength, filename);

        let model: MeshModel;
        const baseName = filename.replace(/\.[^/.]+$/, '');
        const ext = extension.toLowerCase();

        switch (ext) {
          case 'stl':
            model = parseSTL(buffer, baseName);
            break;
          case 'obj': {
            const text = new TextDecoder().decode(buffer);
            model = parseOBJ(text, baseName);
            break;
          }
          case 'ply':
            model = parsePLY(buffer, baseName);
            break;
          case '3mf':
            model = await parse3MF(buffer, baseName);
            break;
          default:
            throw new Error(`Unsupported 3D mesh format: .${ext}`);
        }

        validateMeshModel(model);

        const response: WorkerResponse = { id, ok: true, result: model };
        // Transfer newly allocated arrays to client
        (self as unknown as Worker).postMessage(response, [
          model.positions.buffer as ArrayBuffer,
          model.indices.buffer as ArrayBuffer,
        ]);
        break;
      }

      case 'inspect': {
        const stats: MeshStats = analyzeMesh(req.model);
        const response: WorkerResponse = { id, ok: true, result: stats };
        (self as unknown as Worker).postMessage(response);
        break;
      }

      case 'process': {
        const { model, operation } = req;
        validateMeshModel(model);

        let resultModel: MeshModel;
        switch (operation.kind) {
          case 'simplify':
            resultModel = await simplifyMesh(
              model,
              operation.ratio,
              operation.error,
              operation.lockBorder
            );
            break;
          case 'transform':
            resultModel = transformMesh(
              model,
              operation.scale,
              operation.rotation,
              operation.center,
              operation.ground
            );
            break;
          case 'normals':
            resultModel = flipNormals(model, operation.flip);
            break;
          default:
            throw new Error(`Unknown mesh operation: ${(operation as { kind: string }).kind}`);
        }

        validateMeshModel(resultModel);

        const response: WorkerResponse = { id, ok: true, result: resultModel };
        (self as unknown as Worker).postMessage(response, [
          resultModel.positions.buffer as ArrayBuffer,
          resultModel.indices.buffer as ArrayBuffer,
        ]);
        break;
      }

      case 'split': {
        const models = splitComponents(req.model);
        for (const m of models) {
          validateMeshModel(m);
        }

        const transferables: ArrayBuffer[] = [];
        for (const m of models) {
          transferables.push(
            m.positions.buffer as ArrayBuffer,
            m.indices.buffer as ArrayBuffer
          );
        }

        const response: WorkerResponse = { id, ok: true, result: models };
        (self as unknown as Worker).postMessage(response, transferables);
        break;
      }

      case 'merge': {
        const merged = mergeMeshModels(req.models);
        validateMeshModel(merged);

        const response: WorkerResponse = { id, ok: true, result: merged };
        (self as unknown as Worker).postMessage(response, [
          merged.positions.buffer as ArrayBuffer,
          merged.indices.buffer as ArrayBuffer,
        ]);
        break;
      }

      case 'export': {
        const { model, format } = req;
        validateMeshModel(model);

        let outBuffer: ArrayBuffer;
        let mimeType: string;

        switch (format) {
          case 'stl':
            outBuffer = exportSTL(model);
            mimeType = 'model/stl';
            break;
          case 'obj': {
            const text = exportOBJ(model);
            outBuffer = new TextEncoder().encode(text).buffer as ArrayBuffer;
            mimeType = 'model/obj';
            break;
          }
          case 'ply': {
            const text = exportPLY(model);
            outBuffer = new TextEncoder().encode(text).buffer as ArrayBuffer;
            mimeType = 'model/ply';
            break;
          }
          case '3mf': {
            const blob = await export3MF(model);
            outBuffer = await blob.arrayBuffer();
            mimeType = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
            break;
          }
          default:
            throw new Error(`Unsupported export format: ${format}`);
        }

        const response: WorkerResponse = {
          id,
          ok: true,
          result: { buffer: outBuffer, mimeType },
        };
        (self as unknown as Worker).postMessage(response, [outBuffer]);
        break;
      }

      default:
        throw new Error(`Unknown request type: ${(req as { type: string }).type}`);
    }
  } catch (err) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (!req || typeof req.id !== 'number') return;
  workerQueue = workerQueue.then(() => handleWorkerRequest(req));
};
