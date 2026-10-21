# 3D CAD Adapter Implementation & Verification (`occt-import-js`)

## 1. Scope & Implementation Summary

- **Exclusive Scope:** `src/tools/3d/_cad/**`, `src/tools/3d/_mesh/**`, `src/types/occt-import-js.d.ts`, `package.json`, `package-lock.json`, and `docs/3d-cad-verification.md`.
- **Protected Files Respected:** `_ui/**`, `src/tools/registry.ts`, and root app files were not modified.
- **Client Exports (`src/tools/3d/_cad/client.ts` & `_mesh/client.ts`):**
  - `importModel(file: File): Promise<MeshModel>`: Automatically inspects extension and MIME types; routes CAD formats (`.step`, `.stp`, `.iges`, `.igs`, `.brep`) lazily to `importCadModel` and mesh formats (`.stl`, `.obj`, `.ply`, `.3mf`) to `mesh.worker.ts`.
  - `cancelMeshJobs()`: Cancels all active and queued mesh worker requests and calls `cancelCadJobs()` in parallel.
  - `MESH_ACCEPT`: Universal file input accept string supporting `.stl, .obj, .ply, .3mf, .step, .stp, .iges, .igs, .brep` and associated MIME types.
- **Geometry Contract:**
  ```ts
  export interface MeshModel {
    name: string;
    positions: Float32Array; // Flattened [x, y, z, ...], in millimeters
    indices: Uint32Array;   // Triangle indices [i0, i1, i2, ...]
    warnings: string[];
  }
  ```

---

## 2. Source Code & API Verification

`occt-import-js` (v0.0.23) was installed and verified:

### 2.1 Supported Formats and Entry Points
Inspecting `occt-import-js/src/js-interface.cpp` confirmed:
```cpp
emscripten::val ReadFile (const std::string& format, const emscripten::val& buffer, const emscripten::val& params)
{
    if (format == "step") {
        return ReadStepFile (buffer, params);
    } else if (format == "iges") {
        return ReadIgesFile (buffer, params);
    } else if (format == "brep") {
        return ReadBrepFile (buffer, params);
    } else {
        emscripten::val resultObj (emscripten::val::object ());
        resultObj.set ("success", false);
        return resultObj;
    }
}
```
- **Format Normalization:** `ReadFile` strictly expects format strings `"step"`, `"iges"`, or `"brep"`.
- **Adapter Handling:** The adapter resolves `.step`/`.stp` to `ReadStepFile`, `.iges`/`.igs` to `ReadIgesFile`, and `.brep` to `ReadBrepFile`.

### 2.2 Coordinate Normalization to Millimeters
In `occt-import-js/src/importer-utils.cpp` and `importer.hpp`:
- Supported units: `millimeter`, `centimeter`, `meter`, `inch`, `foot`.
- Parameter `linearUnit: "millimeter"` instructs OpenCASCADE to convert all internal geometric dimensions into millimeters according to the file's unit definition in the STEP/IGES header.
- The adapter explicitly passes `{ linearUnit: 'millimeter' }` on every conversion.

### 2.3 Quality Deflection Presets
OCCT's `BRepMesh_IncrementalMesh` uses chordal deflection (`linearDeflection`) and angular deflection (`angularDeflection` in radians). The adapter configures:
- `'coarse'`: `linearDeflection: 0.005` (0.5% bbox ratio), `angularDeflection: 0.8` rad (~45.8°).
- `'standard'`: `linearDeflection: 0.001` (0.1% bbox ratio), `angularDeflection: 0.5` rad (~28.6°, default).
- `'fine'`: `linearDeflection: 0.0002` (0.02% bbox ratio), `angularDeflection: 0.25` rad (~14.3°).

