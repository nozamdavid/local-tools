import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { readZipEntry } from '../../../../lib/zip';
import type { MeshModel } from '../types';
import { DEFAULT_MESH_GEOMETRY_LIMITS, MAX_ZIP_ENTRY_COUNT, MAX_ZIP_UNCOMPRESSED_BYTES } from '../validation';

type Matrix3x4 = [number, number, number, number, number, number, number, number, number, number, number, number];

const IDENTITY_MATRIX: Matrix3x4 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const PRODUCTION_NAMESPACE = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';

function matrixDeterminant(M: Matrix3x4): number {
  return M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
}

function parse3MFMatrix(str?: string): Matrix3x4 {
  if (!str) return [...IDENTITY_MATRIX];
  const parts = str.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error('Invalid 3MF transform matrix: matrix must contain 12 finite numbers.');
  }

  const det = matrixDeterminant(parts as Matrix3x4);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    throw new Error('Invalid 3MF transform matrix: singular or zero determinant matrix is not permitted.');
  }

  return parts as Matrix3x4;
}

/**
 * Multiplies two 3MF affine matrices using standard row-vector composition:
 * A * B where v' = (v * A) * B = v * (A * B).
 */
function multiply3MFMatrices(A: Matrix3x4, B: Matrix3x4): Matrix3x4 {
  return [
    A[0] * B[0] + A[1] * B[3] + A[2] * B[6],
    A[0] * B[1] + A[1] * B[4] + A[2] * B[7],
    A[0] * B[2] + A[1] * B[5] + A[2] * B[8],

    A[3] * B[0] + A[4] * B[3] + A[5] * B[6],
    A[3] * B[1] + A[4] * B[4] + A[5] * B[7],
    A[3] * B[2] + A[4] * B[5] + A[5] * B[8],

    A[6] * B[0] + A[7] * B[3] + A[8] * B[6],
    A[6] * B[1] + A[7] * B[4] + A[8] * B[7],
    A[6] * B[2] + A[7] * B[5] + A[8] * B[8],

    A[9] * B[0] + A[10] * B[3] + A[11] * B[6] + B[9],
    A[9] * B[1] + A[10] * B[4] + A[11] * B[7] + B[10],
    A[9] * B[2] + A[10] * B[5] + A[11] * B[8] + B[11],
  ];
}

/**
 * Transforms a point according to the primary 3MF Core Specification (Section 4.1):
 * [x', y', z', 1] = [x, y, z, 1] * M
 * x' = x*M0 + y*M3 + z*M6 + M9
 * y' = x*M1 + y*M4 + z*M7 + M10
 * z' = x*M2 + y*M5 + z*M8 + M11
 */
function transformPoint(M: Matrix3x4, x: number, y: number, z: number): [number, number, number] {
  return [x * M[0] + y * M[3] + z * M[6] + M[9], x * M[1] + y * M[4] + z * M[7] + M[10], x * M[2] + y * M[5] + z * M[8] + M[11]];
}

interface ObjectReference {
  modelPath: string;
  objectId: string;
  transform: Matrix3x4;
}

interface RawMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

interface RawObject {
  mesh?: RawMesh;
  components?: ObjectReference[];
}

interface ModelPart {
  unitScale: number;
  objects: Map<string, RawObject>;
  buildItems: ObjectReference[];
  hasBuild: boolean;
  hasBuildTransforms: boolean;
}

function resolveProductionPath(path: string): string {
  const invalidPath = () => new Error(`Invalid 3MF Production model path "${path}". Expected an absolute path inside the archive.`);
  if (!path.startsWith('/')) throw invalidPath();
  const entryPath = path.slice(1);
  for (const segment of entryPath.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw invalidPath();
    }
    if (!segment || decoded === '.' || decoded.includes('..') || /[/:\\?#\p{Cc}]/u.test(decoded)) throw invalidPath();
  }
  return entryPath;
}

const MODEL_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  model: ['resources', 'build'],
  resources: ['object'],
  object: ['mesh', 'components'],
  mesh: ['vertices', 'triangles'],
  vertices: ['vertex'],
  triangles: ['triangle'],
  components: ['component'],
  build: ['item'],
};

