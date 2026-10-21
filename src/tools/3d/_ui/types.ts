import type {
  MeshFormat,
  MeshModel,
  MeshStats,
  MeshOperation,
  MeshCapabilities,
} from '../_mesh/types';

export type {
  MeshFormat,
  MeshModel,
  MeshStats,
  MeshOperation,
  MeshCapabilities,
};

export { MESH_ACCEPT, MESH_CAPABILITIES } from '../_mesh/types';

export const ALL_MESH_FORMATS: { value: MeshFormat; label: string; ext: string }[] = [
  { value: 'stl', label: 'STL (.stl)', ext: '.stl' },
  { value: 'obj', label: 'OBJ (.obj)', ext: '.obj' },
  { value: 'ply', label: 'PLY (.ply)', ext: '.ply' },
  { value: '3mf', label: '3MF (.3mf)', ext: '.3mf' },
];

export function detectFormatFromFilename(filename: string): MeshFormat {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'obj') return 'obj';
  if (ext === 'ply') return 'ply';
  if (ext === '3mf') return '3mf';
  return 'stl';
}
