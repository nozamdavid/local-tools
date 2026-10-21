# Local-Only In-Browser 3D Mesh & CAD Tools: Technical Research & Architecture Specification

## 1. Executive Summary & Architectural Overview

This research document establishes the technical foundation, format matrix, WebAssembly integration patterns, and security constraints for introducing client-side 3D mesh and CAD processing tools to **Loconvert**.

In alignment with Loconvert's core privacy rule, **all 3D geometry decoding, tessellation, simplification, repair, and serialization must execute strictly inside the client's web browser**. No files, geometry buffers, or metadata are ever transmitted to remote servers. All WebAssembly binaries and runtime dependencies must be bundled locally or loaded dynamically from allowable origins without expanding the application's Content Security Policy (`index.html`).

```
                    ┌────────────────────────────────────────────────────────┐
                    │               Browser Client Workspace                 │
                    │                                                        │
┌──────────────┐    │  ┌─────────────────┐       ┌────────────────────────┐  │    ┌──────────────┐
│  Input File  │───>│  │  Format Loader  │──────>│  Normalized Geometry   │  │───>│ Export File  │
│  STL/OBJ/PLY │    │  │ (Three.js/OCCT) │       │ (Float32Array/Uint32)  │  │    │ STL/OBJ/PLY  │
│  3MF/STEP    │    │  └─────────────────┘       └───────────┬────────────┘  │    │ 3MF          │
└──────────────┘    │                                        │               │    └──────────────┘
                    │                                        ▼               │
                    │  ┌──────────────────────────────────────────────────┐  │
                    │  │              Local Processing Engines            │  │
                    │  │  • MeshoptSimplifier (WASM simplification)       │  │
                    │  │  • Topology & Manifold Analyzer                  │  │
                    │  │  • Unit Scaler & Coordinate Transformer          │  │
                    │  │  • Disconnected Component Splitter / Merger      │  │
                    │  │  • Three.js WebGL Viewport & Inspector           │  │
                    │  └──────────────────────────────────────────────────┘  │
                    └────────────────────────────────────────────────────────┘
```

> [!NOTE]
> **Research Evaluation vs. Actual Shipped Implementation Scope:**
> This document details the initial research evaluation across a wide variety of formats and techniques. The final shipped implementation in Loconvert consists of **seven dedicated routes** under `/3d/`:
> 1. `/3d/convert`: 3D Format Converter (`three-convert`)
> 2. `/3d/simplify`: 3D Mesh Simplifier & Decimator (`three-simplify`)
> 3. `/3d/inspect`: 3D Mesh Inspector & Topology Analyzer (`three-inspect`)
> 4. `/3d/transform`: 3D Mesh Transform & Unit Scaler (`three-transform`)
> 5. `/3d/normals`: 3D Normals & Face Winding Reorienter (`three-normals`)
> 6. `/3d/split`: 3D Mesh Component Splitter (`three-split`)
> 7. `/3d/merge`: 3D Mesh Merger (`three-merge`)
>
> **Key Production Boundaries:**
> - **Formats Shipped:** Mesh import/export for STL, OBJ, PLY, and 3MF; CAD import for STEP (`.step`, `.stp`), IGES (`.iges`, `.igs`), and BREP (`.brep`) tessellated to polygonal meshes via `occt-import-js`.
> - **No glTF / GLB Support Implemented:** glTF/GLB import and export were evaluated during exploratory research but are not included in the shipped 3D toolset.
> - **No STEP Output in Selected Engine:** The selected engine (`occt-import-js`) is a dedicated read-only tessellator. Browser CAD export is not universally impossible in principle, but full OpenCASCADE write engines require large WASM binaries and converting polygonal meshes to STEP produces bloated, un-editable faceted B-Reps.
> - **Geometry-Only:** Materials, textures, UVs, and animations are not processed or exported.
> - **Units:** Unitless formats (STL, OBJ, PLY) are assumed millimeters (mm); formats with declared units (3MF, CAD) are normalized to millimeters.

---

## 2. Privacy Rule, Content Security Policy & Bundle Strategy

