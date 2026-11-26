import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader, type GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { MAX_FILE_SIZE_BYTES } from '../_mesh/validation';

export interface LocalSceneAsset {
  root: THREE.Group;
  vertices: number;
  triangles: number;
  meshes: number;
  materials: number;
  textures: number;
  dimensions: [number, number, number];
  dispose(): void;
}

const MiB = 1024 * 1024;
const MAX_JSON_BYTES = 32 * MiB;
const MAX_GEOMETRY_BYTES = 128 * MiB;
const MAX_DRAW_ELEMENTS = 10_000_000;
const MAX_IMAGE_BYTES = 32 * MiB;
const MAX_IMAGE_PIXELS = 16_777_216;
const MAX_TOTAL_IMAGE_PIXELS = 33_554_432;
const MAX_DEFINITIONS = 20_000;
const MAX_DEPTH = 128;
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

const invalid = 'The glTF file contains invalid scene data.';
const geometryLimit = 'The glTF model exceeds the geometry limit.';
const imageLimit = 'The glTF model exceeds the image size limit.';
const empty = 'The glTF scene contains no drawable geometry.';
const draco = 'Draco-compressed glTF models are unsupported.';
const basis = 'Basis Universal and KTX2 glTF textures are unsupported.';

interface BufferRange {
  buffer: number;
  byteLength: number;
  byteOffset?: number;
}

interface MeshoptRange extends BufferRange {
  count: number;
  byteStride: number;
}

interface Accessor {
  count: number;
  type: string;
  componentType: number;
  bufferView?: number;
  byteOffset?: number;
  sparse?: {
    count: number;
    indices: { bufferView: number; byteOffset?: number; componentType: number };
    values: { bufferView: number; byteOffset?: number };
  };
}

interface ImageSource {
  uri?: string;
  bufferView?: number;
  mimeType?: string;
}

interface Primitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
  targets?: Record<string, number>[];
  extensions?: { KHR_draco_mesh_compression?: unknown };
}

