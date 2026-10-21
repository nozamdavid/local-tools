import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { MeshModel } from '../types';
import {
  MAX_TRIANGLE_COUNT,
  MAX_VERTEX_COUNT,
  MAX_ZIP_ENTRY_COUNT,
  MAX_ZIP_UNCOMPRESSED_BYTES,
} from '../validation';

type Matrix3x4 = [
  number, number, number,
  number, number, number,
  number, number, number,
  number, number, number
];

const IDENTITY_MATRIX: Matrix3x4 = [
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
  0, 0, 0,
];

function matrixDeterminant(M: Matrix3x4): number {
  return (
    M[0] * (M[4] * M[8] - M[5] * M[7]) -
    M[1] * (M[3] * M[8] - M[5] * M[6]) +
    M[2] * (M[3] * M[7] - M[4] * M[6])
  );
}

function parse3MFMatrix(str?: string): Matrix3x4 {
  if (!str) return [...IDENTITY_MATRIX];
  const parts = str.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || parts.some(n => !Number.isFinite(n))) {
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
  return [
    x * M[0] + y * M[3] + z * M[6] + M[9],
    x * M[1] + y * M[4] + z * M[7] + M[10],
    x * M[2] + y * M[5] + z * M[8] + M[11],
  ];
}

interface RawObject {
  id: string;
  type?: string;
  mesh?: {
    positions: Float32Array;
    indices: Uint32Array;
  };
  components?: Array<{
    objectId: string;
    transform: Matrix3x4;
  }>;
}

/**
 * Parses a 3MF archive using fast-xml-parser and JSZip.
 * Runs completely in a Web Worker without DOMParser.
 */
