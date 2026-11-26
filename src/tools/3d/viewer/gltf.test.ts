import { describe, expect, it, vi } from 'vitest';
import { loadLocalScene } from './gltf';

const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 3, 0]);

function document(uri?: string, positionOffset = 0) {
  const byteLength = positions.byteLength + positionOffset;
  return {
    asset: { version: '2.0' },
    buffers: [{ uri, byteLength }],
    bufferViews: [{ buffer: 0, byteLength }],
    accessors: [
      {
        bufferView: 0,
        byteOffset: positionOffset,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [2, 3, 0],
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [
      { name: 'Parent', children: [1], translation: [1, 2, 3] },
      { mesh: 0, scale: [1, 2, 1] },
    ],
    scenes: [{ nodes: [0] }],
  };
}

function gltf(uri: string, extra = {}) {
  return new File([JSON.stringify({ ...document(uri), ...extra })], 'model.gltf');
}

function relativeFile(file: File, path: string) {
  return Object.defineProperty(file, 'webkitRelativePath', { value: path });
}

function glb(doc: object = document(), bin = positions) {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const jsonSize = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(28 + jsonSize + bin.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonSize, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonSize);
  bytes.set(json, 20);
  view.setUint32(20 + jsonSize, bin.byteLength, true);
  view.setUint32(24 + jsonSize, 0x004e4942, true);
  bytes.set(new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength), 28 + jsonSize);
  return new File([bytes], 'model.glb');
}

describe('loadLocalScene', () => {
  it('loads GLB geometry with its source-space hierarchy and transforms', async () => {
    const asset = await loadLocalScene(glb(), []);
    try {
      expect(asset).toMatchObject({ vertices: 3, triangles: 1, meshes: 1, dimensions: [2, 6, 0] });
      expect(asset.root.children[0]).toMatchObject({ name: 'Parent', position: { x: 1, y: 2, z: 3 } });
      expect(asset.root.children[0].children).toHaveLength(1);
    } finally {
      asset.dispose();
    }
  });

  it('rejects a required extension when Three would only render the fallback geometry', async () => {
    const extensions = ['VENDOR_geometry_transform'];
    const file = glb({ ...document(), extensionsUsed: extensions, extensionsRequired: extensions });
    await expect(loadLocalScene(file, [])).rejects.toThrow('requires an unsupported extension');
  });

  it('resolves a nested companion path and reads a packed accessor at a component-aligned offset', async () => {
    const uri = '../buffers/mesh%20data.bin';
    const file = relativeFile(new File([JSON.stringify(document(uri, 4))], 'model.gltf'), 'pack/scene/model.gltf');
    const selected = relativeFile(new File([new Uint8Array(4), positions], 'mesh data.bin'), 'pack/buffers/mesh data.bin');
    const other = relativeFile(new File([], 'mesh data.bin'), 'other/buffers/mesh data.bin');
    const asset = await loadLocalScene(file, [other, selected]);
    try {
      expect(asset.dimensions).toEqual([2, 6, 0]);
    } finally {
      asset.dispose();
    }
  });

  it('accepts a data buffer and rejects multiple flat matches for a nested resource', async () => {
    const data = new Uint8Array(positions.buffer);
    const uri = `data:application/octet-stream;base64,${btoa(String.fromCharCode(...data))}`;
    const asset = await loadLocalScene(gltf(uri), []);
    asset.dispose();
    const matches = [new File([positions], 'mesh.bin'), new File([positions], 'mesh.bin')];
    await expect(loadLocalScene(gltf('buffers/mesh.bin'), matches)).rejects.toMatchObject({
      message: 'Multiple selected files match the glTF resource {path}.',
      params: { path: 'buffers/mesh.bin' },
    });
  });

  it('rejects missing textures and remote or authored blob URLs', async () => {
    const buffer = new File([positions], 'mesh.bin');
    await expect(loadLocalScene(gltf('mesh.bin', { images: [{ uri: 'textures/albedo.png' }] }), [buffer])).rejects.toMatchObject({
      message: 'Choose the local glTF resource {path} and try again.',
      params: { path: 'textures/albedo.png' },
    });
    for (const uri of ['https://example.com/mesh.bin', '//example.com/mesh.bin', 'blob:https://example.com/id']) {
      await expect(loadLocalScene(gltf(uri), [buffer])).rejects.toMatchObject({
        message: 'The glTF resource {path} must be a relative local path.',
        params: { path: uri },
      });
    }
  });

  it('rejects an unreadable texture even if Three supplies an untextured material', async () => {
    const file = gltf('mesh.bin', {
      images: [{ uri: 'texture.png' }],
      textures: [{ source: 0 }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    });
    const companions = [new File([positions], 'mesh.bin'), new File(['invalid'], 'texture.png')];
    await expect(loadLocalScene(file, companions)).rejects.toThrow('glTF textures must use PNG, JPEG, or static WebP.');
  });

  it('passes a validated embedded image to Three and closes its decoded bitmap on disposal', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ZkAAAAASUVORK5CYII=';
    const close = vi.fn();
    class TestBitmap {
      width = 1;
      height = 1;
      close = close;
    }
    const decode = vi.fn(async (blob: Blob) => {
      expect(blob.type).toBe('image/png');
      return new TestBitmap();
    });
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('ImageBitmap', TestBitmap);
    vi.stubGlobal('createImageBitmap', decode);
    const file = gltf('mesh.bin', {
      images: [{ uri: `data:image/png;base64,${png}` }],
      textures: [{ source: 0 }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    });
    try {
      const asset = await loadLocalScene(file, [new File([positions], 'mesh.bin')]);
      expect(asset.textures).toBe(1);
      expect(decode).toHaveBeenCalledOnce();
      asset.dispose();
      asset.dispose();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('counts drawn instances and excludes point primitives from the triangle total', async () => {
    const bin = new Float32Array([...positions, 0, 0, 0, 5, 0, 0]);
    const base = document();
    const doc = {
      ...base,
      buffers: [{ uri: undefined, byteLength: bin.byteLength }],
      bufferViews: [...base.bufferViews, { buffer: 0, byteLength: 24, byteOffset: 36 }],
      accessors: [
        ...base.accessors,
        { bufferView: 1, byteOffset: 0, componentType: 5126, count: 2, type: 'VEC3', min: [0, 0, 0], max: [5, 0, 0] },
      ],
      meshes: [...base.meshes, { primitives: [{ attributes: { POSITION: 0 }, mode: 0 }] }],
      nodes: [
        { children: [2], scale: [2, 2, 1] },
        { mesh: 1 },
        {
          mesh: 0,
          translation: [1, 0, 0],
          extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 1 } } },
        },
      ],
      scenes: [{ nodes: [0, 1] }],
      extensionsUsed: ['EXT_mesh_gpu_instancing'],
    };
    const asset = await loadLocalScene(glb(doc, bin), []);
    try {
      expect(asset).toMatchObject({ vertices: 9, triangles: 2, meshes: 2, dimensions: [16, 6, 0] });
    } finally {
      asset.dispose();
    }
  });
});
