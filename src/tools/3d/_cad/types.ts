/**
 * Geometry contract matching sibling _mesh/types.ts MeshModel.
 * Output is always triangulated and normalized to millimeters.
 */
export interface MeshModel {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  warnings: string[];
}

export type CadQuality = 'coarse' | 'standard' | 'fine';

export type CadFormat = 'step' | 'iges' | 'brep';

export interface CadWorkerConvertJob {
  id: number;
  type: 'convert';
  fileName: string;
  format: CadFormat;
  buffer: ArrayBuffer;
  quality: CadQuality;
}

export interface CadWorkerCancelJob {
  id: number;
  type: 'cancel';
}

export type CadWorkerRequest = CadWorkerConvertJob | CadWorkerCancelJob;

export interface CadWorkerSuccessResponse {
  id: number;
  ok: true;
  model: MeshModel;
}

export interface CadWorkerErrorResponse {
  id: number;
  ok: false;
  error: string;
}

export type CadWorkerResponse = CadWorkerSuccessResponse | CadWorkerErrorResponse;