### 2.1 Loconvert Privacy & CSP Compliance
Loconvert operates under a strict Content Security Policy defined in `index.html`:
```html
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' blob:;
worker-src 'self' blob:;
connect-src 'self' blob: data: ws: wss: https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net;
media-src 'self' blob: data:;
img-src 'self' blob: data:;
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
object-src 'none';
```

### 2.2 Security Guidelines for 3D Tools
1. **Zero External Host Additions**: No external endpoints may be added to `connect-src` or `script-src`. All WASM binaries (`occt-import-js.wasm`, `meshoptimizer`) must be bundled locally via Vite asset emission or static resolution (`/public` or `new URL(..., import.meta.url)`).
2. **Dynamic Lazy-Loading**: 3D packages (Three.js core, loaders, and CAD WASM engines) must never be imported statically on the home page or root bundle. They must be partitioned into lazy chunks via dynamic `import(...)` within tool components (`src/tools/3d/*`).
3. **No Network Model Dependencies**: Shaders, textures, environment maps (`.hdr`/`.exr`), and fonts must be procedural or bundled as local SVG/data strings. The 3D viewer must render using default hemispherical/directional lighting without remote environment maps.

---

## 3. Format Support Matrix & Loader/Exporter Capabilities

The primary runtime 3D framework used for client-side math and viewport rendering is **Three.js** (`three`, official npm release `^0.186.1`, MIT License).

### 3.1 Format Capability Overview