class MeshTriples<T extends Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>> {
  private values: T;
  private length = 0;

  constructor(private readonly ArrayType: new (length: number) => T) {
    this.values = new ArrayType(0);
  }

  append(a: number, b: number, c: number): void {
    if (this.length === this.values.length) {
      const expanded = new this.ArrayType(Math.max(24, this.length * 2));
      expanded.set(this.values);
      this.values = expanded;
    }
    this.values[this.length++] = a;
    this.values[this.length++] = b;
    this.values[this.length++] = c;
  }

  finish(): T {
    return this.values.subarray(0, this.length) as T;
  }
}

function parseModelUnit(tag: SaxesTagNS): number {
  const namespace = tag.uri.trim();
  if (namespace && !namespace.includes('3dmanufacturing')) {
    throw new Error(`Unsupported 3MF: unknown namespace "${namespace}". Expected 3MF Core namespace.`);
  }

  for (const attr of Object.values(tag.attributes)) {
    if (attr.prefix === 'xmlns' || attr.local.toLowerCase() !== 'requiredextensions') continue;
    for (const prefix of attr.value.trim().split(/\s+/)) {
      if (prefix && tag.ns[prefix] !== PRODUCTION_NAMESPACE) {
        throw new Error(`Unsupported 3MF: required extension "${prefix}" is not supported.`);
      }
    }
  }

  const unit = (tag.attributes.unit?.value.trim() || 'millimeter').toLowerCase();
  switch (unit) {
    case 'micron':
      return 0.001;
    case 'millimeter':
      return 1;
    case 'centimeter':
      return 10;
    case 'inch':
      return 25.4;
    case 'foot':
      return 304.8;
    case 'meter':
      return 1000;
    default:
      throw new Error(`Unsupported or invalid 3MF unit: "${unit}".`);
  }
}