interface Document {
  buffers?: { byteLength: number; uri?: string }[];
  bufferViews?: (BufferRange & {
    byteStride?: number;
    extensions?: { EXT_meshopt_compression?: MeshoptRange; KHR_meshopt_compression?: MeshoptRange };
  })[];
  accessors?: Accessor[];
  images?: ImageSource[];
  textures?: {
    source?: number;
    extensions?: {
      KHR_texture_basisu?: { source: number };
      EXT_texture_webp?: { source: number };
      EXT_texture_avif?: { source: number };
    };
  }[];
  meshes?: { primitives: Primitive[] }[];
  nodes?: {
    mesh?: number;
    children?: number[];
    extensions?: { EXT_mesh_gpu_instancing?: { attributes: Record<string, number> } };
  }[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  animations?: {
    samplers: { input: number; output: number }[];
    channels: { sampler: number }[];
  }[];
}

class LocalSceneError extends Error {
  constructor(
    message: string,
    cause?: unknown,
    readonly params?: { path: string },
  ) {
    super(message, { cause });
  }
}

function requireValid(condition: unknown, message = invalid): asserts condition {
  if (!condition) throw new LocalSceneError(message);
}

function natural(value: number, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function at<T>(items: T[], index: number): T {
  requireValid(natural(index, items.length - 1) && items[index] != null);
  return items[index];
}

function checkContainer(data: ArrayBuffer) {
  const view = new DataView(data);
  if (data.byteLength < 4 || view.getUint32(0, true) !== GLB_MAGIC) {
    requireValid(data.byteLength <= MAX_JSON_BYTES, 'The glTF document exceeds the size limit.');
    return 0;
  }

  requireValid(data.byteLength >= 20 && view.getUint32(4, true) === 2 && view.getUint32(8, true) === data.byteLength);
  let binLength: number | undefined;
  for (let offset = 12; offset < data.byteLength;) {
    requireValid(offset + 8 <= data.byteLength);
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    requireValid(length % 4 === 0 && offset + 8 + length <= data.byteLength);
    requireValid(offset === 12 ? type === JSON_CHUNK : type !== JSON_CHUNK);
    if (type === JSON_CHUNK) requireValid(length <= MAX_JSON_BYTES, 'The glTF document exceeds the size limit.');
    if (type === BIN_CHUNK) {
      requireValid(offset === 20 + view.getUint32(12, true) && binLength === undefined);
      binLength = length;
    }
    offset += 8 + length;
  }
  return binLength ?? 0;
}

type Resource = File | string;

function pathError(message: string, path: string, cause?: unknown) {
  return new LocalSceneError(message, cause, { path });
}

function localResources(file: File, companions: File[]) {
  const exact = new Map<string, File | null>();
  const flat = new Map<string, File | null>();
  const directory = (file.webkitRelativePath || file.name).split('/').slice(0, -1);

  for (const companion of new Set(companions)) {
    if (companion === file) continue;
    const { webkitRelativePath, name } = companion;
    const key = webkitRelativePath || name;
    exact.set(key, exact.has(key) ? null : companion);
    if (!webkitRelativePath) flat.set(name, flat.has(name) ? null : companion);
  }

  return (uri: string): Resource => {
    requireValid(typeof uri === 'string' && uri.length > 0);
    if (/^data:[^,]*,/i.test(uri)) return uri;

    const parts = [...directory];
    try {
      if (/^(?:\/|[a-z][a-z\d+.-]*:)|[?#\\]/i.test(uri)) throw new Error();
      for (const segment of uri.split('/')) {
        const part = decodeURIComponent(segment);
        if (/[/\\:\p{Cc}]/u.test(part)) throw new Error();
        if (part === '..') {
          if (!parts.length) throw new Error();
          parts.pop();
        } else if (part && part !== '.') {
          parts.push(part);
        }
      }
      if (!parts.length || uri.endsWith('/')) throw new Error();
    } catch {
      throw pathError('The glTF resource {path} must be a relative local path.', uri);
    }

    const candidate = exact.get(parts.join('/'));
    const match = candidate === undefined ? flat.get(parts[parts.length - 1]) : candidate;
    if (match === null) throw pathError('Multiple selected files match the glTF resource {path}.', uri);
    if (!match) throw pathError('Choose the local glTF resource {path} and try again.', uri);
    return match;
  };
}

async function resourceBlob(resource: Resource, signal: AbortSignal) {
  signal.throwIfAborted();
  if (typeof resource !== 'string') return resource;
  // String resources are validated data URLs. External resources are File objects.
  const response = await fetch(resource, { signal });
  requireValid(response.ok);
  return response.blob();
}

const accessorComponents = new Map([
  ['SCALAR', 1],
  ['VEC2', 2],
  ['VEC3', 3],
  ['VEC4', 4],
  ['MAT2', 4],
  ['MAT3', 9],
  ['MAT4', 16],
]);
const componentBytes = new Map([
  [5120, 1],
  [5121, 1],
  [5122, 2],
  [5123, 2],
  [5125, 4],
  [5126, 4],
]);

function validateGeometry(doc: Document, binLength: number) {
  const { buffers = [], bufferViews = [], accessors = [], meshes = [], nodes = [], scenes = [], animations = [] } = doc;
  requireValid(scenes.length > 0, empty);
  at(scenes, doc.scene ?? 0);

  for (const list of [buffers, bufferViews, accessors, meshes, nodes, scenes, animations, doc.images ?? [], doc.textures ?? []]) {
    requireValid(Array.isArray(list) && list.length <= MAX_DEFINITIONS, 'The glTF document exceeds the size limit.');
  }

  requireValid(!doc.extensionsUsed?.includes('KHR_draco_mesh_compression'), draco);
  requireValid(!doc.extensionsRequired?.includes('KHR_texture_basisu'), basis);

  let bufferBytes = 0;
  for (const buffer of buffers) {
    requireValid(natural(buffer.byteLength, MAX_GEOMETRY_BYTES), geometryLimit);
    bufferBytes += buffer.byteLength;
  }
  requireValid(bufferBytes <= MAX_GEOMETRY_BYTES, geometryLimit);

  const checkRange = (range: BufferRange) => {
    const buffer = at(buffers, range.buffer);
    const offset = range.byteOffset ?? 0;
    requireValid(natural(offset) && natural(range.byteLength) && offset + range.byteLength <= buffer.byteLength);
    requireValid(buffer.uri !== undefined || (range.buffer === 0 && buffer.byteLength <= binLength && binLength > 0));
  };

  let decodedBytes = 0;
  for (const view of bufferViews) {
    const compressed = view.extensions?.EXT_meshopt_compression ?? view.extensions?.KHR_meshopt_compression;
    if (compressed) {
      requireValid(MeshoptDecoder.supported, 'Meshopt-compressed glTF models are unsupported in this browser.');
      checkRange(compressed);
      requireValid(natural(compressed.count, MAX_DRAW_ELEMENTS) && compressed.count > 0);
      requireValid(natural(compressed.byteStride, 256) && compressed.byteStride > 0);
      requireValid(view.byteLength === compressed.count * compressed.byteStride);
    } else {
      checkRange(view);
    }
    decodedBytes += view.byteLength;
  }

  const accessorSizes = accessors.map((accessor) => {
    const components = accessorComponents.get(accessor.type);
    const bytes = componentBytes.get(accessor.componentType);
    requireValid(components && bytes && natural(accessor.count, MAX_DRAW_ELEMENTS));
    const itemSize = components * bytes;
    const offset = accessor.byteOffset ?? 0;
    const length = accessor.count * itemSize;
    requireValid(natural(offset) && offset % bytes === 0);
    if (accessor.bufferView !== undefined) {
      const view = at(bufferViews, accessor.bufferView);
      const stride = view.byteStride ?? itemSize;
      requireValid(natural(stride, 256) && stride >= itemSize && stride % bytes === 0);
      const end = stride === itemSize ? offset + length : (Math.floor(offset / stride) + accessor.count) * stride;
      requireValid(end <= view.byteLength && (stride === itemSize || (offset % stride) + itemSize <= stride));
    }
    if (accessor.sparse) {
      const { count, indices, values } = accessor.sparse;
      const indexBytes = componentBytes.get(indices.componentType);
      requireValid(indexBytes && [5121, 5123, 5125].includes(indices.componentType) && natural(count, accessor.count));
      const indexOffset = indices.byteOffset ?? 0;
      const valueOffset = values.byteOffset ?? 0;
      requireValid(natural(indexOffset) && indexOffset + count * indexBytes <= at(bufferViews, indices.bufferView).byteLength);
      requireValid(natural(valueOffset) && valueOffset + count * itemSize <= at(bufferViews, values.bufferView).byteLength);
    }
    decodedBytes += length;
    return length;
  });

  for (const animation of animations) {
    for (const channel of animation.channels) {
      const sampler = at(animation.samplers, channel.sampler);
      decodedBytes += at(accessorSizes, sampler.input) + at(accessorSizes, sampler.output);
    }
  }

  const meshElements = meshes.map(({ primitives }) => {
    let elements = 0;
    for (const primitive of primitives) {
      requireValid(!primitive.extensions?.KHR_draco_mesh_compression, draco);
      const mode = primitive.mode ?? 4;
      requireValid(natural(mode, 6));
      const position = at(accessors, primitive.attributes.POSITION);
      requireValid(position.type === 'VEC3');
      let count = position.count;
      if (primitive.indices !== undefined) {
        const indices = at(accessors, primitive.indices);
        requireValid(indices.type === 'SCALAR' && [5121, 5123, 5125].includes(indices.componentType));
        count = indices.count;
      }
      if (mode === 5 || mode === 6) {
        count = Math.max(0, count - 2) * 3;
        decodedBytes += count * 4;
      }
      const targets = primitive.targets ?? [];
      for (const target of targets) {
        for (const index of Object.values(target)) decodedBytes += at(accessorSizes, index);
      }
      elements += Math.max(position.count, count) * (targets.length + 1);
    }
    return elements;
  });

  const parents = new Set<number>();
  let declaredDrawElements = 0;
  const nodeElements = nodes.map((node) => {
    for (const child of node.children ?? []) {
      at(nodes, child);
      requireValid(!parents.has(child));
      parents.add(child);
    }
    if (node.mesh === undefined) return 0;
    const mesh = at(meshes, node.mesh);
    const instanceAttributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
    let instances = 1;
    if (instanceAttributes) {
      const attributes = Object.values(instanceAttributes);
      requireValid(attributes.length > 0 && mesh.primitives.every(({ mode }) => (mode ?? 4) >= 4));
      instances = at(accessors, attributes[0]).count;
      requireValid(attributes.every((attribute) => at(accessors, attribute).count === instances));
      decodedBytes += instances * mesh.primitives.length * 16 * 4;
    }
    const elements = Math.max(1, at(meshElements, node.mesh)) * instances + mesh.primitives.length;
    declaredDrawElements += elements;
    return elements;
  });

  requireValid(decodedBytes <= MAX_GEOMETRY_BYTES && declaredDrawElements <= MAX_DRAW_ELEMENTS, geometryLimit);

  // Check the node forest before GLTFLoader recursively constructs it, including unused nodes.
  const summaries = new Map<number, { elements: number; nodes: number; height: number }>();
  const visiting = new Set<number>();
  function summarize(index: number, depth: number) {
    requireValid(depth <= MAX_DEPTH && !visiting.has(index));
    const cached = summaries.get(index);
    if (cached) {
      requireValid(depth + cached.height - 1 <= MAX_DEPTH);
      return cached;
    }
    visiting.add(index);
    const summary = { elements: at(nodeElements, index), nodes: 1, height: 1 };
    for (const child of at(nodes, index).children ?? []) {
      const result = summarize(child, depth + 1);
      summary.elements += result.elements;
      summary.nodes += result.nodes;
      summary.height = Math.max(summary.height, result.height + 1);
    }
    visiting.delete(index);
    summaries.set(index, summary);
    return summary;
  }

  for (let i = 0; i < nodes.length; i++) summarize(i, 1);

  let sceneNodes = 0;
  let sceneElements = 0;
  for (const scene of scenes) {
    const roots = new Set<number>();
    for (const index of scene.nodes ?? []) {
      requireValid(!parents.has(index) && !roots.has(index));
      roots.add(index);
      const summary = summarize(index, 1);
      sceneNodes += summary.nodes;
      sceneElements += summary.elements;
      requireValid(sceneNodes <= MAX_DEFINITIONS && sceneElements <= MAX_DRAW_ELEMENTS, geometryLimit);
    }
  }

  for (const texture of doc.textures ?? []) {
    if (
      texture.extensions?.KHR_texture_basisu &&
      texture.source === undefined &&
      !texture.extensions.EXT_texture_webp &&
      !texture.extensions.EXT_texture_avif
    ) {
      throw new LocalSceneError(basis);
    }
  }
}

function imageDimensions(data: ArrayBuffer): [number, number, string] | undefined {
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  if (data.byteLength < 24) return;

  if (view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) {
    return [view.getUint32(16), view.getUint32(20), 'image/png'];
  }

  if (view.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset++] === 0xff) {
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 7) {
        return [view.getUint16(offset + 5), view.getUint16(offset + 3), 'image/jpeg'];
      }
      offset += length;
    }
  }

  if (view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250 && data.byteLength >= 30) {
    switch (view.getUint32(12)) {
      case 0x56503820: // VP8
        if (bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
          return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff, 'image/webp'];
        }
        break;
      case 0x5650384c: {
        // VP8L
        if (bytes[20] !== 0x2f) return;
        const size = view.getUint32(21, true);
        return [(size & 0x3fff) + 1, ((size >>> 14) & 0x3fff) + 1, 'image/webp'];
      }
      case 0x56503858: // VP8X
        if (bytes[20] & 2) return; // Animated textures are outside the decode budget.
        return [(view.getUint32(23, true) & 0xffffff) + 1, (view.getUint32(26, true) & 0xffffff) + 1, 'image/webp'];
    }
  }
}