### 2.4 Canonical Index Welding at Normalization (Watertight Manifold Geometry)
OpenCASCADE computes triangulations per topological B-Rep face (`TopoDS_Face`). Because adjacent faces duplicate boundary vertices, raw concatenated meshes form open shells where shared edges appear as boundary edges (null volume, non-manifold).
- **Topology Stitching:** `weldIndexedVertices` in `src/tools/3d/_mesh/topology.ts` groups coincident vertex coordinates within `1e-5` mm tolerance (10 nm) into shared indexed vertices without geometric distortion.
- **Verification Result:** The official CAx-IF `cube.stp` tessellates into 6 faces with 24 raw vertices. After canonical index welding, it normalizes into exactly 8 vertices, 12 triangles, 0 boundary edges, watertight = true, and closed volume = 27,000,000 mm³ (300 x 300 x 300 mm).

---

## 3. Worker Architecture & Privacy Rule Compliance

### 3.1 Local Bundling via Vite
- `import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';`
- Emscripten initialization receives `locateFile: (path) => path.endsWith('.wasm') ? wasmUrl : path`.
- Vite bundles the 7.6 MB `.wasm` file as a locally served asset (e.g. `/assets/occt-import-js-[hash].wasm`).
- No external hosts are contacted; compliant with the strict CSP (`default-src 'self'`).

### 3.2 Lazy Dedicated Workers & Cancellation Generation
- `cad.worker.ts` and `mesh.worker.ts` are initialized lazily on demand.
- Heavy operations execute completely off the main thread.
- `cancelGeneration` tokens ensure that:
  - Jobs queued behind active operations are rejected immediately upon cancellation without starting.
  - Stale async operations (such as ongoing `file.arrayBuffer()` reads or dynamic imports) cannot resurrect or restart terminated workers.
- All requests are sequentially chained through a Promise queue to prevent concurrent memory spikes.

### 3.3 Limits & Integrity Safeguards
- **File size precheck:** File size is validated on the client *before* calling `file.arrayBuffer()` to prevent reading giant files into browser heap memory:
  - CAD files: capped at 25 MB (`MAX_CAD_FILE_SIZE_BYTES`).
  - Mesh files: capped at 100 MB (`MAX_FILE_SIZE_BYTES`).
- **Triangle & vertex limits:** Capped at 1,000,000 triangles (`MAX_TRIANGLE_COUNT`) and 1,000,000 vertices (`MAX_VERTEX_COUNT`).
- **Archive safety:** ZIP archives capped at 128 MB expanded size (`MAX_ZIP_UNCOMPRESSED_BYTES`) with path traversal guards (`..` and leading slash rejection).
- **Cumulative instance precheck:** In 3MF archives, component instance counts and expected geometry are checked *before* recursive expansion or buffer allocation to prevent "billion laughs" instance bombs.
- **Transform validation:** Reject transforms containing 0, NaN, Infinity, or singular matrices with zero determinant.
- **3MF row-vector specification:** Uses row-vector formulation `x' = x*M0 + y*M3 + z*M6 + M9` with nested composition `comp.transform * currentTransform`, reversing triangle winding on reflection (`det < 0`) to preserve outward normals and positive closed volume.

---

## 4. Official Test Fixtures & Verification

Known small official STEP fixtures from the CAx Interoperability Forum (CAx-IF) test suite:

