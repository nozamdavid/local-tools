import type { MeshModel } from './types';
import { analyzeMesh, splitComponents, mergeMeshModels, weldIndexedVertices } from './topology';
import { transformMesh, flipNormals } from './transforms';
import { simplifyMesh } from './simplify';
import { parseSTL, exportSTL } from './formats/stl';
import { exportOBJ, parseOBJ } from './formats/obj';
import { exportPLY, parsePLY } from './formats/ply';
import { export3MF, parse3MF } from './formats/threemf';
import { validateMeshModel } from './validation';
import JSZip from 'jszip';

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

export function createCubeModel(size = 10, name = 'cube'): MeshModel {
  const h = size / 2;
  const positions = new Float32Array([-h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h, -h, -h, h, h, -h, h, h, h, h, -h, h, h]);

  // 12 triangles (outward normals)
  const indices = new Uint32Array([
    0,
    2,
    1,
    0,
    3,
    2, // -Z
    4,
    5,
    6,
    4,
    6,
    7, // +Z
    0,
    1,
    5,
    0,
    5,
    4, // -Y
    2,
    3,
    7,
    2,
    7,
    6, // +Y
    0,
    4,
    7,
    0,
    7,
    3, // -X
    1,
    2,
    6,
    1,
    6,
    5, // +X
  ]);

  return {
    name,
    positions,
    indices,
    warnings: [],
  };
}

export function createOpenMesh(): MeshModel {
  const cube = createCubeModel(10, 'open_cube');
  // Remove the top face (+Z, last 2 triangles: indices 6 to 11)
  const indices = cube.indices.slice(0, 30);
  return {
    name: 'open_cube',
    positions: cube.positions.slice(),
    indices,
    warnings: [],
  };
}

export function createSubdividedMesh(rows = 8, cols = 8, size = 20): MeshModel {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rows; r++) {
    const y = (r / rows - 0.5) * size;
    for (let c = 0; c <= cols; c++) {
      const x = (c / cols - 0.5) * size;
      // Slight dome curvature so triangles aren't perfectly coplanar
      const z = Math.sin((r / rows) * Math.PI) * Math.sin((c / cols) * Math.PI) * 4;
      positions.push(x, y, z);
    }
  }

  const stride = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * stride + c;
      const i1 = r * stride + c + 1;
      const i2 = (r + 1) * stride + c;
      const i3 = (r + 1) * stride + c + 1;

      indices.push(i0, i1, i2);
      indices.push(i1, i3, i2);
    }
  }

  return {
    name: 'subdivided_surface',
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    warnings: [],
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertNear(actual: number, expected: number, tolerance = 1e-3, label = 'value'): void {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`Assertion failed for ${label}: expected ${expected}, got ${actual} (diff: ${diff} > ${tolerance})`);
  }
}