function sceneStats(root: THREE.Group) {
  const bounds = new THREE.Box3();
  const position = new THREE.Vector3();
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let vertices = 0;
  let triangles = 0;
  let meshes = 0;

  root.updateMatrixWorld(true);
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
    const { geometry } = object;
    const positions = geometry.getAttribute('position');
    if (!positions?.count) return;
    const instanced = object instanceof THREE.InstancedMesh;
    const instances = instanced ? object.count : 1;
    const index = geometry.index;
    const elements = index?.count ?? positions.count;
    if (!instances || !elements) return;

    vertices += positions.count * instances;
    if (object instanceof THREE.Mesh) {
      meshes += instances;
      triangles += Math.floor(elements / 3) * instances;
    }
    requireValid(vertices <= MAX_DRAW_ELEMENTS && triangles * 3 <= MAX_DRAW_ELEMENTS, geometryLimit);

    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }

    for (let instance = 0; instance < instances; instance++) {
      if (instanced) {
        object.getMatrixAt(instance, instanceMatrix);
        worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
      } else {
        worldMatrix.copy(object.matrixWorld);
      }
      for (let i = 0; i < elements; i++) {
        const vertex = index ? index.getX(i) : i;
        requireValid(natural(vertex, positions.count - 1));
        if (object instanceof THREE.Mesh) object.getVertexPosition(vertex, position);
        else position.fromBufferAttribute(positions, vertex);
        position.applyMatrix4(worldMatrix);
        requireValid(Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z));
        bounds.expandByPoint(position);
      }
    }
  });

  requireValid(!bounds.isEmpty(), empty);
  const { x, y, z } = bounds.getSize(position);
  requireValid([x, y, z].every(Number.isFinite));
  return {
    vertices,
    triangles,
    meshes,
    materials: materials.size,
    textures: textures.size,
    dimensions: [x, y, z] as [number, number, number],
  };
}