| Format | Import Engine | Export Engine | Memory Model | Units / Attributes | Implementation Status | Official Sources |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **STL** (`.stl`) | Built-in parser (`parseSTL`) | Built-in binary exporter (`exportSTL`) | Binary (`ArrayBuffer`) or ASCII text | Unitless (assumed mm); Triangles only | **Shipped** | [Three.js STLLoader](https://threejs.org/docs/#examples/en/loaders/STLLoader), [STLExporter](https://threejs.org/docs/#examples/en/exporters/STLExporter) |
| **OBJ** (`.obj`) | Built-in parser (`parseOBJ`) | Built-in text exporter (`exportOBJ`) | Text UTF-8 | Unitless (assumed mm); Geometry only (positions & faces) | **Shipped** | [Three.js OBJLoader](https://threejs.org/docs/#examples/en/loaders/OBJLoader), [OBJExporter](https://threejs.org/docs/#examples/en/exporters/OBJExporter) |
| **PLY** (`.ply`) | `PLYLoader` (Three.js) | Built-in ASCII exporter (`exportPLY`) | Binary or ASCII | Unitless (assumed mm); Welds unindexed triangles | **Shipped** | [Three.js PLYLoader](https://threejs.org/docs/#examples/en/loaders/PLYLoader), [PLYExporter](https://threejs.org/docs/#examples/en/exporters/PLYExporter) |
| **3MF** (`.3mf`) | Built-in parser (`parse3MF`) via `JSZip` + `fast-xml-parser` | Built-in writer (`export3MF`) via `JSZip` | OPC ZIP container containing XML (`3dmodel.model`) | Declared units normalized to mm; Rejects required extensions | **Shipped** | [3MF Core Specification](https://3mf.io/specification/), [mrdoob/three.js#18984](https://github.com/mrdoob/three.js/issues/18984) |
| **STEP / STP** (`.step`, `.stp`) | `occt-import-js` (WASM) | *None* | Text ISO 10303-21 | Explicit CAD units normalized to mm; B-Rep tessellated to mesh | **Shipped (Import only)** | [occt-import-js npm](https://www.npmjs.com/package/occt-import-js), [Open CASCADE](https://dev.opencascade.org/) |
| **IGES / IGS** (`.iges`, `.igs`) | `occt-import-js` (WASM) | *None* | Text ASCII CAD format | Explicit CAD units normalized to mm; B-Rep tessellated to mesh | **Shipped (Import only)** | [occt-import-js npm](https://www.npmjs.com/package/occt-import-js) |
| **BREP** (`.brep`) | `occt-import-js` (WASM) | *None* | OpenCASCADE native boundary rep | Explicit CAD units normalized to mm; B-Rep tessellated to mesh | **Shipped (Import only)** | [occt-import-js npm](https://www.npmjs.com/package/occt-import-js) |
| **glTF / GLB** (`.gltf`, `.glb`) | `GLTFLoader` (Three.js) | `GLTFExporter` (Three.js) | JSON + buffers or Binary container | Metric (meters); Full PBR hierarchy | *Evaluated in research; not shipped* | [Three.js GLTFLoader](https://threejs.org/docs/#examples/en/loaders/GLTFLoader), [GLTFExporter](https://threejs.org/docs/#examples/en/exporters/GLTFExporter) |

---

### 3.2 Detailed Format Analysis

#### A. STL (Stereolithography)
* **Import**: `parseSTL(buffer: ArrayBuffer, name?: string): MeshModel`.
  * Auto-detects binary vs ASCII STL by inspecting header length and triangle count.
  * Welds coincident vertices within 10 nm (`weldExactVertices`) to produce an indexed representation required for manifold analysis and simplification.
* **Export**: `exportSTL(model: MeshModel): ArrayBuffer`.
  * Serializes binary STL (80-byte header, 4-byte triangle count, 50 bytes per triangle).
  * Surface normals are computed per triangle face directly from the 3 vertices.

#### B. OBJ (Wavefront)
* **Import**: `parseOBJ(text: string, name?: string): MeshModel`.
  * Parses vertex lines (`v`) and face lines (`f`), handling positive (1-based) and negative (relative) vertex indices.
  * Triangulates convex polygons and quads via fan triangulation.
  * Materials (`mtllib`, `usemtl`) and texture coordinates (`vt`) are ignored with user warnings; no external network requests are dispatched.
* **Export**: `exportOBJ(model: MeshModel): string`.
  * Serializes clean Wavefront OBJ containing vertex positions (`v x y z`) and 1-based face indices (`f v1 v2 v3`).
  * Does not export vertex normals (`vn`) or smoothing groups; exported files represent geometry only.

#### C. PLY (Polygon File Format)
* **Import**: `parsePLY(buffer: ArrayBuffer, name?: string): MeshModel`.
  * Uses Three.js `PLYLoader` to parse binary or ASCII formats.
  * Triangle soup geometry without index buffers is automatically indexed using vertex deduplication.
  * Vertex colors and custom attributes are ignored.
* **Export**: `exportPLY(model: MeshModel): string`.
  * Serializes standard ASCII PLY with `element vertex` coordinates and `element face` vertex index lists.

#### D. 3MF (3D Manufacturing Format)
* **Import**: `parse3MF(buffer: ArrayBuffer, name?: string): Promise<MeshModel>`.
  * Built using `JSZip` and `fast-xml-parser` inside a Web Worker.
  * Inspects `_rels/.rels` for the 3D model document path (typically `3D/3dmodel.model`).
  * Rejects external relationships (`TargetMode="External"`).
  * Explicitly rejects archives requiring extensions (`@_requiredextensions`).
  * Normalizes units (`micron`, `millimeter`, `centimeter`, `inch`, `foot`, `meter`) to millimeters.
  * Resolves object hierarchies, components, and matrix transformations into a flattened mesh.
* **Export**: `export3MF(model: MeshModel): Promise<Blob>`.
  * Generates an OPC-compliant ZIP archive containing `[Content_Types].xml`, `_rels/.rels`, and `3D/3dmodel.model` in millimeter units.

---

## 4. STEP (CAD B-Rep) Feasibility & `occt-import-js`

### 4.1 The CAD Boundary Representation Challenge
Formats like STL, OBJ, and 3MF store polygonal meshes (flat planar facets). In contrast, STEP (ISO 10303-21), IGES, and BREP store exact mathematical Boundary Representation (B-Rep) geometry: NURBS surfaces, conic curves, toroidal patches, and topological edge loops.

Converting CAD models into meshes requires a computational geometry CAD kernel capable of boundary evaluation and non-linear surface tessellation.

### 4.2 Technical Solution: `occt-import-js`
* **Package**: `occt-import-js` (npm version `^0.0.23`).
* **License**: **LGPL-2.1** (Open CASCADE Technology wrapper).
* **Bundle Footprint**:
  * Emscripten JS wrapper: ~96 KB.
  * WASM binary (`occt-import-js.wasm`): **7.3 MB binary (~7.6 MB decimal, ~2.4 MB gzipped)**.
  * Unpacked npm package size: ~11.6 MB.
* **Dependencies**: 0 external npm dependencies.
* **Browser Compatibility**: Requires WebAssembly with `'wasm-unsafe-eval'`.

### 4.3 Import Pipeline & Deflection Controls
Tessellation quality is governed by linear and angular deflection:
```ts
import occtimportjs from 'occt-import-js';

// Lazy initialization pointing to locally bundled WASM
const occt = await occtimportjs({
  locateFile: (path: string) => `/wasm/${path}`,
});

// Import STEP file from Uint8Array
const result = occt.ReadStepFile(fileBytes, {
  linearUnit: 'millimeter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.001, // 0.1% of bounding box diagonal
  angularDeflection: 0.5,  // ~28.6 degrees max normal divergence
});
```

### 4.4 Scope Boundary: Read-Only CAD Tessellation
* **No STEP Output in Selected Engine:** `occt-import-js` is a dedicated read-only tessellation library. Browser CAD export is not universally impossible in principle—heavier OpenCASCADE wrappers (such as `replicad` or custom `opencascade.js` builds) can technically serialize B-Rep geometry in the browser. However, full CAD write builds require 23–49 MB WASM downloads and massive memory footprints. Furthermore, converting polygonal meshes to STEP produces bloated, un-editable faceted B-Reps (where every single triangle becomes an independent planar face) rather than parametric CAD models. Therefore, the production scope restricts CAD processing to client-side import and tessellation.
* **Shipped Scope:** Provides **STEP / IGES / BREP → STL / OBJ / PLY / 3MF conversion and inspection**.

---

## 5. Meshoptimizer Polygon Simplification WASM

### 5.1 Package Overview & Capabilities
* **Package**: `meshoptimizer` (npm version `^1.3.0`, MIT License, author: Arseny Kapoulkine).
* **Technology**: C++ WebAssembly compilation providing state-of-the-art edge-collapse mesh decimation with quadric error metrics.
* **Payload Size**: ~35 KB JS wrapper + ~50 KB WASM bytecode.
* **License**: MIT (fully compatible with commercial and permissive distribution).

### 5.2 API Signature & Behavior

```ts
import { MeshoptSimplifier } from 'meshoptimizer';

await MeshoptSimplifier.ready;

/**
 * Standard topology-preserving simplification
 */
const [simplifiedIndices, achievedError] = MeshoptSimplifier.simplify(
  indices,                 // Triangle index buffer (Uint32Array, multiple of 3)
  positions,               // Contiguous coordinates [x0, y0, z0, x1, y1, z1, ...]
  3,                       // Stride in floats
  targetIndexCount,        // Desired index count
  targetError,             // Max acceptable error (relative to bbox diagonal)
  flags                    // e.g. ['LockBorder']
);
```

### 5.3 Edge Cases & Simplification Realities
1. **Bounded Reduction Target:** `MeshoptSimplifier.simplify` enforces geometric error tolerance and boundary constraints. If the target ratio cannot be reached without violating `targetError` or altering locked border edges, decimation stops early. The achieved reduction is bounded by error and borders.
2. **Post-Decimation Vertex Compaction:** `MeshoptSimplifier.simplify` returns an index buffer referencing the original vertex array. To strip unreferenced coordinates, a remapping table is generated to compact vertices and indices.
3. **Viewport Normals vs Exported Geometry:** In the WebGL viewport, Three.js recomputes smooth vertex normals (`computeVertexNormals()`) for realistic shading. Exported mesh files (STL, OBJ, PLY, 3MF) store vertex positions and faces only.

---

## 6. Shipped 3D Tool Utilities

### 6.1 3D Model Viewer & Geometric Inspector (`/3d/inspect`)
* **Physical Dimensions:** Bounding box dimensions (Width $X$, Height $Y$, Depth $Z$) in millimeters.
* **Surface Area:** Sum of triangle cross products:
  $$\text{Area} = \frac{1}{2} \sum_{i=0}^{N-1} \| (\mathbf{v}_{i,1} - \mathbf{v}_{i,0}) \times (\mathbf{v}_{i,2} - \mathbf{v}_{i,0}) \|$$
* **Signed Volume:** Evaluated via divergence theorem:
  $$\text{Volume} = \frac{1}{6} \left| \sum_{i=0}^{N-1} \mathbf{v}_{i,0} \cdot (\mathbf{v}_{i,1} \times \mathbf{v}_{i,2}) \right|$$
  Evaluates to `null` if the mesh is open, non-manifold, or has degenerate triangles.
* **Watertight Topology Analysis:** Counts boundary edges (1 face), non-manifold edges (>2 faces or inconsistent face winding direction), and degenerate triangles.

### 6.2 Transform & Unit Scaler (`/3d/transform`)
* **Capabilities:** Unit presets (in ↔ mm, cm ↔ mm, m ↔ mm), independent axis scaling, Euler XYZ rotation, auto-centering to origin, and grounding to build plate ($Z_{\min} = 0$). Automatically corrects winding on negative determinant reflection.

### 6.3 Normals & Face Winding Reorienter (`/3d/normals`)
* **Capabilities:** Inverts triangle face winding globally by swapping vertex indices `v1` and `v2`.
* **Important Operational Constraints:** Does not automatically fix localized inconsistent face winding across shared edges, and does not fill holes or repair open seams. Exporters write positions and faces only without smoothing records.

### 6.4 Disconnected Component Splitter (`/3d/split`)
* **Capabilities:** Decomposes multi-part models into independent component meshes using Disjoint-Set Union (Union-Find) across triangle connectivity. Components can be downloaded individually or as a ZIP archive.

### 6.5 Mesh Merger (`/3d/merge`)
* **Capabilities:** Combines multiple 3D models into a unified container mesh by concatenating vertex buffers and offsetting index buffers.
* **Important Operational Constraints:** Flattens geometry buffers only; does not perform CSG Boolean union operations (no seam welding or intersection carving).

---

## 7. Package Versions, Licensing & Bundle Strategy

| Package | Shipped Version | License | Bundle Impact | Loading Method | Role in Loconvert |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `three` | `^0.186.1` | MIT | ~140 KB gzip (core + loaders) | Lazy dynamic import per tool | 3D rendering, PLYLoader, math helpers |
| `meshoptimizer` | `^1.3.0` | MIT | ~35 KB JS + ~50 KB WASM | Lazy dynamic import in mesh worker | Edge-collapse polygon decimation engine |
| `occt-import-js` | `^0.0.23` | LGPL-2.1 | ~96 KB JS + 7.3 MB WASM (2.4 MB gzip) | Lazy dynamic import in CAD worker | B-Rep CAD parsing and tessellation |
| `jszip` | `^3.10.2` | MIT / GPLv3 | 0 KB added (already in project) | Existing shared module | 3MF archive extraction/packaging & component ZIPs |
| `fast-xml-parser` | `^5.3.3` | MIT | Lightweight XML parser | Bundled in mesh worker | 3MF XML model parsing without DOMParser |

### 7.1 Licensing Compliance (LGPL-2.1 for `occt-import-js`)
* The WASM binary `occt-import-js.wasm` is shipped as a separate, unmodified binary asset.
* The JavaScript wrapper is dynamically loaded at runtime in a Web Worker.

---

## 8. Implementation Roadmap vs. Shipped Scope

### Phase 1: Core Mesh Format Converter & Simplifier (High Feasibility) — *Shipped*
- Seven routes under `/3d/`: `/3d/convert`, `/3d/simplify`, `/3d/inspect`, `/3d/transform`, `/3d/normals`, `/3d/split`, `/3d/merge`.
- Bi-directional conversion between STL, OBJ, PLY, and 3MF.
- WASM polygon decimation via `meshoptimizer` with error and border bounds.
- Real-time WebGL2 3D viewport with Z-up coordinate alignment and orbit controls.

### Phase 2: CAD STEP Importer Pipeline — *Shipped*
- Dedicated Web Worker executing `occt-import-js` OpenCASCADE WASM.
- Tessellation of STEP, IGES, and BREP models into normalized millimeter meshes.
- Geometry flattening of multi-part CAD assemblies.
