# Browser-Based 3D & CAD Processing: Feasibility, Engine Comparison & Architecture

## 1. Executive Summary & Recommended Architecture

Loconvert requires local-only, browser-based 3D processing covering:
- **CAD formats:** STEP (`.step`, `.stp`), IGES (`.iges`, `.igs`), BREP (`.brep`)
- **Mesh formats:** STL (`.stl`), OBJ (`.obj`), PLY (`.ply`), 3MF (`.3mf`)
- **Operations:** Format conversion, polygon simplification (decimation), normal calculation, unit/bounding-box scaling, and inspection.
- **Hard Privacy & Security Constraints:** 100% client-side execution; no remote uploads, no external APIs; no new remote hosts added to Content Security Policy (`index.html`); all WebAssembly binaries bundled locally.

> [!NOTE]
> **Research Evaluation vs. Shipped Production Implementation:**
> This document records the technical evaluation of CAD engines (including `occt-import-js`, `replicad`, and `opencascade.js`). In the final shipped Loconvert implementation:
> - **Seven Real Routes:** Shipped under `/3d/` (`/3d/convert`, `/3d/simplify`, `/3d/inspect`, `/3d/transform`, `/3d/normals`, `/3d/split`, `/3d/merge`).
> - **Supported Formats:** Mesh import/export for STL, OBJ, PLY, and 3MF; CAD import for STEP, IGES, and BREP tessellated to meshes via `occt-import-js`.
> - **No glTF / GLB Support Implemented:** glTF/GLB import and export were explored during research but are not included in the shipped 3D toolset.
> - **No STEP Output in Selected Engine:** The selected engine (`occt-import-js`) is a dedicated read-only tessellator. Browser CAD export is not universally impossible in principle, but full OpenCASCADE write engines require large WASM binaries and converting polygonal meshes to STEP produces bloated, un-editable faceted B-Reps.
> - **Geometry-Only:** Processing operates on geometry only (no materials, textures, colors, or animations).
> - **Units:** Unitless formats (STL, OBJ, PLY) are assumed millimeters; declared units in 3MF/CAD are normalized to millimeters.

