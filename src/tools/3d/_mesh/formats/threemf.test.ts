import JSZip from 'jszip';
import { Box3, BufferAttribute, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { validateMeshModel, VIEWER_3MF_GEOMETRY_LIMITS } from '../validation';
import { parse3MF } from './threemf';

const coreNamespace = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const productionNamespace = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const rootPath = '3D/3dmodel.model';
const firstPart = '3D/Objects/first.model';
const secondPart = '3D/Objects/second.model';

function triangle(x: number): string {
  return `<object id="1" type="model">
    <mesh>
      <vertices>
        <vertex x="${x}" y="0" z="0" />
        <vertex x="${x + 1}" y="0" z="0" />
        <vertex x="${x}" y="1" z="0" />
      </vertices>
      <triangles><triangle v1="0" v2="1" v3="2" /></triangles>
    </mesh>
  </object>`;
}

function model(resources: string, build = '', attributes = ''): string {
  return `<model xmlns="${coreNamespace}" ${attributes}>
    <resources>${resources}</resources>
    ${build ? `<build>${build}</build>` : ''}
  </model>`;
}

async function archive(root: string, parts: Record<string, string> = {}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/${rootPath}" />
    </Relationships>`,
  );
  zip.file(rootPath, root);
  for (const [path, xml] of Object.entries(parts)) {
    zip.file(path, xml);
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

function repeatedAssembly(copiesPerAxis: number, facesPerTetrahedron = 4): Promise<ArrayBuffer> {
  // 128 tetrahedra give each mesh instance 512 vertices with a small XML resource.
  const vertices: string[] = [];
  const triangles: string[] = [];
  const faces = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ].slice(0, facesPerTetrahedron);
  for (let i = 0; i < 128; i++) {
    const x = i * 2;
    vertices.push(
      `<vertex x="${x}" y="0" z="0" />`,
      `<vertex x="${x + 1}" y="0" z="0" />`,
      `<vertex x="${x}" y="1" z="0" />`,
      `<vertex x="${x}" y="0" z="1" />`,
    );
    for (const [a, b, c] of faces) {
      triangles.push(`<triangle v1="${4 * i + a}" v2="${4 * i + b}" v3="${4 * i + c}" />`);
    }
  }

  const mesh = `<object id="1" type="model"><mesh>
    <vertices>${vertices.join('')}</vertices>
    <triangles>${triangles.join('')}</triangles>
  </mesh></object>`;
  const steps = [
    [256, 0, 0],
    [0, 2, 0],
    [0, 0, 3],
  ];
  const assemblies = steps.map((step, axis) => {
    const components = Array.from({ length: copiesPerAxis }, (_, copy) => {
      const translation = step.map((distance) => distance * copy).join(' ');
      return `<component objectid="${axis + 1}" transform="1 0 0 0 1 0 0 0 1 ${translation}" />`;
    });
    return `<object id="${axis + 2}" type="model"><components>${components.join('')}</components></object>`;
  });
  return archive(model(mesh + assemblies.join(''), '<item objectid="4" />'));
}

describe('parse3MF model XML', () => {
  it('rejects an empty build with unreferenced mesh resources', async () => {
    const root = model(triangle(0)).replace('</model>', '<build /></model>');
    await expect(parse3MF(await archive(root))).rejects.toThrow('no valid mesh geometry');
  });

  it('reads core-prefixed geometry and ignores foreign vertices and triangles', async () => {
    const root = `<c:model xmlns:c="${coreNamespace}" xmlns:ext="urn:mesh-extension">
      <c:resources>
        <c:object id="1" type="model">
          <c:mesh>
            <ext:vertices><ext:vertex x="99" y="99" z="99" /></ext:vertices>
            <c:vertices>
              <c:vertex x="&#50;" y="0" z="0" />
              <c:vertex x="3" y="0" z="0" />
              <c:vertex x="2" y="1" z="0" />
            </c:vertices>
            <c:triangles><c:triangle v1="0" v2="1" v3="2" /></c:triangles>
            <ext:triangles><ext:triangle v1="0" v2="2" v3="1" /></ext:triangles>
          </c:mesh>
        </c:object>
      </c:resources>
      <c:build><c:item objectid="1" /></c:build>
    </c:model>`;

    const mesh = await parse3MF(await archive(root));

    expect(Array.from(mesh.positions)).toEqual([2, 0, 0, 3, 0, 0, 2, 1, 0]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
  });

  it('reports the model path for malformed mesh XML', async () => {
    const root = model(triangle(0).replace('</vertices>', '</triangles>'), '<item objectid="1" />');

    await expect(parse3MF(await archive(root))).rejects.toThrow(`malformed XML in 3D model document "/${rootPath}"`);
  });
});

describe('parse3MF geometry limits', () => {
  it('rejects an assembly above the default triangle and vertex caps', async () => {
    await expect(parse3MF(await repeatedAssembly(14))).rejects.toThrow(/exceeds maximum allowed triangles/i);
  });

  it('preserves expanded counts and dimensions when importing the same assembly for viewing', async () => {
    const mesh = await parse3MF(await repeatedAssembly(14), 'assembly', VIEWER_3MF_GEOMETRY_LIMITS);

    validateMeshModel(mesh, VIEWER_3MF_GEOMETRY_LIMITS);
    expect(mesh.indices.length / 3).toBe(1_404_928);
    expect(mesh.positions.length / 3).toBe(1_404_928);
    const size = new Box3().setFromBufferAttribute(new BufferAttribute(mesh.positions, 3)).getSize(new Vector3());
    expect(size.toArray()).toEqual([3583, 27, 40]);
  });

  it('rejects more than four million vertices before allocating flattened positions', async () => {
    // Omitting one face per tetrahedron keeps 3,072,000 triangles and 4,096,000 vertices.
    const buffer = await repeatedAssembly(20, 3);
    vi.stubGlobal(
      'Float32Array',
      new Proxy(Float32Array, {
        construct(target, args) {
          if (args[0] === 4_096_000 * 3) {
            throw new Error('Allocated flattened positions before rejecting the assembly.');
          }
          return Reflect.construct(target, args);
        },
      }),
    );
    try {
      await expect(parse3MF(buffer, 'assembly', VIEWER_3MF_GEOMETRY_LIMITS)).rejects.toThrow(/exceeds maximum allowed vertices/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('parse3MF production extension', () => {
  it('composes mirrored components and build transforms across model parts with different units', async () => {
    const root = model(
      `${triangle(100)}
      <object id="2" type="model">
        <components>
          <component objectid="1" p:path="/${firstPart}" transform="-1 0 0 0 1 0 0 0 1 3 0 0" />
          <component objectid="1" p:path="/${secondPart}" />
        </components>
      </object>`,
      '<item objectid="2" transform="2 0 0 0 2 0 0 0 2 0 4 0" />',
      `unit="centimeter" xmlns:p="${productionNamespace}" requiredextensions="p"`,
    );
    const buffer = await archive(root, {
      [firstPart]: model(triangle(0), '', 'unit="centimeter"'),
      [secondPart]: model(triangle(10)),
    });

    const mesh = await parse3MF(buffer);

    expect(Array.from(mesh.positions)).toEqual([60, 40, 0, 40, 40, 0, 60, 60, 0, 20, 40, 0, 22, 40, 0, 20, 42, 0]);
    expect(Array.from(mesh.indices)).toEqual([0, 2, 1, 3, 4, 5]);
  });

  it.each(['p', 'prod'])('resolves build item paths using the production namespace prefix %s', async (prefix) => {
    const root = model(
      triangle(100),
      `<item objectid="1" ${prefix}:path="/${firstPart}" transform="1 0 0 0 1 0 0 0 1 0 0 5" />`,
      `xmlns:${prefix}="${productionNamespace}" requiredextensions="${prefix}"`,
    );
    const buffer = await archive(root, { [firstPart]: model(triangle(10)) });

    const mesh = await parse3MF(buffer);

    expect(Array.from(mesh.positions)).toEqual([10, 0, 5, 11, 0, 5, 10, 1, 5]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
  });

  it('rejects an unsupported required extension alongside production', async () => {
    const root = model(
      triangle(0),
      '<item objectid="1" />',
      `xmlns:p="${productionNamespace}" xmlns:unknown="urn:unsupported-extension" requiredextensions="p unknown"`,
    );

    await expect(parse3MF(await archive(root))).rejects.toThrow(/required extension.*unknown/i);
  });

  it.each(['component', 'build item'])('rejects a missing %s part when the object ID exists locally', async (reference) => {
    const target = `objectid="1" p:path="/${firstPart}"`;
    const resources =
      reference === 'component'
        ? `${triangle(100)}<object id="2"><components><component ${target} /></components></object>`
        : triangle(100);
    const build = reference === 'component' ? '<item objectid="2" />' : `<item ${target} />`;
    const root = model(resources, build, `xmlns:p="${productionNamespace}" requiredextensions="p"`);

    await expect(parse3MF(await archive(root))).rejects.toThrow(firstPart);
  });
});