| Fixture | Source | SHA-256 | Verification Result |
| :--- | :--- | :--- | :--- |
| **`cube.stp`** | [CAx-IF STEP Library](https://www.cax-if.org/cax/cax_stepLib.php) | `f2e8c17cddf0421e925db847412080bac15713396dfaf134f195e9dad216a3f2` | 8 welded vertices, 12 triangles (36 indices), dimensions 300.00 x 300.00 x 300.00 mm, watertight: true, boundary edges: 0, closed volume: 27,000,000 mm³. Full roundtrip export/import verified for both STL binary and 3MF. |
| **`as1_pe_203.stp`** | [CAx-IF STEP Library](https://www.cax-if.org/cax/cax_stepLib.php) | `e14f7a52b3f0c53e36730c0f56654b01a17822f1b864dc6c42657223c54cafb6` | 18 assembly meshes, 1,708 welded vertices, 3,848 triangles, dimensions 5080.00 x 2209.80 x 3810.00 mm (conversion from 200" x 87" x 150"). |

---

## 5. Automated Verification Results

### 5.1 CLI Verification Suite (`npx tsx src/tools/3d/_mesh/verify.ts`)
```
--- 3D Mesh Engine Verification Test Suite ---
✓ PASS: 1. Known 10mm Cube Analysis (Closed Volume & Surface Area) (0.4ms)
✓ PASS: 2. Open Mesh Analysis (Watertight False & Null Volume) (0.1ms)
✓ PASS: 3. Affine Transforms (Scale, Rotation, Center, Ground) (0.2ms)
✓ PASS: 4. Format Roundtrip: STL Binary (Export & Import with Welding) (0.2ms)
✓ PASS: 5. Format Roundtrip: OBJ Geometry Only (0.2ms)
✓ PASS: 6. Format Roundtrip: PLY ASCII (1.2ms)
✓ PASS: 7. 3MF Archive: Units, Build Transforms, and Component Instances (14.9ms)
✓ PASS: 8. Polygon Reduction via MeshoptSimplifier (Achieved Metrics) (7.4ms)
✓ PASS: 9. Validation & Error Handling (Corrupt Buffers, Security, OOB) (1.2ms)
✓ PASS: 10. Disconnected Component Split and Merge (0.6ms)
✓ PASS: 11. 3MF Row-Vector Transform, 90deg Rotation + Nested Composition, Mirror Winding (2.0ms)
✓ PASS: 12. 3MF Unknown Units, Malformed XML, and Instance Bomb Limits (0.6ms)
✓ PASS: 13. Affine Transform Zero/NaN/Inf Rejection & Face Winding Only (0.1ms)
✓ PASS: 14. CAD Topology Stitching & CAx-IF STEP Cube Roundtrip (94.2ms)
✓ PASS: 15. Client Size Precheck Before Buffer Read and Cancel Generation (2.5ms)
----------------------------------------------
ALL TESTS PASSED!
```

### 5.2 Collaborative Browser Environment (`preview_evaluate` in T3 Code)
Execution of all 16 tests inside the live Chromium preview tab with active CSP:
```json
{
  "passed": true,
  "results": [
    { "name": "1. Known 10mm Cube Analysis (Closed Volume & Surface Area)", "passed": true },
    { "name": "2. Open Mesh Analysis (Watertight False & Null Volume)", "passed": true },
    { "name": "3. Affine Transforms (Scale, Rotation, Center, Ground)", "passed": true },
    { "name": "4. Format Roundtrip: STL Binary (Export & Import with Welding)", "passed": true },
    { "name": "5. Format Roundtrip: OBJ Geometry Only", "passed": true },
    { "name": "6. Format Roundtrip: PLY ASCII", "passed": true },
    { "name": "7. 3MF Archive: Units, Build Transforms, and Component Instances", "passed": true },
    { "name": "8. Polygon Reduction via MeshoptSimplifier (Achieved Metrics)", "passed": true },
    { "name": "9. Validation & Error Handling (Corrupt Buffers, Security, OOB)", "passed": true },
    { "name": "10. Disconnected Component Split and Merge", "passed": true },
    { "name": "11. 3MF Row-Vector Transform, 90deg Rotation + Nested Composition, Mirror Winding", "passed": true },
    { "name": "12. 3MF Unknown Units, Malformed XML, and Instance Bomb Limits", "passed": true },
    { "name": "13. Affine Transform Zero/NaN/Inf Rejection & Face Winding Only", "passed": true },
    { "name": "14. CAD Topology Stitching & CAx-IF STEP Cube Roundtrip", "passed": true },
    { "name": "15. Client Size Precheck Before Buffer Read and Cancel Generation", "passed": true },
    { "name": "16. Browser Web Worker Client API & Non-Detachment Verification", "passed": true }
  ]
}
```
All tests pass in both environments with 0 errors and 0 CSP violations.