export async function loadLocalScene(file: File, companions: File[], signal?: AbortSignal): Promise<LocalSceneAsset> {
  signal?.throwIfAborted();
  const files = new Set([file, ...companions]);
  let bytes = 0;
  for (const selected of files) bytes += selected.size;
  requireValid(bytes <= MAX_FILE_SIZE_BYTES && files.size <= MAX_DEFINITIONS, 'The selected glTF files exceed the size limit.');
  const resolveLocal = localResources(file, companions);
  const controller = new AbortController();
  const localSignal = controller.signal;
  const urls = new Set<string>();
  const resources = new Set<{ dispose(): void }>();
  const bitmaps = new Set<ImageBitmap>();
  const disposed = new WeakSet<object>();
  let released = false;

  function releaseUrls() {
    for (const url of urls) {
      URL.revokeObjectURL(url);
      THREE.Cache.remove(`image-bitmap:${url}`);
      THREE.Cache.remove(`image:${url}`);
    }
    urls.clear();
  }

  function release(resource: object, dispose: () => void) {
    if (disposed.has(resource)) return;
    disposed.add(resource);
    dispose();
  }

  function remember(resource: { dispose(): void }) {
    if (released) release(resource, () => resource.dispose());
    else resources.add(resource);
  }

  function rememberTexture(texture: THREE.Texture) {
    remember(texture);
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) {
      const bitmap = texture.image;
      if (released) release(bitmap, () => bitmap.close());
      else bitmaps.add(bitmap);
    }
  }

  function rememberObject(root: THREE.Object3D) {
    root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) remember(object);
      if (object instanceof THREE.SkinnedMesh && object.skeleton) remember(object.skeleton);
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
      remember(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        remember(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) rememberTexture(value);
      }
    });
  }

  function dispose() {
    if (released) return;
    released = true;
    releaseUrls();
    for (const resource of resources) release(resource, () => resource.dispose());
    for (const bitmap of bitmaps) release(bitmap, () => bitmap.close());
    resources.clear();
    bitmaps.clear();
  }

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    requireValid(urls.has(url), 'The glTF loader attempted to open a resource outside the selected files.');
    return url;
  });

  let textureFailure: unknown;
  function configureParser(parser: GLTFParser, binLength: number) {
    const doc: Document = parser.json;
    validateGeometry(doc, binLength);
    const buffers = doc.buffers ?? [];
    const images = doc.images ?? [];
    const bufferSources = buffers.map(({ uri }) => (uri === undefined ? undefined : resolveLocal(uri)));
    const imageSources = images.map(({ uri, bufferView }) => {
      requireValid((uri !== undefined) !== (bufferView !== undefined));
      if (bufferView !== undefined) at(doc.bufferViews ?? [], bufferView);
      return uri === undefined ? undefined : resolveLocal(uri);
    });

    const loadBuffer = parser.loadBuffer.bind(parser);
    parser.loadBuffer = async (index) => {
      localSignal.throwIfAborted();
      const source = bufferSources[index];
      const { byteLength } = at(buffers, index);
      if (source === undefined) {
        requireValid(index === 0 && binLength >= byteLength && binLength <= byteLength + 3 && binLength > 0);
        return loadBuffer(index);
      }
      const blob = await resourceBlob(source, localSignal);
      requireValid(blob.size >= byteLength);
      localSignal.throwIfAborted();
      return blob.slice(0, byteLength).arrayBuffer();
    };

    let imagePixels = 0;
    const preparedImages = new Map<number, Promise<ImageSource>>();
    async function prepareImage(index: number): Promise<ImageSource> {
      localSignal.throwIfAborted();
      const definition = at(images, index);
      const source = imageSources[index];
      let blob: Blob;
      if (source !== undefined) {
        blob = await resourceBlob(source, localSignal);
      } else {
        const bufferView = definition.bufferView!;
        requireValid(at(doc.bufferViews ?? [], bufferView).byteLength <= MAX_IMAGE_BYTES, imageLimit);
        const data: ArrayBuffer = await parser.getDependency('bufferView', bufferView);
        blob = new Blob([data]);
      }

      requireValid(blob.size <= MAX_IMAGE_BYTES, imageLimit);
      const dimensions = imageDimensions(await blob.arrayBuffer());
      requireValid(dimensions, 'glTF textures must use PNG, JPEG, or static WebP.');
      const [width, height, mimeType] = dimensions;
      imagePixels += width * height;
      requireValid(
        width > 0 &&
          height > 0 &&
          width <= 8192 &&
          height <= 8192 &&
          width * height <= MAX_IMAGE_PIXELS &&
          imagePixels <= MAX_TOTAL_IMAGE_PIXELS,
        imageLimit,
      );

      localSignal.throwIfAborted();
      const uri = URL.createObjectURL(blob.slice(0, blob.size, mimeType));
      urls.add(uri);
      return { ...definition, uri, mimeType, bufferView: undefined };
    }

    const loadImageSource = parser.loadImageSource.bind(parser);
    parser.loadImageSource = async (index, loader) => {
      if (!preparedImages.has(index)) preparedImages.set(index, prepareImage(index));
      const definition = at(images, index);
      try {
        const prepared = await preparedImages.get(index)!;
        localSignal.throwIfAborted();
        // Three captures the image definition synchronously before starting its decode.
        images[index] = prepared;
        let pending: Promise<THREE.Texture>;
        try {
          pending = loadImageSource(index, loader);
        } finally {
          images[index] = definition;
        }
        try {
          const texture = await pending;
          rememberTexture(texture);
          return texture;
        } catch (cause) {
          const uri = definition.uri;
          const path = uri && !/^data:/i.test(uri) ? uri : `#${index + 1}`;
          throw pathError('Could not decode the glTF image {path}.', path, cause);
        } finally {
          THREE.Cache.remove(`image-bitmap:${prepared.uri}`);
          THREE.Cache.remove(`image:${prepared.uri}`);
        }
      } catch (error) {
        // GLTFLoader may swallow a failed texture and return a material without it.
        textureFailure ??= error;
        throw error;
      }
    };

    const loadGeometries = parser.loadGeometries.bind(parser);
    parser.loadGeometries = async (primitives) => {
      const geometries = await loadGeometries(primitives);
      for (const geometry of geometries) remember(geometry);
      return geometries;
    };

    const assignFinalMaterial = parser.assignFinalMaterial.bind(parser);
    parser.assignFinalMaterial = (object) => {
      assignFinalMaterial(object);
      rememberObject(object);
    };

    return {
      name: 'LocalSceneResources',
      async beforeRoot() {
        for (const extension of doc.extensionsRequired ?? []) {
          requireValid(Object.hasOwn(parser.extensions, extension), 'The glTF file requires an unsupported extension.');
        }
      },
    };
  }

  let rejectAbort: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    controller.abort(signal?.reason);
    manager.abort();
    dispose();
    rejectAbort(localSignal.reason);
  };

  signal?.addEventListener('abort', onAbort, { once: true });
  const load = async (): Promise<LocalSceneAsset> => {
    const data = await file.arrayBuffer();
    localSignal.throwIfAborted();
    const binLength = checkContainer(data);
    const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
    loader.register((parser) => configureParser(parser, binLength));
    const gltf = await loader.parseAsync(data, '');
    for (const scene of gltf.scenes) rememberObject(scene);
    localSignal.throwIfAborted();
    if (textureFailure) throw textureFailure;
    return { root: gltf.scene, ...sceneStats(gltf.scene), dispose };
  };

  try {
    return await Promise.race([load(), aborted]);
  } catch (error) {
    controller.abort(error);
    manager.abort();
    dispose();
    if (signal?.aborted || error instanceof LocalSceneError) throw error;
    throw new LocalSceneError(invalid, error);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    releaseUrls();
  }
}
