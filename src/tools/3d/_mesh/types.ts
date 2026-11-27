/**
 * Core 3D Mesh types and interfaces.
 *
 * All operations execute strictly client-side.
 * Positions are expressed in millimeters (mm), using indexed triangles with flattened transforms.
 */

export type MeshFormat = 'stl' | 'obj' | 'ply' | '3mf';
export type MeshImportIntent = 'edit' | 'viewer';

export interface MeshModel {
  name: string;
  /** Flattened [x0, y0, z0, x1, y1, z1, ...] in millimeters */
  positions: Float32Array;
  /** Triangle indices [t0a, t0b, t0c, t1a, ...] */
  indices: Uint32Array;
  /** Warnings accumulated during import or processing */
  warnings: string[];
}

export interface MeshStats {
  vertices: number;
  triangles: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  surfaceArea: number;
  /**
   * Volume in mm^3. Null if mesh is open, non-manifold, or has degenerate faces.
   * Note: Watertightness is necessary for volume calculation but does not
   * alone guarantee printability (e.g. wall thickness, clearances, overhangs).
   */
  volume: number | null;
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
  components: number;
  watertight: boolean;
}

export type MeshOperation =
  | { kind: 'simplify'; ratio: number; error: number; lockBorder: boolean }
  | { kind: 'transform'; scale: [number, number, number]; rotation: [number, number, number]; center: boolean; ground: boolean }
  | { kind: 'normals'; flip: boolean };

/**
 * Universal accept string for 3D file dropzones and file inputs.
 * Supports all standard polygonal mesh formats (STL, OBJ, PLY, 3MF)
 * as well as CAD formats (STEP, IGES, BREP) with associated MIME types.
 */
export const MESH_ACCEPT =
  '.stl,.obj,.ply,.3mf,.step,.stp,.iges,.igs,.brep,' +
  'model/stl,application/sla,model/obj,text/obj,application/x-tgif,model/ply,model/3mf,' +
  'application/vnd.ms-package.3dmanufacturing-3dmodel+xml,' +
  'model/step,application/step,model/x.step,model/x-step,' +
  'model/iges,application/iges,model/x.iges,model/x-iges,' +
  'model/brep,model/x-brep,application/x-brep';

export interface MeshCapabilities {
  formats: {
    import: string[];
    export: MeshFormat[];
  };
  operations: Array<'simplify' | 'transform' | 'normals' | 'split' | 'merge'>;
  maxFileSizeMB: number;
  maxTriangles: number;
}

export const MESH_CAPABILITIES: MeshCapabilities = {
  formats: {
    import: ['stl', 'obj', 'ply', '3mf', 'step', 'stp', 'iges', 'igs', 'brep'],
    export: ['stl', 'obj', 'ply', '3mf'],
  },
  operations: ['simplify', 'transform', 'normals', 'split', 'merge'],
  maxFileSizeMB: 100,
  maxTriangles: 1_000_000,
};