export async function parse3MF(buffer: ArrayBuffer, name = 'model'): Promise<MeshModel> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new Error(`Failed to read 3MF archive: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 1. Zip bomb & security inspection
  const entries = Object.keys(zip.files);
  if (entries.length > MAX_ZIP_ENTRY_COUNT) {
    throw new Error(`3MF archive contains too many entries (${entries.length.toLocaleString()}).`);
  }

  let totalDeclaredBytes = 0;
  for (const path of entries) {
    if (path.includes('..') || path.startsWith('/') || path.startsWith('\\')) {
      throw new Error(`3MF archive contains forbidden relative/absolute path: "${path}"`);
    }
    const entry = zip.files[path];
    const uncompressedSize = (entry as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0;
    totalDeclaredBytes += uncompressedSize;
  }

  if (totalDeclaredBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
    const maxMb = (MAX_ZIP_UNCOMPRESSED_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(
      `3MF archive declared uncompressed size (${(totalDeclaredBytes / (1024 * 1024)).toFixed(1)} MB) exceeds maximum limit of ${maxMb} MB.`
    );
  }

  let actualDecompressedBytes = 0;
  async function safeReadText(entry: JSZip.JSZipObject): Promise<string> {
    const text = await entry.async('string');
    actualDecompressedBytes += text.length;
    if (actualDecompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error('3MF archive exceeded maximum actual decompressed size during extraction.');
    }
    return text;
  }

  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['vertex', 'triangle', 'object', 'component', 'item', 'Relationship'].includes(name),
  });

  // 2. Inspect relationships in _rels/.rels
  let modelPath = '3D/3dmodel.model';
  let modelEntry: JSZip.JSZipObject | null = null;
  const relsEntry = zip.file('_rels/.rels');

  if (relsEntry) {
    const relsXml = await safeReadText(relsEntry);
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
        'Invalid 3MF: relationships document _rels/.rels does not specify a 3D model relationship (http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel).'
      );
    }

    modelEntry = zip.file(modelPath);
    if (!modelEntry) {
      throw new Error(
        `3MF archive declared root model at "${modelPath}" in _rels/.rels, but the file was not found in the archive.`
      );
    }
  } else {
    // Missing _rels/.rels: only permit if archive contains exactly ONE .model file
    const modelCandidates = entries.filter((p) => p.toLowerCase().endsWith('.model') && !p.endsWith('/'));
    if (modelCandidates.length === 1) {
      modelPath = modelCandidates[0];
      modelEntry = zip.file(modelPath);
    } else if (modelCandidates.length > 1) {
      throw new Error(
        `Invalid 3MF: multiple .model files found (${modelCandidates.join(', ')}) but _rels/.rels is missing to determine the primary model.`
      );
    } else {
      throw new Error('Invalid 3MF: archive contains no .model document.');
    }
  }

  if (!modelEntry) {
    throw new Error(`3MF archive missing 3D model document (expected "${modelPath}").`);
  }

  const modelXml = await safeReadText(modelEntry);
  const modelValidation = XMLValidator.validate(modelXml);
  if (modelValidation !== true) {
    throw new Error(`Invalid 3MF: malformed XML in 3D model document (${modelValidation.err.msg}).`);
  }

  const parsedModel = xmlParser.parse(modelXml);

  const modelNode = parsedModel?.model;
  if (!modelNode) {
    throw new Error('Invalid 3MF: root <model> element missing.');
  }

  // Validate root namespace
  if (modelNode['@_xmlns']) {
    const ns = String(modelNode['@_xmlns']).trim();
    if (!ns.includes('3dmanufacturing')) {
      throw new Error(`Unsupported 3MF: unknown namespace "${ns}". Expected 3MF Core namespace.`);
    }
  }

  // Check required extensions (case-insensitive and prefix-tolerant)
  const reqExtKey = Object.keys(modelNode).find((k) =>
    k.toLowerCase().replace(/^@_.*:/, '@_').endsWith('requiredextensions')
  );
  const requiredExts = reqExtKey ? modelNode[reqExtKey] : undefined;
  if (requiredExts && String(requiredExts).trim().length > 0) {
    throw new Error(`Unsupported 3MF: required extension "${requiredExts}" is not supported.`);
  }

  // Units conversion to millimeters (mm) - fail closed on unknown units
  const unitAttr = modelNode['@_unit'];
  const unit = (unitAttr ? String(unitAttr) : 'millimeter').toLowerCase();
  let unitScale = 1.0;
  const warnings: string[] = [];

  switch (unit) {
    case 'micron':
      unitScale = 0.001;
      break;
    case 'millimeter':
      unitScale = 1.0;
      break;
    case 'centimeter':
      unitScale = 10.0;
      break;
    case 'inch':
      unitScale = 25.4;
      break;
    case 'foot':
      unitScale = 304.8;
      break;
    case 'meter':
      unitScale = 1000.0;
      break;
    default:
      throw new Error(`Unsupported or invalid 3MF unit: "${unit}".`);
  }

  // 4. Parse resources: objects (<mesh> or <components>)
  const resourcesNode = modelNode.resources;
  const rawObjectsMap = new Map<string, RawObject>();

  if (resourcesNode) {
    if (resourcesNode.colorgroup || resourcesNode.base || resourcesNode.m_colorgroup) {
      warnings.push('3MF color groups, materials, and textures were ignored (geometry-only import).');
    }

    const objectNodes: unknown[] = resourcesNode.object || [];
    for (const objNode of objectNodes) {
      const obj = objNode as Record<string, unknown>;
      const objId = String(obj['@_id'] || '');
      if (!objId) continue;

      const rawObj: RawObject = {
        id: objId,
        type: String(obj['@_type'] || 'model'),
      };

      if (obj.mesh) {
        const meshNode = obj.mesh as Record<string, unknown>;
        const verticesNode = (meshNode.vertices as Record<string, unknown>)?.vertex || [];
        const trianglesNode = (meshNode.triangles as Record<string, unknown>)?.triangle || [];

        const vList = Array.isArray(verticesNode) ? verticesNode : [verticesNode];
        const tList = Array.isArray(trianglesNode) ? trianglesNode : [trianglesNode];

        const positions = new Float32Array(vList.length * 3);
        for (let i = 0; i < vList.length; i++) {
          const v = vList[i] as Record<string, unknown>;
          positions[i * 3] = parseFloat(String(v['@_x'] || '0'));
          positions[i * 3 + 1] = parseFloat(String(v['@_y'] || '0'));
          positions[i * 3 + 2] = parseFloat(String(v['@_z'] || '0'));
        }

        const indices = new Uint32Array(tList.length * 3);
        for (let t = 0; t < tList.length; t++) {
          const tri = tList[t] as Record<string, unknown>;
          indices[t * 3] = parseInt(String(tri['@_v1'] || '0'), 10);
          indices[t * 3 + 1] = parseInt(String(tri['@_v2'] || '0'), 10);
          indices[t * 3 + 2] = parseInt(String(tri['@_v3'] || '0'), 10);
        }

        rawObj.mesh = { positions, indices };
      }

      if (obj.components) {
        const compNodes = (obj.components as Record<string, unknown>).component || [];
        const cList = Array.isArray(compNodes) ? compNodes : [compNodes];
        const components: Array<{ objectId: string; transform: Matrix3x4 }> = [];

        for (const c of cList) {
          const comp = c as Record<string, unknown>;
          const targetObjId = String(comp['@_objectid'] || '');
          const transform = parse3MFMatrix(comp['@_transform'] ? String(comp['@_transform']) : undefined);
          components.push({ objectId: targetObjId, transform });
        }
        rawObj.components = components;
      }

      rawObjectsMap.set(objId, rawObj);
    }
  }

  // 5. Precheck cumulative component instances and triangle/vertex limits BEFORE expanding allocations
  const buildNode = modelNode.build;
  const buildItemNodes: unknown[] = buildNode?.item || [];
  const buildItems = Array.isArray(buildItemNodes) ? buildItemNodes : [buildItemNodes];

  let cumulativeInstances = 0;
  let expectedTriangles = 0;
  let expectedVertices = 0;

  function precheckObject(objectId: string, visited: Set<string>): void {
    if (visited.has(objectId)) {
      throw new Error(`Circular component reference detected in 3MF object "${objectId}".`);
    }

    const obj = rawObjectsMap.get(objectId);
    if (!obj) return;

    cumulativeInstances++;
    if (cumulativeInstances > 10_000) {
      throw new Error('3MF archive exceeds maximum allowed component instances (10,000).');
    }

    if (obj.mesh) {
      expectedVertices += obj.mesh.positions.length / 3;
      expectedTriangles += obj.mesh.indices.length / 3;

      if (expectedTriangles > MAX_TRIANGLE_COUNT) {
        throw new Error(
          `3MF model exceeds maximum allowed triangles (${expectedTriangles.toLocaleString()} > ${MAX_TRIANGLE_COUNT.toLocaleString()}).`
        );
      }
      if (expectedVertices > MAX_VERTEX_COUNT) {
        throw new Error('3MF model exceeds maximum allowed vertices.');
      }
    }

    if (obj.components && obj.components.length > 0) {
      const nextVisited = new Set(visited);
      nextVisited.add(objectId);

      for (const comp of obj.components) {
        precheckObject(comp.objectId, nextVisited);
      }
    }
  }

  if (buildItems.length > 0) {
    for (const itemNode of buildItems) {
      const item = itemNode as Record<string, unknown>;
      const objectId = String(item['@_objectid'] || '');
      precheckObject(objectId, new Set());
    }
  } else {
    for (const [id, obj] of rawObjectsMap.entries()) {
      if (obj.mesh) {
        precheckObject(id, new Set());
      }
    }
  }

  // 6. Instantiate build items
  const accumulatedPositions: number[] = [];
  const accumulatedIndices: number[] = [];
  let currentVertexOffset = 0;
  let hasTransformsOrInstances = false;

  function instantiateObject(
    objectId: string,
    currentTransform: Matrix3x4,
    visited: Set<string>
  ): void {
    if (visited.has(objectId)) {
      throw new Error(`Circular component reference detected in 3MF object "${objectId}".`);
    }

    const obj = rawObjectsMap.get(objectId);
    if (!obj) return;

    if (obj.mesh) {
      const { positions, indices } = obj.mesh;
      const vCount = positions.length / 3;

      for (let i = 0; i < vCount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];

        // Apply affine transformation
        const [tx, ty, tz] = transformPoint(currentTransform, x, y, z);

        // Convert to millimeters
        accumulatedPositions.push(tx * unitScale, ty * unitScale, tz * unitScale);
      }

      // Check if transform has reflection (negative determinant)
      const isMirrored = matrixDeterminant(currentTransform) < 0;

      for (let t = 0; t < indices.length; t += 3) {
        if (isMirrored) {
          accumulatedIndices.push(
            indices[t] + currentVertexOffset,
            indices[t + 2] + currentVertexOffset,
            indices[t + 1] + currentVertexOffset
          );
        } else {
          accumulatedIndices.push(
            indices[t] + currentVertexOffset,
            indices[t + 1] + currentVertexOffset,
            indices[t + 2] + currentVertexOffset
          );
        }
      }

      currentVertexOffset += vCount;
    }

    if (obj.components && obj.components.length > 0) {
      hasTransformsOrInstances = true;
      const nextVisited = new Set(visited);
      nextVisited.add(objectId);

      for (const comp of obj.components) {
        // Compose child transform with parent transform: comp.transform * currentTransform
        const combined = multiply3MFMatrices(comp.transform, currentTransform);
        instantiateObject(comp.objectId, combined, nextVisited);
      }
    }
  }

  if (buildItems.length > 0) {
    for (const itemNode of buildItems) {
      const item = itemNode as Record<string, unknown>;
      const objectId = String(item['@_objectid'] || '');
      const transformStr = item['@_transform'] ? String(item['@_transform']) : undefined;
      if (transformStr) hasTransformsOrInstances = true;

      const transform = parse3MFMatrix(transformStr);
      instantiateObject(objectId, transform, new Set());
    }
  } else {
    // If no <build> items specified, instantiate all root mesh objects directly
    for (const [id, obj] of rawObjectsMap.entries()) {
      if (obj.mesh) {
        instantiateObject(id, [...IDENTITY_MATRIX], new Set());
      }
    }
  }

  if (buildItems.length > 1 || hasTransformsOrInstances) {
    warnings.push(
      '3MF build transforms, component instances, and object hierarchy were flattened into a single geometry.'
    );
  }

  if (accumulatedPositions.length === 0 || accumulatedIndices.length === 0) {
    throw new Error('3MF model contains no valid mesh geometry.');
  }

  return {
    name,
    positions: new Float32Array(accumulatedPositions),
    indices: new Uint32Array(accumulatedIndices),
    warnings,
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
</Types>`
  );

  // 2. _rels/.rels
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model" />
</Relationships>`
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
  <metadata name="Application">Loconvert Local 3D Tools</metadata>
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