### Key Research Findings
1. **STEP Import is Mature & Production-Ready:**
   - **`occt-import-js`** ([v0.0.23](https://github.com/kovacsv/occt-import-js)) is the clear recommended engine for CAD import. It compiles OpenCASCADE Technology (OCCT) via Emscripten into a compact **7.3 MB binary (~7.6 MB decimal, ~2.4 MB gzip)** WASM binary.
   - It reliably reads **STEP, IGES, and BREP** files directly in browser threads and Web Workers, tessellating B-Rep solids into indexed triangular meshes with vertex colors, normals, and part hierarchies.
2. **STEP Export from Mesh is Honestly "Faceted B-Rep" (Un-editable & Bloated):**
   - Polygonal meshes (STL/OBJ/PLY/3MF) contain *only* flat triangles, not analytic surfaces (cylinders, spheres, NURBS, or sketch constraints).
   - Wrapping a mesh into a STEP file via OpenCASCADE creates a **Faceted B-Rep** (`STEPControl_FacetedBrep` or `manifold_solid_brep` where every single triangle becomes a planar `TopoDS_Face`).
   - This creates an exponential entity explosion in STEP ASCII: a modest 50,000-triangle mesh yields >500,000 STEP entities (~40–70 MB file). It crashes or hangs downstream CAD packages (SolidWorks, Fusion 360, FreeCAD) and consumes gigabytes of RAM during boundary sewing in browser WASM.
   - **Verdict:** Mesh-to-STEP conversion should either be strictly avoided or clearly labeled as a lossy, un-editable *"Faceted STEP Wrapper"* capped at low triangle counts (<10k triangles).
3. **STEP-to-STEP Operations are Practical ONLY for Rigid Transforms & Metadata:**
   - Lossless STEP $\to$ STEP is useful for rigid transformations (rotation, translation, scale), coordinate system realignment (Z-up to Y-up), unit conversion (mm $\leftrightarrow$ inches), AP schema migration (AP203 $\leftrightarrow$ AP214/AP242), and metadata scrubbing.
   - Any pipeline that converts STEP $\to$ Mesh $\to$ STEP completely destroys CAD parametric intelligence.
4. **Polygon Simplification is Robust via `meshoptimizer`:**
   - **`meshoptimizer`** ([v1.3.0](https://github.com/zeux/meshoptimizer), MIT) provides a WASM decimation module (`meshoptimizer/simplifier`) with inlined bytecode (<300 KB total package, 0 external `.wasm` files).
   - It performs quadric error metric (QEM) edge collapses with border locking and coplanar preservation, vastly outperforming Three.js's pure-JS `SimplifyModifier`. Achieved reduction is strictly bounded by error tolerance and boundary constraints.
5. **Dual-Tier Architecture:**
   - **CAD Engine:** `occt-import-js` (~7.6 MB WASM, bundled locally and loaded via `?url`, run inside a dedicated Web Worker).
   - **Mesh Pipeline:** Built-in format handlers for STL, OBJ, PLY, and 3MF + `meshoptimizer` for decimation + native `JSZip`-backed 3MF generation.

---

## 2. Comparative Evaluation of Browser CAD & OCCT Engines

Building OpenCASCADE from source with Emscripten produces huge binaries if not aggressively pruned. Here is an evidence-backed comparison of all viable off-the-shelf options:

| Engine / Library | npm Version | License | WASM Size | STEP Import | STEP Export | IGES / BREP | Browser & Worker Suitability | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`occt-import-js`** | `0.0.23` | LGPL-2.1 | **7.3 MB binary** (~7.6 MB dec, 2.4 MB gzip) | **Yes** (Fast, robust) | **No** (Read-only) | **Yes** (Both) | **Excellent** (Small footprint, worker script included) | **Primary CAD Importer (Shipped)** |
| **`replicad`** / `replicad-opencascadejs` | `1.1.0` | MIT / LGPL-2.1 | **22.9 MB** (6.5 MB gzip) | **Yes** (`importSTEP`) | **Yes** (`exportSTEP`) | Partial | **Moderate** (Heavy initial WASM compile, high RAM) | **Evaluated in research; not shipped** |
| **`opencascade.js` (Full)** | `1.1.1` | LGPL-2.1 | **48.9 MB** (9.5 MB gzip) | **Yes** | **Yes** | **Yes** | **Poor** (High compile latency, easily hits browser memory caps) | **Avoid** (Too heavy for general web use) |
| **Custom OCCT Build** | Custom | LGPL-2.1 | 5–15 MB | Configurable | Configurable | Configurable | High maintenance, Docker CI required | **Avoid** (Disallowed by prompt: "Do not spend on custom builds") |

---

### 2.1 Engine Deep-Dive: `occt-import-js`

- **Repository:** [kovacsv/occt-import-js](https://github.com/kovacsv/occt-import-js)
- **Author:** Viktor Kovacs (creator of [Online 3D Viewer](https://3dviewer.net))
- **npm Package:** `occt-import-js` (v0.0.23, unpacked size: 11.6 MB)
- **Included Dist Assets:**
  - `dist/occt-import-js.js`: 96.8 KB (Emscripten JavaScript glue)
  - `dist/occt-import-js.wasm`: 7.3 MB binary / ~7.6 MB decimal (compiled C++ binary)
  - `dist/occt-import-js-worker.js`: 318 B (standalone Web Worker entry)
- **C++ Core Capabilities:**
  - Internally links `TKSTEP`, `TKIGES`, `TKMesh`, and `TKBRep`.
  - Exposes `ReadFile(format, buffer, params)`, `ReadStepFile`, `ReadIgesFile`, and `ReadBrepFile`.
  - Automatically manages B-Rep boundary parsing and tessellation via OCCT's `BRepMesh_IncrementalMesh`.
- **Tessellation Parameters:**
  - `linearDeflectionType`: `"bounding_box_ratio"` (default) or `"absolute_value"`.
  - `linearDeflection`: Chordal tolerance. Default is `0.001` of bounding box diagonal.
  - `angularDeflection`: Angular deviation in radians (default: ~0.5 rad / 28°).
  - `linearUnit`: Normalizes coordinates to `"millimeter"`, `"centimeter"`, `"meter"`, `"inch"`, or `"foot"`.
- **Returned Data Structure:**
  ```ts
  interface OcctMesh {
    name: string;
    attributes: {
      position: { array: Float32Array | number[] };
      normal?: { array: Float32Array | number[] };
    };
    index: { array: Uint32Array | number[] };
    color?: [number, number, number]; // RGB 0.0 - 1.0
    brep_faces: Array<{
      first: number; // triangle index offset
      last: number;
      color: [number, number, number] | null;
    }>;
  }
  interface OcctResult {
    success: boolean;
    root: { name: string; meshes: number[]; children: any[] };
    meshes: OcctMesh[];
  }
  ```
- **Limitations:**
  - Does **NOT** support writing or exporting STEP files in the selected engine.
  - Returns discrete triangulated meshes; does not expose live C++ B-Rep shape handles (`TopoDS_Shape`) to JS.

---

### 2.2 Engine Deep-Dive: `replicad` & `replicad-opencascadejs` (Evaluated)

- **Repository:** [sgenoud/replicad](https://github.com/sgenoud/replicad)
- **npm Packages:** `replicad` (v1.1.0, MIT) and `replicad-opencascadejs` (v1.1.0, LGPL-2.1)
- **Architecture:** Replicad publishes pre-built, pruned builds of `opencascade.js`:
  - `dist/replicad_single.wasm`: 22.9 MB uncompressed.
  - Provides high-level TypeScript wrappers around OCCT topology.
- **STEP Export Mechanism:**
  - Uses `STEPCAFControl_Writer` with schema AP214 / AP242 (`write.step.schema = 5`).
  - Supports part naming, assembly hierarchy, and body colors.
  - Uses Emscripten virtual MEMFS (`oc.FS.writeFile` / `oc.FS.readFile`).
- **Memory & Latency Overhead:**
  - 22.9 MB WASM takes substantial time to compile on first load and requires ~150 MB heap space.
  - Omitted from production Loconvert to maintain lightweight asset payloads and avoid memory exhaustion.

---

## 3. The Reality of CAD vs. Mesh Conversion

### 3.1 Is Mesh $\to$ STEP Feasible?

**The short answer: Technically yes as a Faceted B-Rep in engines with CAD writers; practically unviable and misleading as "CAD".**

#### The Fundamental Geometric Mismatch
- **CAD Representation (B-Rep):** Uses exact analytic math. A cylinder is defined by an axis vector $\vec{A}$, radius $R$, and two planar clipping bounds. An edge is an analytic curve with mathematical continuity ($C^1/C^2$).
- **Mesh Representation:** A collection of flat facets (discrete approximation). A cylinder is broken into 500 flat triangles with interpolated vertex normals.

#### What OpenCASCADE Does During Mesh $\to$ STEP
In OpenCASCADE (e.g. `replicad`'s `importSTL` or OCCT's `StlAPI_Reader`), converting an STL to a solid follows this pipeline:
```mermaid
flowchart LR
    A["Triangular Mesh (STL/OBJ)"] --> B["BRepBuilderAPI_MakeFace<br>(1 planar face per triangle)"]
    B --> C["BRepBuilderAPI_Sewing<br>(O(N log N) edge stitching)"]
    C --> D["ShapeUpgrade_UnifySameDomain<br>(Attempt coplanar merge)"]
    D --> E["BRepBuilderAPI_MakeSolid<br>(Check watertight shell)"]
    E --> F["STEPControl_Writer<br>(Faceted B-Rep)"]
```
1. Each triangle is converted into a planar `TopoDS_Face` with 3 linear `TopoDS_Edge` curves and 3 `TopoDS_Vertex` points.
2. `BRepBuilderAPI_Sewing` compares all vertices and edges within a tolerance (e.g. $10^{-4}$) to stitch them into a `TopoDS_Shell`.
3. If watertight, `BRepBuilderAPI_MakeSolid` wraps the shell into a `TopoDS_Solid`.
4. `STEPControl_Writer` writes the geometry as `STEPControl_FacetedBrep` or `STEPControl_ManifoldSolidBrep`.

#### Why Faceted STEP Files Fail in Practice
1. **No Parametric Intelligence:** Downstream CAD tools (SolidWorks, Inventor, Fusion 360) do **not** recognize cylinders, holes, or fillets. The user cannot edit the radius, modify extrusion depths, or extract sketches. It is treated as an uneditable "dumb mesh" encased in STEP formatting.
2. **Explosive File Bloat:**
   - In binary STL, a triangle takes 50 bytes.
   - In ASCII STEP, every facet requires distinct entities: `CARTESIAN_POINT`, `VERTEX_POINT`, `LINE`, `EDGE_CURVE`, `ORIENTED_EDGE`, `EDGE_LOOP`, `FACE_OUTER_BOUND`, and `ADVANCED_FACE`.
   - **Empirical Ratio:** 10,000 triangles $\approx$ 15 MB STEP file (~30x expansion). A standard 100,000-triangle STL produces a >150 MB STEP file.
3. **Browser Memory Exhaustion & Sewing Failures:**
   - Sewing 50,000+ faces in 32-bit WASM takes significant time and often causes `Out of Memory` errors.
   - Non-watertight or dirty meshes (self-intersections, T-junctions, duplicate vertices) cause sewing to fail, producing an un-solid compound of disconnected sheets.

**Recommendation:** Do not market or build a general "Mesh $\to$ STEP" tool under the guise of CAD conversion. No STEP output is implemented in Loconvert's selected engine (`occt-import-js`), avoiding both heavy runtime footprints and misleading faceted output.

---

### 3.2 Is STEP $\to$ STEP Useful?

**Yes, but strictly for operations that remain entirely within the B-Rep domain.**

| Operation | Feasible in Browser? | Engine Evaluated | Lossless CAD Fidelity? | Utility |
| :--- | :--- | :--- | :--- | :--- |
| **Rigid Transform (Translate / Rotate)** | Yes | `replicad` / OCCT | **Yes (100%)** | Re-orient part (Z-up to Y-up, align to build plate). |
| **Uniform Scale / Unit Conversion** | Yes | `replicad` / OCCT | **Yes (100%)** | Fix scale mismatches (e.g. mm to inches or 0.001x factor). |
| **Schema Upgrade / Downgrade** | Yes | `replicad` / OCCT | **Yes (100%)** | Upgrade legacy AP203 to AP214/AP242 (with colors & layers). |
| **Assembly Merge / Compounding** | Yes | `replicad` / OCCT | **Yes (100%)** | Combine multiple STEP files into a single compound. |
| **Metadata Stripping / Anonymization**| Yes | Plain JS Regex | **Yes (100%)** | Scrub author, software, organization, and timestamps from STEP header. |
| **STEP Inspection (Volume, Bounding Box)**| Yes | `occt-import-js` / OCCT | **Yes** | Measure dimensions, mass properties, and check hierarchy without downloading desktop CAD. |
| **STEP $\to$ Mesh $\to$ STEP** | **No** | Three.js + OCCT | **Destructive (0%)** | Destroys all analytic curves; converts everything to faceted triangles. |

---

### 3.3 Favor Reliable STEP $\to$ Mesh First

The most common, high-demand user workflow is **converting proprietary CAD (STEP/STP/IGES) into lightweight, web- and 3D-printing-ready mesh formats (STL, OBJ, 3MF)**.
- `occt-import-js` executes this deterministically and reliably.
- It allows users to control chordal deflection (`linearDeflection`) and angular deflection (`angularDeflection`), enabling a direct trade-off between visual smoothness and polygon count.
- The output meshes can be directly fed into Three.js for 3D viewport previewing or exported to STL/OBJ/3MF.

---

## 4. Mesh Formats & Polygon Simplification

### 4.1 Format Support Matrix & Exporter Mechanics

| Format | Read (Import) Method | Write (Export) Method | Notes |
| :--- | :--- | :--- | :--- |
| **STL (`.stl`)** | Built-in binary/ASCII parser (`parseSTL`) | Built-in binary exporter (`exportSTL`) | Binary is preferred (compact 50 bytes/tri). Welds coincident vertices on import. |
| **OBJ (`.obj`)** | Built-in text parser (`parseOBJ`) | Built-in text exporter (`exportOBJ`) | Text-based, supports positive/negative indices, exports positions and faces only. |
| **PLY (`.ply`)** | Three.js `PLYLoader` | Built-in ASCII exporter (`exportPLY`) | ASCII and binary import; welds unindexed meshes; exports positions and faces. |
| **3MF (`.3mf`)** | Built-in parser (`parse3MF`) via `JSZip` + `fast-xml-parser` | Built-in writer (`export3MF`) via `JSZip` | 3MF is an OPC ZIP containing XML (`3D/3dmodel.model`). Rejects required extensions. |
| **STEP (`.step`)** | `occt-import-js` (via Web Worker) | *None* | Read is rock solid (~7.6 MB WASM). Write is omitted in production engine. |
| **IGES (`.iges`)** | `occt-import-js.ReadIgesFile` | *None* | Read is fully supported via OpenCASCADE. |
| **BREP (`.brep`)** | `occt-import-js.ReadBrepFile` | *None* | Native OpenCASCADE boundary representation text format; read supported. |

---

### 4.2 Polygon Simplification: `meshoptimizer` vs. `SimplifyModifier`

When users convert STEP or high-res 3D scans, models often contain hundreds of thousands of polygons. A decimation tool is critical.

#### Comparison:
- **Three.js `SimplifyModifier`:**
  - Written in pure JavaScript.
  - Uses basic edge-collapse with $O(N^2)$ worst-case search.
  - Very slow: simplifying high-poly meshes freezes the browser tab.
  - Lacks boundary constraints (often chews away open borders and destroys seams).
- **`meshoptimizer` ([v1.3.0](https://github.com/zeux/meshoptimizer), MIT by Arseny Kapoulkine):**
  - Compiled C++ to WASM with embedded bytecode (<300 KB total).
  - Uses linear-time Quadric Error Metric (QEM) edge collapse.
  - Bounded Reduction: Decimation ratio is strictly bounded by error tolerance and boundary locking flags (`LockBorder`), stopping early if further reduction would violate geometric constraints.
  - Features:
    - `LockBorder`: Prevents open edges / seams from contracting.
    - Direct typed array I/O (`Uint32Array` indices, `Float32Array` positions).
    - Compacts unreferenced vertices after decimation.

**Recommendation:** Exclusively adopt `meshoptimizer` (`MeshoptSimplifier.simplify`) for all polygon decimation.

---

## 5. Technical Integration Specifications for Loconvert

### 5.1 CSP Compliance & Local Asset Packaging

Loconvert's Content Security Policy in `index.html`:
```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self' blob: data: ws: wss: https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net; media-src 'self' blob: data:; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none';"
/>
```

#### Verification against Loconvert Privacy Rules:
1. **WASM Execution:** `script-src 'self' 'wasm-unsafe-eval' blob:;` permits WebAssembly compilation via `WebAssembly.instantiate` and Emscripten modules.
2. **Local Packaging:**
   - Bundled via Vite asset emission (`import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url'`).
   - Served from the local application origin (`'self'`).
   - Do **NOT** fetch WASM from external CDNs.
3. **No External Network Calls:** Parsing, meshing, and conversion run 100% in-memory via `ArrayBuffer` and `Blob`.

---

### 5.2 Dedicated Web Worker Implementation

To guarantee a 60fps responsive UI, CAD parsing runs in a dedicated Web Worker (`cad.worker.ts`) and mesh operations run in `mesh.worker.ts`.

---

## 6. Feasible Conversion & Operation Matrix

| Source Format | Target Format | Viability | Tooling | Performance / Caveats |
| :--- | :--- | :--- | :--- | :--- |
| **STEP / STP** | **STL / OBJ / PLY / 3MF** | **Shipped** | `occt-import-js` $\to$ Exporters | High accuracy, user-selectable deflection. |
| **IGES / IGS** | **STL / OBJ / PLY / 3MF** | **Shipped** | `occt-import-js.ReadIgesFile` | Uses identical meshing pipeline as STEP. |
| **BREP** | **STL / OBJ / PLY / 3MF** | **Shipped** | `occt-import-js.ReadBrepFile` | Direct OCCT B-Rep support. |
| **STL** | **OBJ / PLY / 3MF** | **Shipped** | Built-in parsers/exporters | In-memory format conversion. |
| **OBJ** | **STL / PLY / 3MF** | **Shipped** | Built-in parsers/exporters | In-memory format conversion. |
| **PLY** | **STL / OBJ / 3MF** | **Shipped** | Three.js `PLYLoader` $\to$ Exporters | In-memory format conversion. |
| **3MF** | **STL / OBJ / PLY** | **Shipped** | Built-in parsers/exporters | In-memory format conversion. |
| **Any Mesh** | **Mesh Simplification** | **Shipped** | `meshoptimizer` | WASM QEM decimation, locks boundaries. |
| **STEP** | **STEP (Transform)** | **Research Evaluated** | `replicad` B-Rep transform | Requires 23 MB WASM; not shipped in production. |
| **Mesh (STL/OBJ)** | **STEP** | **Discouraged** | `replicad.importSTL` $\to$ `exportSTEP` | Creates bloated Faceted B-Rep; not shipped in production. |

---

## 7. Reference Documentation

For complete details on Loconvert's shipped 3D tool implementation, refer to:
- [Loconvert 3D Tools Specification](3d-tools.md)
