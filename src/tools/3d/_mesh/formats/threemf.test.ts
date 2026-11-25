import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
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

describe('parse3MF production extension', () => {
  it('loads components from their own model parts and composes transforms', async () => {
    const root = model(
      `${triangle(100)}
      <object id="2" type="model">
        <components>
          <component objectid="1" p:path="/${firstPart}" transform="1 0 0 0 1 0 0 0 1 3 0 0" />
          <component objectid="1" p:path="/${secondPart}" />
        </components>
      </object>`,
      '<item objectid="2" transform="2 0 0 0 2 0 0 0 2 0 4 0" />',
      `xmlns:p="${productionNamespace}" requiredextensions="p"`,
    );
    const buffer = await archive(root, {
      [firstPart]: model(triangle(0)),
      [secondPart]: model(triangle(10)),
    });

    const mesh = await parse3MF(buffer);

    expect(Array.from(mesh.positions)).toEqual([6, 4, 0, 8, 4, 0, 6, 6, 0, 20, 4, 0, 22, 4, 0, 20, 6, 0]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 3, 4, 5]);
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