function parseModelPart(bytes: Uint8Array, path: string, isRoot: boolean, warnings: Set<string>): ModelPart {
  const part: ModelPart = { unitScale: 1, objects: new Map(), buildItems: [], hasBuild: false, hasBuildTransforms: false };
  const elements: (string | undefined)[] = [];
  let coreNamespace = '';
  let objectId = '';
  let object: RawObject;
  let vertices: MeshTriples<Float32Array<ArrayBuffer>>;
  let triangles: MeshTriples<Uint32Array<ArrayBuffer>>;

  function parseReference(tag: SaxesTagNS, matrix?: string): ObjectReference {
    const targetPath = Object.values(tag.attributes)
      .find((attr) => attr.local === 'path' && attr.uri === PRODUCTION_NAMESPACE)
      ?.value.trim();
    if (targetPath !== undefined && !isRoot) {
      throw new Error(`Invalid 3MF: Production path on a component in non-root model part "/${path}".`);
    }

    const transform = parse3MFMatrix(matrix);
    // Normalize translations in the units of the part that declares the transform.
    transform[9] *= part.unitScale;
    transform[10] *= part.unitScale;
    transform[11] *= part.unitScale;
    return {
      modelPath: targetPath === undefined ? path : resolveProductionPath(targetPath),
      objectId: tag.attributes.objectid?.value.trim() ?? '',
      transform,
    };
  }

  function parseIndex(attribute?: string): number {
    const value = attribute?.trim() ?? '';
    const index = Number(value);
    if (!/^\d+$/.test(value) || index > 0xffffffff) {
      throw new Error(`Invalid 3MF vertex index "${value}" in object "${objectId}".`);
    }
    return index;
  }

  const malformedXml = (detail: string, cause?: Error) =>
    new Error(`Invalid 3MF: malformed XML in 3D model document "/${path}" (${detail}).`, { cause });
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', (error) => {
    throw malformedXml(error.message, error);
  });
  parser.on('doctype', () => {
    throw malformedXml('DTDs are forbidden');
  });

  parser.on('opentag', (tag) => {
    const parent = elements.at(-1);
    const isModel = elements.length === 0;
    if (isModel) {
      if (tag.local !== 'model') throw new Error('Invalid 3MF: root <model> element missing.');
      coreNamespace = tag.uri;
    }
    const element = isModel || (tag.uri === coreNamespace && parent && MODEL_CHILDREN[parent]?.includes(tag.local)) ? tag.local : undefined;
    elements.push(element);

    if (parent === 'resources' && ['colorgroup', 'base', 'm_colorgroup'].includes(tag.local)) {
      warnings.add('3MF color groups, materials, and textures were ignored (geometry-only import).');
    }

    const attrs = tag.attributes;
    switch (element) {
      case 'model':
        part.unitScale = parseModelUnit(tag);
        break;
      case 'object':
        objectId = attrs.id?.value.trim() ?? '';
        if (!objectId || part.objects.has(objectId)) {
          throw new Error(`Invalid 3MF object ID "${objectId}". Object IDs must be present and unique.`);
        }
        object = {};
        part.objects.set(objectId, object);
        break;
      case 'mesh':
        if (object.mesh) throw malformedXml(`duplicate mesh in object "${objectId}"`);
        vertices = new MeshTriples(Float32Array);
        triangles = new MeshTriples(Uint32Array);
        break;
      case 'vertex':
        vertices.append(Number(attrs.x?.value), Number(attrs.y?.value), Number(attrs.z?.value));
        break;
      case 'triangle':
        triangles.append(parseIndex(attrs.v1?.value), parseIndex(attrs.v2?.value), parseIndex(attrs.v3?.value));
        break;
      case 'component':
        (object.components ??= []).push(parseReference(tag, attrs.transform?.value.trim()));
        break;
      case 'build':
        part.hasBuild = true;
        break;
      case 'item':
        // Only the root model contributes build instructions.
        if (isRoot) {
          const matrix = attrs.transform?.value.trim();
          part.buildItems.push(parseReference(tag, matrix));
          part.hasBuildTransforms ||= Boolean(matrix);
        }
        break;
    }
  });

  parser.on('closetag', () => {
    if (elements.pop() !== 'mesh') return;
    const positions = vertices.finish();
    const indices = triangles.finish();
    // Check indices after the full mesh has been read, before looking up any instances.
    for (const index of indices) {
      if (index >= positions.length / 3) {
        throw new Error(`Invalid 3MF vertex index "${index}" in object "${objectId}".`);
      }
    }
    object.mesh = { positions, indices };
  });

  const decoder = new TextDecoder();
  const chunkBytes = 64 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    parser.write(decoder.decode(bytes.subarray(offset, offset + chunkBytes), { stream: true }));
  }
  parser.write(decoder.decode()).close();
  return part;
}

/**
 * Parses a 3MF archive without retaining an XML tree for model parts.
 * Runs completely in a Web Worker without DOMParser.
 */