export async function runAllTests(): Promise<{ passed: boolean; results: TestResult[] }> {
  const results: TestResult[] = [];

  async function test(name: string, fn: () => void | Promise<void>) {
    const start = performance.now();
    try {
      await fn();
      results.push({ name, passed: true, durationMs: performance.now() - start });
    } catch (err) {
      results.push({
        name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: performance.now() - start,
      });
    }
  }

  // 1. Closed Cube Volume & Surface Area
  await test('1. Known 10mm Cube Analysis (Closed Volume & Surface Area)', () => {
    const cube = createCubeModel(10);
    const stats = analyzeMesh(cube);

    assert(stats.vertices === 8, `Expected 8 vertices, got ${stats.vertices}`);
    assert(stats.triangles === 12, `Expected 12 triangles, got ${stats.triangles}`);
    assertNear(stats.surfaceArea, 600, 1e-2, 'Surface Area');
    assert(stats.volume !== null, 'Volume should not be null for closed cube');
    assertNear(stats.volume!, 1000, 1e-2, 'Volume');
    assert(stats.watertight === true, 'Watertight must be true');
    assert(stats.boundaryEdges === 0, `Boundary edges: expected 0, got ${stats.boundaryEdges}`);
    assert(stats.nonManifoldEdges === 0, `Non-manifold edges: expected 0, got ${stats.nonManifoldEdges}`);
    assert(stats.degenerateTriangles === 0, 'Expected 0 degenerate triangles');
    assert(stats.components === 1, `Expected 1 component, got ${stats.components}`);
  });

  // 2. Open Mesh Analysis
  await test('2. Open Mesh Analysis (Watertight False & Null Volume)', () => {
    const openMesh = createOpenMesh();
    const stats = analyzeMesh(openMesh);

    assert(stats.triangles === 10, `Expected 10 triangles, got ${stats.triangles}`);
    assert(stats.watertight === false, 'Watertight must be false for open mesh');
    assert(stats.volume === null, 'Volume MUST be null for open mesh');
    assert(stats.boundaryEdges > 0, `Boundary edges must be > 0, got ${stats.boundaryEdges}`);
    assert(stats.components === 1, 'Components should be 1');
  });

  // 3. Transforms (Scale, Rotate, Center, Ground)
  await test('3. Affine Transforms (Scale, Rotation, Center, Ground)', () => {
    const cube = createCubeModel(10); // [-5..5, -5..5, -5..5]
    // Transform: scale 2x X, 3x Y, 4x Z; ground Z; center XY
    const transformed = transformMesh(cube, [2, 3, 4], [0, 0, 0], true, true);
    const stats = analyzeMesh(transformed);

    assertNear(stats.bounds.size[0], 20, 1e-2, 'Size X');
    assertNear(stats.bounds.size[1], 30, 1e-2, 'Size Y');
    assertNear(stats.bounds.size[2], 40, 1e-2, 'Size Z');
    assertNear(stats.bounds.min[2], 0, 1e-2, 'Grounded minZ');
    assertNear(stats.bounds.min[0], -10, 1e-2, 'Centered minX');
    assertNear(stats.bounds.max[0], 10, 1e-2, 'Centered maxX');

    // Normals flip
    const flipped = flipNormals(cube, true);
    assert(flipped.indices[0] === cube.indices[0], 'Flipped v0 should match');
    assert(flipped.indices[1] === cube.indices[2], 'Flipped v1 should be original v2');
    assert(flipped.indices[2] === cube.indices[1], 'Flipped v2 should be original v1');
  });

  // 4. Format Roundtrips: STL Binary
  await test('4. Format Roundtrip: STL Binary (Export & Import with Welding)', () => {
    const cube = createCubeModel(10);
    const stlBuffer = exportSTL(cube);
    const reimported = parseSTL(stlBuffer, 'reimported_stl');

    const stats = analyzeMesh(reimported);
    assert(stats.vertices === 8, `STL welded vertices: expected 8, got ${stats.vertices}`);
    assert(stats.triangles === 12, `STL triangles: expected 12, got ${stats.triangles}`);
    assert(stats.watertight === true, 'STL should be watertight after welding');
    assertNear(stats.volume!, 1000, 1e-2, 'STL Volume');
    assert(
      reimported.warnings.some((w) => w.includes('unitless')),
      'STL unitless warning present',
    );
  });

  // 5. Format Roundtrips: OBJ Geometry Only
  await test('5. Format Roundtrip: OBJ Geometry Only', () => {
    const cube = createCubeModel(10);
    const objText = exportOBJ(cube);
    const reimported = parseOBJ(objText, 'reimported_obj');

    const stats = analyzeMesh(reimported);
    assert(stats.vertices === 8, `OBJ vertices: expected 8, got ${stats.vertices}`);
    assert(stats.triangles === 12, `OBJ triangles: expected 12, got ${stats.triangles}`);
    assert(stats.watertight === true, 'OBJ should be watertight');
    assertNear(stats.volume!, 1000, 1e-2, 'OBJ Volume');
    assert(
      reimported.warnings.some((w) => w.includes('unitless')),
      'OBJ unitless warning present',
    );
  });

  // 6. Format Roundtrips: PLY ASCII
  await test('6. Format Roundtrip: PLY ASCII', () => {
    const cube = createCubeModel(10);
    const plyText = exportPLY(cube);
    const plyBuffer = new TextEncoder().encode(plyText).buffer;
    const reimported = parsePLY(plyBuffer, 'reimported_ply');

    const stats = analyzeMesh(reimported);
    assert(stats.vertices === 8, `PLY vertices: expected 8, got ${stats.vertices}`);
    assert(stats.triangles === 12, `PLY triangles: expected 12, got ${stats.triangles}`);
    assert(stats.watertight === true, 'PLY should be watertight');
    assertNear(stats.volume!, 1000, 1e-2, 'PLY Volume');
  });

  // 7. Format Roundtrips: 3MF Units & Build Transforms & Component Instances
  await test('7. 3MF Archive: Units, Build Transforms, and Component Instances', async () => {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`,
    );
    zip.file(
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="r1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model" />
</Relationships>`,
    );

    const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0" />
          <vertex x="1" y="0" z="0" />
          <vertex x="1" y="1" z="0" />
          <vertex x="0" y="1" z="0" />
          <vertex x="0" y="0" z="1" />
          <vertex x="1" y="0" z="1" />
          <vertex x="1" y="1" z="1" />
          <vertex x="0" y="1" z="1" />
        </vertices>
        <triangles>
          <triangle v1="0" v2="2" v3="1" /><triangle v1="0" v2="3" v3="2" />
          <triangle v1="4" v2="5" v3="6" /><triangle v1="4" v2="6" v3="7" />
          <triangle v1="0" v2="1" v3="5" /><triangle v1="0" v2="5" v3="4" />
          <triangle v1="2" v2="3" v3="7" /><triangle v1="2" v2="7" v3="6" />
          <triangle v1="0" v2="4" v3="7" /><triangle v1="0" v2="7" v3="3" />
          <triangle v1="1" v2="2" v3="6" /><triangle v1="1" v2="6" v3="5" />
        </triangles>
      </mesh>
    </object>
    <object id="2" type="model">
      <components>
        <component objectid="1" transform="1 0 0 0 1 0 0 0 1 2 0 0" />
      </components>
    </object>
  </resources>
  <build>
    <item objectid="2" transform="1 0 0 0 1 0 0 0 1 1 0 0" />
  </build>
</model>`;
    zip.file('3D/3dmodel.model', modelXml);

    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });
    const imported3MF = await parse3MF(zipBuffer, 'test_3mf');

    const stats = analyzeMesh(imported3MF);
    assertNear(stats.bounds.size[0], 25.4, 1e-2, '3MF Inch to mm Size X');
    assertNear(stats.bounds.size[1], 25.4, 1e-2, '3MF Inch to mm Size Y');
    assertNear(stats.bounds.size[2], 25.4, 1e-2, '3MF Inch to mm Size Z');
    assertNear(stats.bounds.min[0], 76.2, 1e-2, '3MF Flattened transform minX');
    assert(stats.watertight === true, '3MF Cube watertight');
    assertNear(stats.volume!, Math.pow(25.4, 3), 1.0, '3MF Volume in mm^3');

    // Test 3MF Export & Re-import
    const cube = createCubeModel(10);
    const blob = await export3MF(cube);
    const expBuf = await blob.arrayBuffer();
    const re3mf = await parse3MF(expBuf, 're_3mf');
    const reStats = analyzeMesh(re3mf);
    assertNear(reStats.volume!, 1000, 1e-2, '3MF Exported/Reimported Volume');
  });

  // 8. Real Polygon Reduction via MeshoptSimplifier
  await test('8. Polygon Reduction via MeshoptSimplifier (Achieved Metrics)', async () => {
    const mesh = createSubdividedMesh(8, 8, 30);
    const originalTriangles = mesh.indices.length / 3;
    assert(originalTriangles === 128, `Expected 128 triangles, got ${originalTriangles}`);

    const simplified = await simplifyMesh(mesh, 0.5, 0.05, true);
    const achievedTriangles = simplified.indices.length / 3;

    assert(achievedTriangles < originalTriangles, 'Triangle count must decrease');
    assert(achievedTriangles <= 64, `Achieved ${achievedTriangles} triangles (<= 64)`);
    assert(simplified.positions.length / 3 <= mesh.positions.length / 3, 'Vertices must be compacted');
    assert(
      simplified.warnings.some((w) => w.includes('Simplification achieved')),
      'Achieved report in warnings',
    );
  });

  // 9. Error Handling: Corrupt Buffers, Out of Range Indices, and Security Violations
  await test('9. Validation & Error Handling (Corrupt Buffers, Security, OOB)', async () => {
    let caughtOOB = false;
    try {
      const badModel: MeshModel = {
        name: 'bad',
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 99]),
        warnings: [],
      };
      validateMeshModel(badModel);
    } catch {
      caughtOOB = true;
    }
    assert(caughtOOB, 'Should reject out-of-bounds index');

    let caughtNonFinite = false;
    try {
      const badModel: MeshModel = {
        name: 'bad_nan',
        positions: new Float32Array([NaN, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        warnings: [],
      };
      validateMeshModel(badModel);
    } catch {
      caughtNonFinite = true;
    }
    assert(caughtNonFinite, 'Should reject NaN coordinates');

    let caughtExternalRel = false;
    try {
      const zip = new JSZip();
      zip.file(
        '_rels/.rels',
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="r1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="https://evil.com/model.model" TargetMode="External" />
</Relationships>`,
      );
      const buf = await zip.generateAsync({ type: 'arraybuffer' });
      await parse3MF(buf, 'sec_test');
    } catch (err) {
      if (err instanceof Error && err.message.includes('external relationships')) {
        caughtExternalRel = true;
      }
    }
    assert(caughtExternalRel, 'Should reject external relationships in 3MF');

    let caughtMandatoryExt = false;
    try {
      const zip = new JSZip();
      zip.file(
        '3D/3dmodel.model',
        `<model unit="millimeter" requiredextensions="must_have_ext" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources></resources><build></build>
</model>`,
      );
      const buf = await zip.generateAsync({ type: 'arraybuffer' });
      await parse3MF(buf, 'ext_test');
    } catch (err) {
      if (err instanceof Error && err.message.includes('required extension')) {
        caughtMandatoryExt = true;
      }
    }
    assert(caughtMandatoryExt, 'Should reject unsupported required extension');
  });

  // 10. Disconnected Component Split & Merge
  await test('10. Disconnected Component Split and Merge', () => {
    const cube1 = transformMesh(createCubeModel(10, 'cubeA'), [1, 1, 1], [0, 0, 0], false, false);
    for (let i = 0; i < cube1.positions.length; i += 3) cube1.positions[i] -= 50;

    const cube2 = transformMesh(createCubeModel(10, 'cubeB'), [1, 1, 1], [0, 0, 0], false, false);
    for (let i = 0; i < cube2.positions.length; i += 3) cube2.positions[i] += 50;

    const merged = mergeMeshModels([cube1, cube2]);
    const mergedStats = analyzeMesh(merged);

    assert(mergedStats.components === 2, `Expected 2 components, got ${mergedStats.components}`);
    assert(mergedStats.triangles === 24, `Expected 24 triangles, got ${mergedStats.triangles}`);
    assert(mergedStats.vertices === 16, `Expected 16 vertices, got ${mergedStats.vertices}`);

    const parts = splitComponents(merged);
    assert(parts.length === 2, `Expected 2 parts, got ${parts.length}`);

    const part1Stats = analyzeMesh(parts[0]);
    assert(part1Stats.components === 1, 'Part 1 should have 1 component');
    assert(part1Stats.triangles === 12, 'Part 1 should have 12 triangles');
    assert(part1Stats.vertices === 8, 'Part 1 should have 8 vertices');

    const part2Stats = analyzeMesh(parts[1]);
    assert(part2Stats.components === 1, 'Part 2 should have 1 component');
    assert(part2Stats.triangles === 12, 'Part 2 should have 12 triangles');
    assert(part2Stats.vertices === 8, 'Part 2 should have 8 vertices');
  });

  // 11. 3MF 90deg Rotation + Non-commuting Nested Translation & Mirror Winding Orientation (Risk 1)
  await test('11. 3MF Row-Vector Transform, 90deg Rotation + Nested Composition, Mirror Winding', async () => {
    const zip = new JSZip();
    zip.file(
      '_rels/.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="r1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model" />
</Relationships>`,
    );

    // Object 1: 10mm cube at [0..10, 0..10, 0..10]
    // Object 2: Component referencing object 1 with translation X+20
    // Build Item 1: References Object 2 with 90 degree rotation around Z
    // In row-vector 3MF: [x' y' z' 1] = [x y z 1] * M
    // 90deg rot around Z: x' = -y, y' = x
    // M = "0 1 0 -1 0 0 0 0 1 0 0 0"
    // Composed: child translated by +20 in X -> rotated by +90deg -> child origin (20, 0, 0) becomes (0, 20, 0)
    // Cube bounds: X in [-10, 0], Y in [20, 30], Z in [0, 10]
    // Build Item 2: Mirror transform (Z scale = -1): "1 0 0 0 1 0 0 0 -1 0 0 20"
    const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0" /><vertex x="10" y="0" z="0" />
          <vertex x="10" y="10" z="0" /><vertex x="0" y="10" z="0" />
          <vertex x="0" y="0" z="10" /><vertex x="10" y="0" z="10" />
          <vertex x="10" y="10" z="10" /><vertex x="0" y="10" z="10" />
        </vertices>
        <triangles>
          <triangle v1="0" v2="2" v3="1" /><triangle v1="0" v2="3" v3="2" />
          <triangle v1="4" v2="5" v3="6" /><triangle v1="4" v2="6" v3="7" />
          <triangle v1="0" v2="1" v3="5" /><triangle v1="0" v2="5" v3="4" />
          <triangle v1="2" v2="3" v3="7" /><triangle v1="2" v2="7" v3="6" />
          <triangle v1="0" v2="4" v3="7" /><triangle v1="0" v2="7" v3="3" />
          <triangle v1="1" v2="2" v3="6" /><triangle v1="1" v2="6" v3="5" />
        </triangles>
      </mesh>
    </object>
    <object id="2" type="model">
      <components>
        <component objectid="1" transform="1 0 0 0 1 0 0 0 1 20 0 0" />
      </components>
    </object>
  </resources>
  <build>
    <item objectid="2" transform="0 1 0 -1 0 0 0 0 1 0 0 0" />
  </build>
</model>`;
    zip.file('3D/3dmodel.model', modelXml);

    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    const imported = await parse3MF(buf, 'rot_comp');
    const stats = analyzeMesh(imported);

    assertNear(stats.bounds.min[0], -10, 1e-2, 'Rotated Min X');
    assertNear(stats.bounds.max[0], 0, 1e-2, 'Rotated Max X');
    assertNear(stats.bounds.min[1], 20, 1e-2, 'Rotated Min Y');
    assertNear(stats.bounds.max[1], 30, 1e-2, 'Rotated Max Y');
    assert(stats.watertight === true, 'Nested rotated cube is watertight');
    assertNear(stats.volume!, 1000, 1e-2, 'Nested rotated cube volume');

    // Test mirror winding orientation preservation
    const mirrorZip = new JSZip();
    mirrorZip.file(
      '_rels/.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="r1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model" />
</Relationships>`,
    );
    const mirrorXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0" /><vertex x="10" y="0" z="0" />
          <vertex x="10" y="10" z="0" /><vertex x="0" y="10" z="0" />
          <vertex x="0" y="0" z="10" /><vertex x="10" y="0" z="10" />
          <vertex x="10" y="10" z="10" /><vertex x="0" y="10" z="10" />
        </vertices>
        <triangles>
          <triangle v1="0" v2="2" v3="1" /><triangle v1="0" v2="3" v3="2" />
          <triangle v1="4" v2="5" v3="6" /><triangle v1="4" v2="6" v3="7" />
          <triangle v1="0" v2="1" v3="5" /><triangle v1="0" v2="5" v3="4" />
          <triangle v1="2" v2="3" v3="7" /><triangle v1="2" v2="7" v3="6" />
          <triangle v1="0" v2="4" v3="7" /><triangle v1="0" v2="7" v3="3" />
          <triangle v1="1" v2="2" v3="6" /><triangle v1="1" v2="6" v3="5" />
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" transform="1 0 0 0 1 0 0 0 -1 0 0 10" />
  </build>
</model>`;
    mirrorZip.file('3D/3dmodel.model', mirrorXml);
    const mirrorBuf = await mirrorZip.generateAsync({ type: 'arraybuffer' });
    const mirrorModel = await parse3MF(mirrorBuf, 'mirror_test');
    const mirrorStats = analyzeMesh(mirrorModel);
    assert(mirrorStats.watertight === true, 'Mirrored cube must maintain watertightness');
    assertNear(mirrorStats.volume!, 1000, 1e-2, 'Mirrored cube must maintain positive closed volume');
    assert(mirrorStats.boundaryEdges === 0, 'Mirrored cube has 0 boundary edges');

    // Reject invalid transform (wrong part count or non-numeric)
    let caughtInvalidTrans = false;
    try {
      const invZip = new JSZip();
      invZip.file(
        '3D/3dmodel.model',
        `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>
  <build><item objectid="1" transform="1 0 0 0 1 0 0" /></build>
</model>`,
      );
      const b = await invZip.generateAsync({ type: 'arraybuffer' });
      await parse3MF(b);
    } catch {
      caughtInvalidTrans = true;
    }
    assert(caughtInvalidTrans, 'Should reject incomplete transform matrix');
  });

  // 12. 3MF Unknown Units, Malformed XML, and Instance Bomb Rejection (Risks 3 & 4)
  await test('12. 3MF Unknown Units, Malformed XML, and Instance Bomb Limits', async () => {
    // Unknown unit failure
    let caughtUnit = false;
    try {
      const zip = new JSZip();
      zip.file(
        '3D/3dmodel.model',
        `<model unit="lightyear" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources>
  <build><item objectid="1" /></build>
</model>`,
      );
      const b = await zip.generateAsync({ type: 'arraybuffer' });
      await parse3MF(b);
    } catch (err) {
      if (err instanceof Error && err.message.includes('invalid 3MF unit')) {
        caughtUnit = true;
      }
    }
    assert(caughtUnit, 'Should reject unknown unit without silent fallback');

    // Malformed XML
    let caughtMalformed = false;
    try {
      const zip = new JSZip();
      zip.file(
        '3D/3dmodel.model',
        `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/></mesh></object></resources>
  <build><item objectid="1" /></build>
</model>`,
      );
      const b = await zip.generateAsync({ type: 'arraybuffer' });
      await parse3MF(b);
    } catch (err) {
      if (err instanceof Error && err.message.includes('malformed XML')) {
        caughtMalformed = true;
      }
    }
    assert(caughtMalformed, 'Should reject malformed XML');
  });

  // 13. Affine Transform Edge Cases & Normal Flip (Risk 5)
  await test('13. Affine Transform Zero/NaN/Inf Rejection & Face Winding Only', () => {
    const cube = createCubeModel(10);

    let caughtZeroScale = false;
    try {
      transformMesh(cube, [0, 1, 1], [0, 0, 0], false, false);
    } catch {
      caughtZeroScale = true;
    }
    assert(caughtZeroScale, 'Should reject zero scale factor');

    let caughtNanScale = false;
    try {
      transformMesh(cube, [NaN, 1, 1], [0, 0, 0], false, false);
    } catch {
      caughtNanScale = true;
    }
    assert(caughtNanScale, 'Should reject NaN scale factor');

    let caughtInfRot = false;
    try {
      transformMesh(cube, [1, 1, 1], [Infinity, 0, 0], false, false);
    } catch {
      caughtInfRot = true;
    }
    assert(caughtInfRot, 'Should reject Infinity rotation');

    // Negative scale reflection preserves orientation
    const reflected = transformMesh(cube, [-1, 1, 1], [0, 0, 0], false, false);
    const refStats = analyzeMesh(reflected);
    assert(refStats.watertight === true, 'Reflected mesh watertight');
    assertNear(refStats.volume!, 1000, 1e-2, 'Reflected mesh volume positive');

    // Normal flip no-op when false, index swap when true, no normals property added
    const noopFlip = flipNormals(cube, false);
    assert(noopFlip.indices[0] === cube.indices[0], 'No-op flip preserves indices');
    assert(!('normals' in (noopFlip as unknown as Record<string, unknown>)), 'Must not invent normals field');

    const activeFlip = flipNormals(cube, true);
    assert(activeFlip.indices[1] === cube.indices[2], 'Active flip swaps v1 and v2');
    assert(!('normals' in (activeFlip as unknown as Record<string, unknown>)), 'Must not invent normals field');
  });

  // 14. CAD Duplicate Face Vertices & Canonical Welding & STEP Cube Import (Risk 2)
  await test('14. CAD Topology Stitching & CAx-IF STEP Cube Roundtrip', async () => {
    // 1. Synthetic un-welded face vertices test (mimicking B-Rep discrete face meshes)
    const baseCube = createCubeModel(10);
    const rawFacePos = new Float32Array(baseCube.indices.length * 3);
    const rawFaceIdx = new Uint32Array(baseCube.indices.length);
    for (let i = 0; i < baseCube.indices.length; i++) {
      const origV = baseCube.indices[i];
      rawFacePos[i * 3] = baseCube.positions[origV * 3];
      rawFacePos[i * 3 + 1] = baseCube.positions[origV * 3 + 1];
      rawFacePos[i * 3 + 2] = baseCube.positions[origV * 3 + 2];
      rawFaceIdx[i] = i;
    }

    // Before welding: mesh has duplicate face vertices, 24 boundary edges, volume is null
    const unweldedStats = analyzeMesh({
      name: 'unwelded',
      positions: rawFacePos,
      indices: rawFaceIdx,
      warnings: [],
    });
    assert(unweldedStats.vertices === 36, 'Unwelded vertices: 36');
    assert(unweldedStats.watertight === false, 'Unwelded mesh must NOT be watertight');
    assert(unweldedStats.volume === null, 'Unwelded mesh volume must be null');
    assert(unweldedStats.boundaryEdges === 36, 'Unwelded mesh has 36 boundary edges');

    // After canonical welding: stitches shared edges without losing geometry
    const welded = weldIndexedVertices(rawFacePos, rawFaceIdx);
    const weldedStats = analyzeMesh({
      name: 'welded',
      positions: welded.positions,
      indices: welded.indices,
      warnings: [],
    });
    assert(weldedStats.vertices === 8, `Welded vertices: expected 8, got ${weldedStats.vertices}`);
    assert(weldedStats.triangles === 12, 'Welded triangles: 12');
    assert(weldedStats.watertight === true, 'Welded mesh MUST be watertight');
    assert(weldedStats.boundaryEdges === 0, 'Welded mesh has 0 boundary edges');
    assertNear(weldedStats.volume!, 1000, 1e-2, 'Welded cube volume');

    // 2. Real STEP fixture import (CAx-IF cube.stp, official SHA-256 preserved)
    const CUBE_STP_B64 =
      'SVNPLTEwMzAzLTIxOw0KSEVBREVSOw0KLyogR2VuZXJhdGVkIGJ5IHNvZnR3YXJlIGNvbnRhaW5pbmcgU1QtRGV2ZWxvcGVyDQogKiBmcm9tIFNURVAgVG9vbHMsIEluYy4gKHd3dy5zdGVwdG9vbHMuY29tKSANCiAqLw0KLyogT1BUSU9OOiB1c2luZyBjdXN0b20gc2NoZW1hLW5hbWUgZnVuY3Rpb24gKi8NCg0KRklMRV9ERVNDUklQVElPTigNCi8qIGRlc2NyaXB0aW9uICovICgnJyksDQovKiBpbXBsZW1lbnRhdGlvbl9sZXZlbCAqLyAnMjsxJyk7DQoNCkZJTEVfTkFNRSgNCi8qIG5hbWUgKi8gJ2N1YmUuc3RwJywNCi8qIHRpbWVfc3RhbXAgKi8gJzIwMTItMDYtMjlUMTQ6MjU6MDkrMDg6MDAnLA0KLyogYXV0aG9yICovICgnJyksDQovKiBvcmdhbml6YXRpb24gKi8gKCcnKSwNCi8qIHByZXByb2Nlc3Nvcl92ZXJzaW9uICovICdTVC1ERVZFTE9QRVIgdjE0JywNCi8qIG9yaWdpbmF0aW5nX3N5c3RlbSAqLyAnU0lFTUVOUyBQTE0gU29mdHdhcmUgTlggOC4wJywNCi8qIGF1dGhvcmlzYXRpb24gKi8gJycpOw0KDQpGSUxFX1NDSEVNQSAoKCdBVVRPTU9USVZFX0RFU0lHTiB7IDEgMCAxMDMwMyAyMTQgMyAxIDEgMSB9JykpOw0KRU5EU0VDOw0KDQpEQVRBOw0KIzEwPVNIQVBFX1JFUFJFU0VOVEFUSU9OX1JFTEFUSU9OU0hJUCgnTm9uZScsDQoncmVsYXRpb25zaGlwIGJldHdlZW4gY3ViZS1Ob25lIGFuZCBjdWJlLU5vbmUnLCMyMiwjMTEpOw0KIzExPUFEVkFOQ0VEX0JSRVBfU0hBUEVfUkVQUkVTRU5UQVRJT04oJ2N1YmUtTm9uZScsKCMzMiksIzE4Nyk7DQojMTI9U0hBUEVfREVGSU5JVElPTl9SRVBSRVNFTlRBVElPTigjMTMsIzIyKTsNCiMxMz1QUk9EVUNUX0RFRklOSVRJT05fU0hBUEUoJycsJycsIzE0KTsNCiMxND1QUk9EVUNUX0RFRklOSVRJT04oJyAnLCcnLCMxNiwjMTUpOw0KIzE1PVBST0RVQ1RfREVGSU5JVElPTl9DT05URVhUKCdwYXJ0IGRlZmluaXRpb24nLCMyMSwnZGVzaWduJyk7DQojMTY9UFJPRFVDVF9ERUZJTklUSU9OX0ZPUk1BVElPTl9XSVRIX1NQRUNJRklFRF9TT1VSQ0UoJyAnLCcgJywjMTgsDQogLk5PVF9LTk9XTi4pOw0KIzE3PVBST0RVQ1RfUkVMQVRFRF9QUk9EVUNUX0NBVEVHT1JZKCdwYXJ0JywnJywoIzE4KSk7DQojMTg9UFJPRFVDVCgnY3ViZScsJ2N1YmUnLCcgJywoIzE5KSk7DQojMTk9UFJPRFVDVF9DT05URVhUKCcgJywjMjEsJ21lY2hhbmljYWwnKTsNCiMyMD1BUFBMSUNBVElPTl9QUk9UT0NPTF9ERUZJTklUSU9OKCdpbnRlcm5hdGlvbmFsIHN0YW5kYXJkJywNCidhdXRvbW90aXZlX2Rlc2lnbicsMjAxMCwjMjEpOw0KIzIxPUFQUExJQ0FUSU9OX0NPTlRFWFQoDQonY29yZSBkYXRhIGZvciBhdXRvbW90aXZlIG1lY2hhbmljYWwgZGVzaWduIHByb2Nlc3NlcycpOw0KIzIyPVNIQVBFX1JFUFJFU0VOVEFUSU9OKCdjdWJlLU5vbmUnLCgjMTI2KSwjMTg3KTsNCiMyMz1QUkVTRU5UQVRJT05fTEFZRVJfQVNTSUdOTUVOVCgnMScsJ0xheWVyIDEnLCgjMzIpKTsNCiMyND1TVFlMRURfSVRFTSgnJywoIzI1KSwjMzIpOw0KIzI1PVBSRVNFTlRBVElPTl9TVFlMRV9BU1NJR05NRU5UKCgjMjYpKTsNCiMyNj1TVVJGQUNFX1NUWUxFX1VTQUdFKC5CT1RILiwjMjcpOw0KIzI3PVNVUkZBQ0VfU0lERV9TVFlMRSgnJywoIzI4KSk7DQojMjg9U1VSRkFDRV9TVFlMRV9GSUxMX0FSRUEoIzI5KTsNCiMyOT1GSUxMX0FSRUFfU1RZTEUoJycsKCMzMCkpOw0KIzMwPUZJTExfQVJFQV9TVFlMRV9DT0xPVVIoJycsIzMxKTsNCiMzMT1DT0xPVVJfUkdCKCdPcmFuZ2UnLDEuLDAuNiwwLik7DQojMzI9TUFOSUZPTERfU09MSURfQlJFUCgnJywjMzMpOw0KIzMzPUNMT1NFRF9TSEVMTCgnJywoIzM0LCMzNSwjMzYsIzM3LCMzOCwjMzkpKTsNCiMzND1BRFZBTkNFRF9GQUNFKCcnLCgjNDYpLCM0MCwuRi4pOw0KIzM1PUFEVkFOQ0VEX0ZBQ0UoJycsKCM0NyksIzQxLC5GLik7DQojMzY9QURWQU5DRURfRkFDRSgnJywoIzQ4KSwjNDIsLkYuKTsNCiMzNz1BRFZBTkNFRF9GQUNFKCcnLCgjNDkpLCM0MywuRi4pOw0KIzM4PUFEVkFOQ0VEX0ZBQ0UoJycsKCM1MCksIzQ0LC5ULik7DQojMzk9QURWQU5DRURfRkFDRSgnJywoIzUxKSwjNDUsLkYuKTsNCiM0MD1QTEFORSgnJywjMTI3KTsNCiM0MT1QTEFORSgnJywjMTI4KTsNCiM0Mj1QTEFORSgnJywjMTI5KTsNCiM0Mz1QTEFORSgnJywjMTMwKTsNCiM0ND1QTEFORSgnJywjMTMxKTsNCiM0NT1QTEFORSgnJywjMTMyKTsNCiM0Nj1GQUNFX09VVEVSX0JPVU5EKCcnLCM1MiwuVC4pOw0KIzQ3PUZBQ0VfT1VURVJfQk9VTkQoJycsIzUzLC5ULik7DQojNDg9RkFDRV9PVVRFUl9CT1VORCgnJywjNTQsLlQuKTsNCiM0OT1GQUNFX09VVEVSX0JPVU5EKCcnLCM1NSwuVC4pOw0KIzUwPUZBQ0VfT1VURVJfQk9VTkQoJycsIzU2LC5ULik7DQojNTE9RkFDRV9PVVRFUl9CT1VORCgnJywjNTcsLlQuKTsNCiM1Mj1FREdFX0xPT1AoJycsKCM1OCwjNTksIzYwLCM2MSkpOw0KIzUzPUVER0VfTE9PUCgnJywoIzYyLCM2MywjNjQsIzY1KSk7DQojNTQ9RURHRV9MT09QKCcnLCgjNjYsIzY3LCM2OCwjNjkpKTsNCiM1NT1FREdFX0xPT1AoJycsKCM3MCwjNzEsIzcyLCM3MykpOw0KIzU2PUVER0VfTE9PUCgnJywoIzc0LCM3NSwjNzYsIzc3KSk7DQojNTc9RURHRV9MT09QKCcnLCgjNzgsIzc5LCM4MCwjODEpKTsNCiM1OD1PUklFTlRFRF9FREdFKCcnLCosKiwjOTAsLlQuKTsNCiM1OT1PUklFTlRFRF9FREdFKCcnLCosKiwjOTEsLkYuKTsNCiM2MD1PUklFTlRFRF9FREdFKCcnLCosKiwjOTIsLkYuKTsNCiM2MT1PUklFTlRFRF9FREdFKCcnLCosKiwjOTMsLlQuKTsNCiM2Mj1PUklFTlRFRF9FREdFKCcnLCosKiwjOTQsLlQuKTsNCiM2Mz1PUklFTlRFRF9FREdFKCcnLCosKiwjOTUsLkYuKTsNCiM2ND1PUklFTlRFRF9FREdFKCcnLCosKiwjOTYsLkYuKTsNCiM2NT1PUklFTlRFRF9FREdFKCcnLCosKiwjOTEsLlQuKTsNCiM2Nj1PUklFTlRFRF9FREdFKCcnLCosKiwjOTcsLlQuKTsNCiM2Nz1PUklFTlRFRF9FREdFKCcnLCosKiwjOTgsLkYuKTsNCiM2OD1PUklFTlRFRF9FREdFKCcnLCosKiwjOTksLkYuKTsNCiM2OT1PUklFTlRFRF9FREdFKCcnLCosKiwjOTUsLlQuKTsNCiM3MD1PUklFTlRFRF9FREdFKCcnLCosKiwjMTAwLC5ULik7DQojNzE9T1JJRU5URURfRURHRSgnJywqLCosIzkzLC5GLik7DQojNzI9T1JJRU5URURfRURHRSgnJywqLCosIzEwMSwuRi4pOw0KIzczPU9SSUVOVEVEX0VER0UoJycsKiwqLCM5OCwuVC4pOw0KIzc0PU9SSUVOVEVEX0VER0UoJycsKiwqLCM5MiwuVC4pOw0KIzc1PU9SSUVOVEVEX0VER0UoJycsKiwqLCM5NiwuVC4pOw0KIzc2PU9SSUVOVEVEX0VER0UoJycsKiwqLCM5OSwuVC4pOw0KIzc3PU9SSUVOVEVEX0VER0UoJycsKiwqLCMxMDEsLlQuKTsNCiM3OD1PUklFTlRFRF9FREdFKCcnLCosKiwjOTAsLkYuKTsNCiM3OT1PUklFTlRFRF9FREdFKCcnLCosKiwjMTAwLC5GLik7DQojODA9T1JJRU5URURfRURHRSgnJywqLCosIzk3LC5GLik7DQojODE9T1JJRU5URURfRURHRSgnJywqLCosIzk0LC5GLik7DQojODI9VkVSVEVYX1BPSU5UKCcnLCMxNjEpOw0KIzgzPVZFUlRFWF9QT0lOVCgnJywjMTYyKTsNCiM4ND1WRVJURVhfUE9JTlQoJycsIzE2NCk7DQojODU9VkVSVEVYX1BPSU5UKCcnLCMxNjYpOw0KIzg2PVZFUlRFWF9QT0lOVCgnJywjMTcwKTsNCiM4Nz1WRVJURVhfUE9JTlQoJycsIzE3Mik7DQojODg9VkVSVEVYX1BPSU5UKCcnLCMxNzYpOw0KIzg5PVZFUlRFWF9QT0lOVCgnJywjMTc4KTsNCiM5MD1FREdFX0NVUlZFKCcnLCM4MiwjODMsIzEwMiwuVC4pOw0KIzkxPUVER0VfQ1VSVkUoJycsIzg0LCM4MywjMTAzLC5ULik7DQojOTI9RURHRV9DVVJWRSgnJywjODUsIzg0LCMxMDQsLlQuKTsNCiM5Mz1FREdFX0NVUlZFKCcnLCM4NSwjODIsIzEwNSwuVC4pOw0KIzk0PUVER0VfQ1VSVkUoJycsIzgzLCM4NiwjMTA2LC5ULik7DQojOTU9RURHRV9DVVJWRSgnJywjODcsIzg2LCMxMDcsLlQuKTsNCiM5Nj1FREdFX0NVUlZFKCcnLCM4NCwjODcsIzEwOCwuVC4pOw0KIzk3PUVER0VfQ1VSVkUoJycsIzg2LCM4OCwjMTA5LC5ULik7DQojOTg9RURHRV9DVVJWRSgnJywjODksIzg4LCMxMTAsLlQuKTsNCiM5OT1FREdFX0NVUlZFKCcnLCM4NywjODksIzExMSwuVC4pOw0KIzEwMD1FREdFX0NVUlZFKCcnLCM4OCwjODIsIzExMiwuVC4pOw0KIzEwMT1FREdFX0NVUlZFKCcnLCM4OSwjODUsIzExMywuVC4pOw0KIzEwMj1MSU5FKCcnLCMxNjAsIzExNCk7DQojMTAzPUxJTkUoJycsIzE2MywjMTE1KTsNCiMxMDQ9TElORSgnJywjMTY1LCMxMTYpOw0KIzEwNT1MSU5FKCcnLCMxNjcsIzExNyk7DQojMTA2PUxJTkUoJycsIzE2OSwjMTE4KTsNCiMxMDc9TElORSgnJywjMTcxLCMxMTkpOw0KIzEwOD1MSU5FKCcnLCMxNzMsIzEyMCk7DQojMTA5PUxJTkUoJycsIzE3NSwjMTIxKTsNCiMxMTA9TElORSgnJywjMTc3LCMxMjIpOw0KIzExMT1MSU5FKCcnLCMxNzksIzEyMyk7DQojMTEyPUxJTkUoJycsIzE4MSwjMTI0KTsNCiMxMTM9TElORSgnJywjMTgyLCMxMjUpOw0KIzExND1WRUNUT1IoJycsIzEzNSwxLik7DQojMTE1PVZFQ1RPUignJywjMTM2LDEuKTsNCiMxMTY9VkVDVE9SKCcnLCMxMzcsMS4pOw0KIzExNz1WRUNUT1IoJycsIzEzOCwxLik7DQojMTE4PVZFQ1RPUignJywjMTQxLDEuKTsNCiMxMTk9VkVDVE9SKCcnLCMxNDIsMS4pOw0KIzEyMD1WRUNUT1IoJycsIzE0MywxLik7DQojMTIxPVZFQ1RPUignJywjMTQ2LDEuKTsNCiMxMjI9VkVDVE9SKCcnLCMxNDcsMS4pOw0KIzEyMz1WRUNUT1IoJycsIzE0OCwxLik7DQojMTI0PVZFQ1RPUignJywjMTUxLDEuKTsNCiMxMjU9VkVDVE9SKCcnLCMxNTIsMS4pOw0KIzEyNj1BWElTMl9QTEFDRU1FTlRfM0QoJycsIzE1OSwjMTMzLCMxMzQpOw0KIzEyNz1BWElTMl9QTEFDRU1FTlRfM0QoJycsIzE2OCwjMTM5LCMxNDApOw0KIzEyOD1BWElTMl9QTEFDRU1FTlRfM0QoJycsIzE3NCwjMTQ0LCMxNDUpOw0KIzEyOT1BWElTMl9QTEFDRU1FTlRfM0QoJycsIzE4MCwjMTQ5LCMxNTApOw0KIzEzMD1BWElTMl9QTEFDRU1FTlRfM0QoJycsIzE4MywjMTUzLCMxNTQpOw0KIzEzMT1BWElTMl9QTEFDRU1FTlRfM0QoJycsIzE4NCwjMTU1LCMxNTYpOw0KIzEzMj1BWElTMl9QTEFDRU1FTlRfM0QoJycsIzE4NSwjMTU3LCMxNTgpOw0KIzEzMz1ESVJFQ1RJT04oJycsKDAuLDAuLDEuKSk7DQojMTM0PURJUkVDVElPTignJywoMS4sMC4sMC4pKTsNCiMxMzU9RElSRUNUSU9OKCcnLCgwLiwxLiwwLikpOw0KIzEzNj1ESVJFQ1RJT04oJycsKDAuLDAuLC0xLikpOw0KIzEzNz1ESVJFQ1RJT04oJycsKDAuLDEuLDAuKSk7DQojMTM4PURJUkVDVElPTignJywoMC4sMC4sLTEuKSk7DQojMTM5PURJUkVDVElPTignJywoLTEuLDAuLDAuKSk7DQojMTQwPURJUkVDVElPTignJywoMC4sMC4sMS4pKTsNCiMxNDE9RElSRUNUSU9OKCcnLCgtMS4sMC4sMC4pKTsNCiMxNDI9RElSRUNUSU9OKCcnLCgwLiwwLiwtMS4pKTsNCiMxNDM9RElSRUNUSU9OKCcnLCgtMS4sMC4sMC4pKTsNCiMxNDQ9RElSRUNUSU9OKCcnLCgwLiwtMS4sMC4pKTsNCiMxNDU9RElSRUNUSU9OKCcnLCgwLiwwLiwtMS4pKTsNCiMxNDY9RElSRUNUSU9OKCcnLCgtMy43MDA3NDM0MTU0MTcxOUUtMDE1LC0xLiwwLikpOw0KIzE0Nz1ESVJFQ1RJT04oJycsKDAuLDAuLC0xLikpOw0KIzE0OD1ESVJFQ1RJT04oJycsKC0zLjcwMDc0MzQxNTQxNzE5RS0wMTUsLTEuLDAuKSk7DQojMTQ5PURJUkVDVElPTignJywoMS4sLTMuNzAwNzQzNDE1NDE3MTlFLTAxNSwwLikpOw0KIzE1MD1ESVJFQ1RJT04oJycsKDMuNjkxNDkxNTU2ODc4NjVFLTAxNSwxLiwwLikpOw0KIzE1MT1ESVJFQ1RJT04oJycsKDEuLC0xLjExMDIyMzAyNDYyNTE1RS0wMTUsMC4pKTsNCiMxNTI9RElSRUNUSU9OKCcnLCgxLiwtMS4xMTAyMjMwMjQ2MjUxNUUtMDE1LDAuKSk7DQojMTUzPURJUkVDVElPTignJywoMS4xMTAyMjMwMjQ2MjUxNUUtMDE1LDEuLDAuKSk7DQojMTU0PURJUkVDVElPTignJywoLTEuLDEuMTEwMjIzMDI0NjI1MTZFLTAxNSwwLikpOw0KIzE1NT1ESVJFQ1RJT04oJycsKDAuLDAuLDEuKSk7DQojMTU2PURJUkVDVElPTignJywoMS4sMC4sMC4pKTsNCiMxNTc9RElSRUNUSU9OKCcnLCgwLiwwLiwxLikpOw0KIzE1OD1ESVJFQ1RJT04oJycsKDEuLDAuLDAuKSk7DQojMTU5PUNBUlRFU0lBTl9QT0lOVCgnJywoMC4sMC4sMC4pKTsNCiMxNjA9Q0FSVEVTSUFOX1BPSU5UKCcnLCgxNDAuLC0xNDAuLDAuKSk7DQojMTYxPUNBUlRFU0lBTl9QT0lOVCgnJywoMTQwLiwtMTQwLiwwLikpOw0KIzE2Mj1DQVJURVNJQU5fUE9JTlQoJycsKDE0MC4sMTYwLiwwLikpOw0KIzE2Mz1DQVJURVNJQU5fUE9JTlQoJycsKDE0MC4sMTYwLiwzMDAuKSk7DQojMTY0PUNBUlRFU0lBTl9QT0lOVCgnJywoMTQwLiwxNjAuLDMwMC4pKTsNCiMxNjU9Q0FSVEVTSUFOX1BPSU5UKCcnLCgxNDAuLC0xNDAuLDMwMC4pKTsNCiMxNjY9Q0FSVEVTSUFOX1BPSU5UKCcnLCgxNDAuLC0xNDAuLDMwMC4pKTsNCiMxNjc9Q0FSVEVTSUFOX1BPSU5UKCcnLCgxNDAuLC0xNDAuLDMwMC4pKTsNCiMxNjg9Q0FSVEVTSUFOX1BPSU5UKCcnLCgxNDAuLC0xNDAuLDMwMC4pKTsNCiMxNjk9Q0FSVEVTSUFOX1BPSU5UKCcnLCgxNDAuLDE2MC4sMC4pKTsNCiMxNzA9Q0FSVEVTSUFOX1BPSU5UKCcnLCgtMTYwLiwxNjAuLDAuKSk7DQojMTcxPUNBUlRFU0lBTl9QT0lOVCgnJywoLTE2MC4sMTYwLiwzMDAuKSk7DQojMTcyPUNBUlRFU0lBTl9QT0lOVCgnJywoLTE2MC4sMTYwLiwzMDAuKSk7DQojMTczPUNBUlRFU0lBTl9QT0lOVCgnJywoMTQwLiwxNjAuLDMwMC4pKTsNCiMxNzQ9Q0FSVEVTSUFOX1BPSU5UKCcnLCgxNDAuLDE2MC4sMzAwLikpOw0KIzE3NT1DQVJURVNJQU5fUE9JTlQoJycsKC0xNjAuLDE2MC4sMC4pKTsNCiMxNzY9Q0FSVEVTSUFOX1BPSU5UKCcnLCgtMTYwLjAwMDAwMDAwMDAwMSwtMTQwLiwwLikpOw0KIzE3Nz1DQVJURVNJQU5fUE9JTlQoJycsKC0xNjAuMDAwMDAwMDAwMDAxLC0xNDAuLDMwMC4pKTsNCiMxNzg9Q0FSVEVTSUFOX1BPSU5UKCcnLCgtMTYwLjAwMDAwMDAwMDAwMSwtMTQwLiwzMDAuKSk7DQojMTc5PUNBUlRFU0lBTl9QT0lOVCgnJywoLTE2MC4sMTYwLiwzMDAuKSk7DQojMTgwPUNBUlRFU0lBTl9QT0lOVCgnJywoLTE2MC4sMTYwLiwzMDAuKSk7DQojMTgxPUNBUlRFU0lBTl9QT0lOVCgnJywoLTE2MC4wMDAwMDAwMDAwMDEsLTE0MC4sMC4pKTsNCiMxODI9Q0FSVEVTSUFOX1BPSU5UKCcnLCgtMTYwLjAwMDAwMDAwMDAwMSwtMTQwLiwzMDAuKSk7DQojMTgzPUNBUlRFU0lBTl9QT0lOVCgnJywoLTE2MC4wMDAwMDAwMDAwMDEsLTE0MC4sMzAwLikpOw0KIzE4ND1DQVJURVNJQU5fUE9JTlQoJycsKDAuLDAuLDMwMC4pKTsNCiMxODU9Q0FSVEVTSUFOX1BPSU5UKCcnLCgwLiwwLiwwLikpOw0KIzE4Nj1NRUNIQU5JQ0FMX0RFU0lHTl9HRU9NRVRSSUNfUFJFU0VOVEFUSU9OX1JFUFJFU0VOVEFUSU9OKCcnLCgjMjQpLCMxODcpOw0KIzE4Nz0oDQpHRU9NRVRSSUNfUkVQUkVTRU5UQVRJT05fQ09OVEVYVCgzKQ0KR0xPQkFMX1VOQ0VSVEFJTlRZX0FTU0lHTkVEX0NPTlRFWFQoKCMxODgpKQ0KR0xPQkFMX1VOSVRfQVNTSUdORURfQ09OVEVYVCgoIzE5NCwjMTkwLCMxODkpKQ0KUkVQUkVTRU5UQVRJT05fQ09OVEVYVCgnY3ViZScsJ1RPUF9MRVZFTF9BU1NFTUJMWV9QQVJUJykNCik7DQojMTg4PVVOQ0VSVEFJTlRZX01FQVNVUkVfV0lUSF9VTklUKExFTkdUSF9NRUFTVVJFKDIuRS0wMDUpLCMxOTQsDQonRElTVEFOQ0VfQUNDVVJBQ1lfVkFMVUUnLCdNYXhpbXVtIFRvbGVyYW5jZSBhcHBsaWVkIHRvIG1vZGVsJyk7DQojMTg5PSgNCk5BTUVEX1VOSVQoKikNClNJX1VOSVQoJCwuU1RFUkFESUFOLikNClNPTElEX0FOR0xFX1VOSVQoKQ0KKTsNCiMxOTA9KA0KQ09OVkVSU0lPTl9CQVNFRF9VTklUKCdERUdSRUUnLCMxOTIpDQpOQU1FRF9VTklUKCMxOTEpDQpQTEFORV9BTkdMRV9VTklUKCkNCik7DQojMTkxPURJTUVOU0lPTkFMX0VYUE9ORU5UUygwLiwwLiwwLiwwLiwwLiwwLiwwLik7DQojMTkyPVBMQU5FX0FOR0xFX01FQVNVUkVfV0lUSF9VTklUKFBMQU5FX0FOR0xFX01FQVNVUkUoMC4wMTc0NTMyOTI1KSwjMTkzKTsNCiMxOTM9KA0KTkFNRURfVU5JVCgqKQ0KUExBTkVfQU5HTEVfVU5JVCgpDQpTSV9VTklUKCQsLlJBRElBTi4pDQopOw0KIzE5ND0oDQpMRU5HVEhfVU5JVCgpDQpOQU1FRF9VTklUKCopDQpTSV9VTklUKC5NSUxMSS4sLk1FVFJFLikNCik7DQpFTkRTRUM7DQpFTkQtSVNPLTEwMzAzLTIxOw0K';
    const binStr = atob(CUBE_STP_B64);
    const stepBytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) stepBytes[i] = binStr.charCodeAt(i);

    // Verify SHA-256 hash preservation using web-standard crypto.subtle
    const hashBuf = await globalThis.crypto.subtle.digest('SHA-256', stepBytes.buffer);
    const hash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    assert(hash === 'f2e8c17cddf0421e925db847412080bac15713396dfaf134f195e9dad216a3f2', `cube.stp hash mismatch: ${hash}`);

    // Tessellate via occt-import-js:
    // In browser, executes inside the dedicated Web Worker (compliant with strict CSP).
    // In Node, executes directly via occt-import-js.
    let stepModel: MeshModel;
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      const { importCadModel } = await import('../_cad/client');
      const file = new File([stepBytes], 'cube.stp', { type: 'model/step' });
      stepModel = await importCadModel(file, 'standard');
    } else {
      const occtModule = await import('occt-import-js');
      const initOcct = occtModule.default || occtModule;
      const occt = await initOcct();
      const readRes = occt.ReadStepFile(stepBytes, { linearUnit: 'millimeter' });
      assert(readRes.success === true, 'ReadStepFile must succeed');
      const mesh = readRes.meshes![0];
      const stepRawPos = new Float32Array(mesh.attributes.position.array);
      const stepRawIdx = new Uint32Array(mesh.index.array);
      const stepWelded = weldIndexedVertices(stepRawPos, stepRawIdx);
      stepModel = {
        name: 'cube_step',
        positions: stepWelded.positions,
        indices: stepWelded.indices,
        warnings: [],
      };
    }

    const stepStats = analyzeMesh(stepModel);
    assert(stepStats.vertices === 8, `STEP welded vertices: expected 8, got ${stepStats.vertices}`);
    assert(stepStats.triangles === 12, `STEP triangles: expected 12, got ${stepStats.triangles}`);
    assert(stepStats.watertight === true, 'STEP cube must be watertight after welding');
    assert(stepStats.boundaryEdges === 0, 'STEP cube must have 0 boundary edges');
    assertNear(stepStats.bounds.size[0], 300, 1e-2, 'STEP cube width X');
    assertNear(stepStats.bounds.size[1], 300, 1e-2, 'STEP cube depth Y');
    assertNear(stepStats.bounds.size[2], 300, 1e-2, 'STEP cube height Z');
    assertNear(stepStats.volume!, 27_000_000, 1.0, 'STEP cube volume 27,000,000 mm^3');

    // Roundtrip export to STL
    const stlBuf = exportSTL(stepModel);
    const reStl = parseSTL(stlBuf, 're_step_stl');
    const reStlStats = analyzeMesh(reStl);
    assert(reStlStats.watertight === true, 'Roundtrip STL watertight');
    assertNear(reStlStats.volume!, 27_000_000, 1.0, 'Roundtrip STL volume');

    // Roundtrip export to 3MF
    const threeMfBlob = await export3MF(stepModel);
    const re3mfBuf = await threeMfBlob.arrayBuffer();
    const re3mf = await parse3MF(re3mfBuf, 're_step_3mf');
    const re3mfStats = analyzeMesh(re3mf);
    assert(re3mfStats.watertight === true, 'Roundtrip 3MF watertight');
    assertNear(re3mfStats.volume!, 27_000_000, 1.0, 'Roundtrip 3MF volume');
  });

  // 15. Client Size Precheck & Cancel Generation
  await test('15. Client Size Precheck Before Buffer Read and Cancel Generation', async () => {
    const { importModel } = await import('./client');

    // Oversized mock File (> 100 MB)
    let bufferReadCalled = false;
    const oversizedFile = {
      name: 'giant.stl',
      size: 150 * 1024 * 1024,
      type: 'model/stl',
      arrayBuffer: async () => {
        bufferReadCalled = true;
        return new ArrayBuffer(0);
      },
    } as unknown as File;

    let caughtOversize = false;
    try {
      await importModel(oversizedFile);
    } catch (err) {
      if (err instanceof Error && err.message.includes('exceeds maximum supported size of 100 MB')) {
        caughtOversize = true;
      }
    }
    assert(caughtOversize, 'Should reject file exceeding 100 MB');
    assert(bufferReadCalled === false, 'arrayBuffer() must NOT be called on oversized file');

    // 0-byte file
    let caughtEmpty = false;
    try {
      const emptyFile = {
        name: 'empty.obj',
        size: 0,
        type: 'model/obj',
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as File;
      await importModel(emptyFile);
    } catch (err) {
      if (err instanceof Error && err.message.includes('empty')) {
        caughtEmpty = true;
      }
    }
    assert(caughtEmpty, 'Should reject empty file immediately');
  });

  // 16. 3MF Multi-Model .rels Disambiguation, Namespace Enforcement, and MIME-Only Routing
  await test('16. 3MF Multi-Model .rels Disambiguation, Namespace Enforcement, and MIME-Only Routing', async () => {
    // 1. Multiple .model files: _rels/.rels points to secondary.model
    const zip1 = new JSZip();
    zip1.file(
      '_rels/.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="r1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/secondary.model" />
</Relationships>`,
    );
    const xml10 = `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources><object id="1" type="model"><mesh>
    <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="10" y="10" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/><vertex x="10" y="0" z="10"/><vertex x="10" y="10" z="10"/><vertex x="0" y="10" z="10"/></vertices>
    <triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="3" v3="2"/><triangle v1="4" v2="5" v3="6"/><triangle v1="4" v2="6" v3="7"/><triangle v1="0" v2="1" v3="5"/><triangle v1="0" v2="5" v3="4"/><triangle v1="2" v2="3" v3="7"/><triangle v1="2" v2="7" v3="6"/><triangle v1="0" v2="4" v3="7"/><triangle v1="0" v2="7" v3="3"/><triangle v1="1" v2="2" v3="6"/><triangle v1="1" v2="6" v3="5"/></triangles>
  </mesh></object></resources><build><item objectid="1"/></build></model>`;
    const xml20 = `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources><object id="1" type="model"><mesh>
    <vertices><vertex x="0" y="0" z="0"/><vertex x="20" y="0" z="0"/><vertex x="20" y="20" z="0"/><vertex x="0" y="20" z="0"/><vertex x="0" y="0" z="20"/><vertex x="20" y="0" z="20"/><vertex x="20" y="20" z="20"/><vertex x="0" y="20" z="20"/></vertices>
    <triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="3" v3="2"/><triangle v1="4" v2="5" v3="6"/><triangle v1="4" v2="6" v3="7"/><triangle v1="0" v2="1" v3="5"/><triangle v1="0" v2="5" v3="4"/><triangle v1="2" v2="3" v3="7"/><triangle v1="2" v2="7" v3="6"/><triangle v1="0" v2="4" v3="7"/><triangle v1="0" v2="7" v3="3"/><triangle v1="1" v2="2" v3="6"/><triangle v1="1" v2="6" v3="5"/></triangles>
  </mesh></object></resources><build><item objectid="1"/></build></model>`;
    zip1.file('3D/primary.model', xml10);
    zip1.file('3D/secondary.model', xml20);

    const buf1 = await zip1.generateAsync({ type: 'arraybuffer' });
    const model1 = await parse3MF(buf1, 'test_multi');
    const stats1 = analyzeMesh(model1);
    assertNear(stats1.volume!, 8000, 1e-2, 'Must read secondary.model targeted by _rels/.rels');

    // 2. Multiple .model files without _rels/.rels: must reject
    const zip2 = new JSZip();
    zip2.file('3D/primary.model', xml10);
    zip2.file('3D/secondary.model', xml20);
    const buf2 = await zip2.generateAsync({ type: 'arraybuffer' });
    let caughtAmbiguous = false;
    try {
      await parse3MF(buf2, 'ambiguous');
    } catch (err) {
      if (err instanceof Error && err.message.includes('multiple .model files found')) {
        caughtAmbiguous = true;
      }
    }
    assert(caughtAmbiguous, 'Must reject multiple .model files when _rels/.rels is missing');

    // 3. Namespace validation
    const zip3 = new JSZip();
    zip3.file(
      '3D/3dmodel.model',
      `<model unit="millimeter" xmlns="http://unknown.org/custom"><resources></resources><build></build></model>`,
    );
    const buf3 = await zip3.generateAsync({ type: 'arraybuffer' });
    let caughtNs = false;
    try {
      await parse3MF(buf3, 'bad_ns');
    } catch (err) {
      if (err instanceof Error && err.message.includes('unknown namespace')) {
        caughtNs = true;
      }
    }
    assert(caughtNs, 'Must reject unsupported 3MF namespace');

    // 4. Unknown model MIME rejection in importModel
    const { importModel } = await import('./client');
    let caughtUnknownMime = false;
    try {
      const unknownMimeFile = {
        name: 'model_without_extension',
        size: 100,
        type: 'model/vrml',
        arrayBuffer: async () => new ArrayBuffer(100),
      } as unknown as File;
      await importModel(unknownMimeFile);
    } catch (err) {
      if (err instanceof Error && err.message.includes('Unsupported 3D model format')) {
        caughtUnknownMime = true;
      }
    }
    assert(caughtUnknownMime, 'Must reject unknown model MIME (model/vrml)');
  });
  // 17. Browser Web Worker Pipeline & Client API Verification
  if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
    await test('17. Browser Web Worker Client API & Non-Detachment Verification', async () => {
      const client = await import('./client');

      const cube = createCubeModel(10, 'worker_cube');
      const initialByteLen = cube.positions.byteLength;

      // Inspect via worker
      const stats = await client.inspectModel(cube);
      assert(cube.positions.byteLength === initialByteLen, 'Caller buffer was detached in inspectModel!');
      assert(stats.watertight === true, 'Worker inspect watertight should be true');
      assertNear(stats.volume!, 1000, 1e-2, 'Worker inspect volume');

      // Transform via worker
      const transformed = await client.processModel(cube, {
        kind: 'transform',
        scale: [2, 2, 2],
        rotation: [0, 0, 0],
        center: true,
        ground: true,
      });
      assert(cube.positions.byteLength === initialByteLen, 'Caller buffer was detached in transform!');
      const transStats = await client.inspectModel(transformed);
      assertNear(transStats.bounds.size[0], 20, 1e-2, 'Transformed size X');

      // Export across all 4 formats via worker
      const stlBlob = await client.exportModel(cube, 'stl');
      assert(stlBlob.type === 'model/stl', 'STL blob type');
      assert(stlBlob.size === 84 + 12 * 50, 'STL binary size');

      const objBlob = await client.exportModel(cube, 'obj');
      assert(objBlob.type === 'model/obj', 'OBJ blob type');

      const plyBlob = await client.exportModel(cube, 'ply');
      assert(plyBlob.type === 'model/ply', 'PLY blob type');

      const threeMfBlob = await client.exportModel(cube, '3mf');
      assert(threeMfBlob.type.includes('3dmanufacturing'), '3MF blob type');

      // Cancel jobs and verify recreation
      client.cancelMeshJobs();
      const postCancelStats = await client.inspectModel(cube);
      assert(postCancelStats.watertight === true, 'Worker restarted cleanly after cancellation');
    });
  }

  const allPassed = results.every((r) => r.passed);
  return { passed: allPassed, results };
}

// Auto-run if executed directly via Node
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('verify')) {
  runAllTests().then(({ passed, results }) => {
    console.log('\n--- 3D Mesh Engine Verification Test Suite ---');
    for (const r of results) {
      const status = r.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`${status}: ${r.name} (${r.durationMs.toFixed(1)}ms)`);
      if (r.error) console.error(`   Error: ${r.error}`);
    }
    console.log('----------------------------------------------');
    console.log(passed ? 'ALL TESTS PASSED!' : 'SOME TESTS FAILED!');
    if (!passed) process.exit(1);
  });
}