export async function parse3MF(buffer: ArrayBuffer, name = 'model', limits = DEFAULT_MESH_GEOMETRY_LIMITS): Promise<MeshModel> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new Error(`Failed to read 3MF archive: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  // 1. Zip bomb & security inspection
  const entries = Object.keys(zip.files);
  if (entries.length > MAX_ZIP_ENTRY_COUNT) {
    throw new Error(`3MF archive contains too many entries (${entries.length.toLocaleString()}).`);
  }

  let totalDeclaredBytes = 0;
  for (const path of entries) {
    const entry = zip.files[path];
    const originalPath = entry.unsafeOriginalName ?? path;
    if ([path, originalPath].some((name) => name.includes('..') || name.startsWith('/') || name.startsWith('\\'))) {
      throw new Error(`3MF archive contains forbidden relative/absolute path: "${originalPath}"`);
    }
    const uncompressedSize = (entry as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0;
    totalDeclaredBytes += uncompressedSize;
  }

  if (totalDeclaredBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
    const maxMb = (MAX_ZIP_UNCOMPRESSED_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(
      `3MF archive declared uncompressed size (${(totalDeclaredBytes / (1024 * 1024)).toFixed(1)} MB) exceeds maximum limit of ${maxMb} MB.`,
    );
  }

  let actualDecompressedBytes = 0;
  async function safeReadBytes(entry: JSZip.JSZipObject): Promise<Uint8Array> {
    const bytes = await readZipEntry(
      entry,
      MAX_ZIP_UNCOMPRESSED_BYTES - actualDecompressedBytes,
      '3MF archive exceeded maximum actual decompressed size during extraction.',
    );
    actualDecompressedBytes += bytes.byteLength;
    return bytes;
  }

  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'Relationship',
  });

  // 2. Inspect relationships in _rels/.rels
  let modelPath = '3D/3dmodel.model';
  let modelEntry: JSZip.JSZipObject | null;
  const relsEntry = zip.file('_rels/.rels');

  if (relsEntry) {
    const relsXml = new TextDecoder().decode(await safeReadBytes(relsEntry));
    const relsValidation = XMLValidator.validate(relsXml);
    if (relsValidation !== true) {
      throw new Error(`Invalid 3MF: malformed XML in relationships document (${relsValidation.err.msg}).`);
    }

    const relsParsed = xmlParser.parse(relsXml);
    const relationships = relsParsed?.Relationships?.Relationship || [];

    let foundModelRel = false;
    for (const rel of relationships) {
      const targetMode = rel['@_TargetMode'] || rel['@_targetmode'];
      const target = String(rel['@_Target'] || rel['@_target'] || '');

      if (targetMode === 'External' || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
        throw new Error('Unsupported 3MF: external relationships are not permitted for security.');
      }

      const type = String(rel['@_Type'] || rel['@_type'] || '');
      if (type === 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel' || type.endsWith('/3dmodel')) {
        let resolved = target.startsWith('/') ? target.slice(1) : target;
        resolved = resolved.replace(/^\.\//, '').replace(/\/+/g, '/');
        modelPath = resolved;
        foundModelRel = true;
        break;
      }
    }

    if (!foundModelRel) {
      throw new Error(
        'Invalid 3MF: relationships document _rels/.rels does not specify a 3D model relationship (http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel).',
      );
    }

    modelEntry = zip.file(modelPath);
    if (!modelEntry) {
      throw new Error(`3MF archive declared root model at "${modelPath}" in _rels/.rels, but the file was not found in the archive.`);
    }
  } else {
    // Missing _rels/.rels: only permit if archive contains exactly ONE .model file
    const modelCandidates = entries.filter((p) => p.toLowerCase().endsWith('.model') && !p.endsWith('/'));
    if (modelCandidates.length === 1) {
      modelPath = modelCandidates[0];
      modelEntry = zip.file(modelPath);
    } else if (modelCandidates.length > 1) {
      throw new Error(
        `Invalid 3MF: multiple .model files found (${modelCandidates.join(', ')}) but _rels/.rels is missing to determine the primary model.`,
      );
    } else {
      throw new Error('Invalid 3MF: archive contains no .model document.');
    }
  }

  if (!modelEntry) {
    throw new Error(`3MF archive missing 3D model document (expected "${modelPath}").`);
  }

  const warnings = new Set<string>();
  const modelParts = new Map<string, ModelPart>();

  async function loadModelPart(path: string): Promise<ModelPart> {
    const cached = modelParts.get(path);
    if (cached) return cached;

    const entry = zip.file(path);
    if (!entry) throw new Error(`Invalid 3MF: referenced model part "/${path}" was not found in the archive.`);
    const part = parseModelPart(await safeReadBytes(entry), path, path === modelPath, warnings);
    modelParts.set(path, part);
    return part;
  }

  const root = await loadModelPart(modelPath);
  const meshInstances: { mesh: RawMesh; transform: Matrix3x4; unitScale: number }[] = [];
  const activeObjects = new Set<RawObject>();
  let cumulativeInstances = 0;
  let expectedTriangles = 0;
  let expectedVertices = 0;
  let hasTransformsOrInstances = root.hasBuildTransforms;

  // Resolve the hierarchy and check expanded limits before allocating the output.
  async function collectMeshes(reference: ObjectReference, parentTransform?: Matrix3x4): Promise<void> {
    const { modelPath, objectId, transform } = reference;
    const part = await loadModelPart(modelPath);
    const obj = part.objects.get(objectId);
    if (!obj) throw new Error(`Invalid 3MF reference to missing object "${objectId}" in model part "/${modelPath}".`);
    if (activeObjects.has(obj)) {
      throw new Error(`Circular component reference detected in 3MF object "${objectId}".`);
    }

    cumulativeInstances++;
    if (cumulativeInstances > 10_000) {
      throw new Error('3MF archive exceeds maximum allowed component instances (10,000).');
    }

    const combined = parentTransform ? multiply3MFMatrices(transform, parentTransform) : transform;
    if (obj.mesh) {
      expectedVertices += obj.mesh.positions.length / 3;
      expectedTriangles += obj.mesh.indices.length / 3;

      if (expectedTriangles > limits.maxTriangles) {
        throw new Error(
          `3MF model exceeds maximum allowed triangles (${expectedTriangles.toLocaleString()} > ${limits.maxTriangles.toLocaleString()}).`,
        );
      }
      if (expectedVertices > limits.maxVertices) {
        throw new Error('3MF model exceeds maximum allowed vertices.');
      }
      meshInstances.push({ mesh: obj.mesh, transform: combined, unitScale: part.unitScale });
    }

    if (obj.components && obj.components.length > 0) {
      hasTransformsOrInstances = true;
      activeObjects.add(obj);
      for (const comp of obj.components) {
        await collectMeshes(comp, combined);
      }
      activeObjects.delete(obj);
    }
  }

  if (root.hasBuild) {
    for (const item of root.buildItems) {
      await collectMeshes(item);
    }
  } else {
    // Recover geometry from legacy files that omit the build element entirely.
    for (const [objectId, obj] of root.objects) {
      if (obj.mesh) {
        await collectMeshes({ modelPath, objectId, transform: IDENTITY_MATRIX });
      }
    }
  }

  if (expectedVertices === 0 || expectedTriangles === 0) {
    throw new Error('3MF model contains no valid mesh geometry.');
  }

  const positions = new Float32Array(expectedVertices * 3);
  const indices = new Uint32Array(expectedTriangles * 3);
  let currentVertexOffset = 0;
  let currentIndexOffset = 0;
  for (const { mesh, transform, unitScale } of meshInstances) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = transformPoint(
        transform,
        mesh.positions[i] * unitScale,
        mesh.positions[i + 1] * unitScale,
        mesh.positions[i + 2] * unitScale,
      );
      const offset = currentVertexOffset * 3 + i;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;
    }

    const isMirrored = matrixDeterminant(transform) < 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      indices[currentIndexOffset + t] = mesh.indices[t] + currentVertexOffset;
      indices[currentIndexOffset + t + 1] = mesh.indices[t + (isMirrored ? 2 : 1)] + currentVertexOffset;
      indices[currentIndexOffset + t + 2] = mesh.indices[t + (isMirrored ? 1 : 2)] + currentVertexOffset;
    }
    currentVertexOffset += mesh.positions.length / 3;
    currentIndexOffset += mesh.indices.length;
  }

  if (root.buildItems.length > 1 || hasTransformsOrInstances) {
    warnings.add('3MF build transforms, component instances, and object hierarchy were flattened into a single geometry.');
  }

  return {
    name,
    positions,
    indices,
    warnings: [...warnings],
  };
}

/**
 * Serializes a MeshModel to standard 3MF ZIP archive.
 */
export async function export3MF(model: MeshModel): Promise<Blob> {
  const zip = new JSZip();

  // 1. [Content_Types].xml
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`,
  );

  // 2. _rels/.rels
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model" />
</Relationships>`,
  );

  // 3. Build 3D/3dmodel.model
  const { positions, indices } = model;
  const vertexCount = positions.length / 3;

  let verticesXml = '';
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    verticesXml += `          <vertex x="${x}" y="${y}" z="${z}" />\n`;
  }

  let trianglesXml = '';
  for (let t = 0; t < indices.length; t += 3) {
    trianglesXml += `          <triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}" />\n`;
  }

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${verticesXml}        </vertices>
        <triangles>
${trianglesXml}        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

  zip.folder('3D')?.file('3dmodel.model', modelXml);

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
