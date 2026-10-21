# Loconvert 3D Mesh & CAD Tools Specification

## 1. Architectural Overview & Privacy Model

Loconvert's 3D subsystem provides comprehensive, client-side 3D model inspection, repair, transformation, simplification, and conversion directly in the web browser.

In strict adherence to Loconvert's privacy principles:
- **100% Client-Side Execution:** User files never leave the browser. All geometry parsing, mesh generation, topology analysis, decimation, and binary serialization execute in local memory.
- **Zero Remote Telemetry & Network Isolation:** No analytics, external APIs, or cloud conversion backends are contacted. All runtime dependencies and WebAssembly binaries (`occt-import-js.wasm`, `meshoptimizer`) are bundled locally and served from the application origin (`'self'`) under the strict Content Security Policy defined in `index.html`.
- **Worker Thread Isolation:** Compute-intensive operations (CAD tessellation, polygon decimation, topology analysis, and archive parsing) run in dedicated background Web Workers (`mesh.worker.ts`, `cad.worker.ts`), preventing main UI thread stutter and maintaining a 60fps responsive interface.
- **WebGL2 Local Viewport:** 3D rendering uses Three.js over hardware-accelerated WebGL2 with a Z-up coordinate convention, procedural lighting, and double-sided rendering. No external environment maps, remote fonts, or textures are loaded.

---

## 2. Shipped Tool Family & Routes

The 3D family comprises seven dedicated routes registered under the `3d` media type in `src/tools/registry.ts`:

| Route | Tool ID | Category | Title | Popular | Key Capabilities |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`/3d/convert`** | `three-convert` | `3d-format` | 3D Format Converter | Yes | Bidirectional conversion between STL, OBJ, PLY, and 3MF; CAD (STEP, IGES, BREP) import to mesh. |
| **`/3d/simplify`** | `three-simplify` | `3d-edit` | 3D Mesh Simplifier & Decimator | Yes | Edge-collapse polygon reduction via `meshoptimizer` WASM; target bounded by error and border locks; vertex compaction. |
| **`/3d/inspect`** | `three-inspect` | `3d-inspect` | 3D Mesh Inspector & Topology Analyzer | Yes | Physical bounding box, surface area, signed volume (divergence theorem), watertightness, and non-manifold/boundary edge counts. |
| **`/3d/transform`** | `three-transform` | `3d-edit` | 3D Mesh Transform & Unit Scaler | No | Scale (uniform/axes), unit presets (in ↔ mm, cm ↔ mm, m ↔ mm), Euler XYZ rotation, auto-centering, and grounding (min Z = 0). |
| **`/3d/normals`** | `three-normals` | `3d-edit` | 3D Face Winding & Normals Inverter | No | Global face winding reversal (`[v0, v1, v2] → [v0, v2, v1]`) to fix inverted normals and slicing artifacts. |
| **`/3d/split`** | `three-split` | `3d-edit` | 3D Mesh Component Splitter | No | Decomposes disconnected shells into separate component meshes using Union-Find topology partitioning; individual or ZIP download. |
| **`/3d/merge`** | `three-merge` | `3d-edit` | 3D Mesh Merger | No | Combines and flattens multiple 3D models into a single unified mesh container buffer. |

---

## 3. Supported Formats & Engine Capabilities

### 3.1 Format Matrix

| Format | Extension | Import Engine | Export Engine | Capabilities & Notes |
| :--- | :--- | :--- | :--- | :--- |
| **STL** | `.stl` | Built-in parser (`parseSTL`) | Built-in exporter (`exportSTL`) | Binary and ASCII auto-detection; welding of unindexed vertices; binary export with per-triangle facet normals. |
| **OBJ** | `.obj` | Built-in parser (`parseOBJ`) | Built-in exporter (`exportOBJ`) | Wavefront OBJ; handles positive/negative vertex indices and fan polygon triangulation; exports vertex positions (`v`) and faces (`f`). |
| **PLY** | `.ply` | `PLYLoader` (Three.js) | Built-in exporter (`exportPLY`) | Binary and ASCII support; unindexed triangle soups automatically welded; exports standard ASCII vertex/face list. |
| **3MF** | `.3mf` | Built-in parser (`parse3MF`) via `JSZip` + `fast-xml-parser` | Built-in writer (`export3MF`) via `JSZip` | Standard OPC ZIP package; parses XML geometry, build instances, and component transform hierarchies; exports compliant 3MF ZIP. |
| **STEP** | `.step`, `.stp` | `occt-import-js` (OpenCASCADE WASM) | *None* (Import only) | Analytic B-Rep parsing and deflection-based tessellation into indexed triangular mesh. |
| **IGES** | `.iges`, `.igs` | `occt-import-js` (OpenCASCADE WASM) | *None* (Import only) | Traditional CAD surface and solid import via OpenCASCADE `ReadIgesFile`. |
| **BREP** | `.brep` | `occt-import-js` (OpenCASCADE WASM) | *None* (Import only) | Native OpenCASCADE Boundary Representation solid model import via `ReadBrepFile`. |

### 3.2 Explicit Scope Boundaries & Constraints

1. **No glTF / GLB Support Implemented:**
   - The shipped 3D toolset focuses strictly on manufacturing, 3D printing, and CAD exchange formats (STL, OBJ, PLY, 3MF, STEP, IGES, BREP).
   - glTF/GLB import and export are not implemented in the current 3D engine.
2. **No STEP Output in Selected Engine:**
   - Loconvert's CAD engine is `occt-import-js` (v0.0.23), which is a lightweight, read-only tessellation library.
   - *Note on browser CAD export:* Exporting CAD from the browser is not universally impossible in principle—heavier OpenCASCADE distributions (such as `replicad` or full `opencascade.js` builds) can technically serialize B-Rep solids in WebAssembly. However, those runtimes require 23–49 MB WASM downloads and massive memory footprints. Furthermore, converting polygonal meshes to STEP results in "Faceted B-Rep" files (where every triangle is a separate planar face), causing severe file bloat (e.g. 50k triangles → ~50 MB STEP) that crashes desktop CAD systems without providing editable parametric features. For these reasons, CAD output is omitted.
3. **Geometry-Only Processing:**
   - All tools process and output geometric topology only (vertex coordinates and face indices).
   - Materials, textures, PBR maps, UV coordinates, animations, and vertex colors are ignored during import and are omitted from exported files.
4. **3MF Security & Required Extensions Rejection:**
   - 3MF archives declaring `@_requiredextensions` or `@_RequiredExtensions` (such as volumetric extensions, slice extensions, or custom vendor namespaces) are explicitly rejected with an informative error.
   - External relationships (`TargetMode="External"` or URI scheme targets) are explicitly blocked to prevent SSRF and security risks.
5. **Units Handling & Normalization:**
   - **Unitless formats (STL, OBJ, PLY):** Assumed to be in **millimeters (mm)** by default.
   - **Declared-unit formats (3MF, CAD):** Normalized to **millimeters (mm)** upon import:
     - 3MF unit attributes (`micron` = 0.001, `millimeter` = 1.0, `centimeter` = 10.0, `inch` = 25.4, `foot` = 304.8, `meter` = 1000.0) are scaled to mm.
     - CAD imports via `occt-import-js` enforce `linearUnit: 'millimeter'`.

---

## 4. Operational Realities & Processing Mechanics

### 4.1 Mesh Simplifier (`/3d/simplify`)
- **Engine:** `MeshoptSimplifier.simplify` from `meshoptimizer` compiled to WebAssembly.
- **Bounded Target Decimation:** The user specifies a retention ratio (1% to 100%), error tolerance, and border lock option. The simplification algorithm performs quadric error metric (QEM) edge collapses. **The achieved target is bounded by the error tolerance and border lock constraints**—the engine stops early if further edge collapses would exceed the maximum allowable error or distort boundary edges.
- **Vertex Compaction:** Decimation produces a sparse index buffer referencing original vertices. The tool builds a remapping table to strip unreferenced coordinates, producing tightly packed `positions` and `indices` arrays.
- **Non-destructive Iteration:** Simplification runs against the original model reference to prevent cumulative degradation during parameter adjustments.

### 4.2 Normals & Face Winding Reorienter (`/3d/normals`)
- **Single Orientation Reversal:** Inverts triangle face winding globally across the entire mesh by swapping vertex indices `v1` and `v2` for each triangle:
  $$\text{flippedIndices}[3t + 1] \longleftrightarrow \text{flippedIndices}[3t + 2]$$
- **No Automatic Hole-Filling or Local Stitching:** The tool does not perform automatic mesh repair, hole filling, or localized winding reconciliation between inconsistent adjacent faces.
- **Viewport Smoothing vs. Exported Positions & Faces:**
  - In the 3D viewport (`MeshViewer.tsx`), smooth vertex normals are dynamically computed via Three.js (`computeVertexNormals()`) for realistic WebGL shading.
  - **Exported files do not contain vertex normal smoothing data:** The format exporters (OBJ, PLY, 3MF) serialize only vertex positions and face definitions. Binary STL exporters calculate facet surface normals per triangle face directly from the vertices. The exporters do not write vertex smoothing groups or custom normal vectors.

### 4.3 Mesh Merger (`/3d/merge`)
- **Geometry Buffer Flattening:** Merges multiple `MeshModel` inputs by concatenating position arrays and offsetting index buffers:
  $$\text{indices}_{\text{merged}}[i + \text{offset}] = \text{indices}_k[i] + \text{vertexOffset}_k$$
- **No CSG Boolean Union:** Merging does not perform constructive solid geometry (CSG) Boolean union operations. It combines distinct models into a unified container file without calculating triangle-triangle intersections, carving intersecting cavities, or welding non-coincident seams.

### 4.4 Component Splitter (`/3d/split`)
- **Topological Decomposition:** Uses a Disjoint-Set Union (Union-Find) structure over shared triangle vertices to identify disconnected components.
- **Output:** Decomposes multi-shell meshes into discrete `MeshModel` parts that can be inspected individually, downloaded as separate files, or exported as a compressed ZIP archive via `jszip`.

### 4.5 Mesh Inspector (`/3d/inspect`)
- **Physical Dimensions:** Bounding box $\min$, $\max$, and size ($X, Y, Z$) in millimeters.
- **Surface Area:** Calculated by summing the Euclidean magnitude of the cross product for every triangular face:
  $$\text{Area} = \frac{1}{2} \sum_{i=0}^{N-1} \| (\mathbf{v}_{i,1} - \mathbf{v}_{i,0}) \times (\mathbf{v}_{i,2} - \mathbf{v}_{i,0}) \|$$
- **Signed Volume:** Computed via the Divergence Theorem (summing signed tetrahedral volumes against the origin):
  $$\text{Volume} = \frac{1}{6} \left| \sum_{i=0}^{N-1} \mathbf{v}_{i,0} \cdot (\mathbf{v}_{i,1} \times \mathbf{v}_{i,2}) \right|$$
  - *Volume Nullability:* Volume evaluates to `null` if the mesh is open (has boundary edges), non-manifold, or contains degenerate triangles.
- **Topology Diagnostics:**
  - **Boundary edges:** Edges shared by exactly 1 triangle (open holes / seams).
  - **Non-manifold edges:** Edges shared by $>2$ triangles, or shared by 2 triangles traversing the edge in identical directions (inconsistent face winding).
  - **Degenerate triangles:** Faces with collinear vertices or zero surface area.
  - **Watertightness:** Verified when boundary edges = 0, non-manifold edges = 0, and degenerate triangles = 0.

### 4.6 Transform & Unit Scaler (`/3d/transform`)
- **Execution Order:** Uniform/independent scale $\to$ Euler XYZ rotation (degrees) $\to$ Origin auto-centering $\to$ Grounding to build plate ($Z_{\min} = 0$).
- **Reflection Protection:** If a negative determinant transformation is applied (e.g. negative scale reflection), triangle winding is automatically inverted to preserve outward-facing surface normals.

---

## 5. Client, Worker & Viewport Architecture

### 5.1 Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Main UI Thread (React)                          │
│                                                                        │
│   Tool Page Component (e.g. /3d/convert, /3d/simplify)                 │
│         │                                                              │
│         ├── use3DWorkbench (State, Job ID, Lifecycle, Drag-and-Drop)   │
│         │                                                              │
│         ├── MeshViewer (WebGL2, Three.js, Z-up, OrbitControls, Grid)   │
│         │                                                              │
│         └── Client Façades (src/tools/3d/_mesh/client.ts & _cad/client)│
└────────────┬───────────────────────────────────────────┬───────────────┘
             │                                           │
  Structured Cloning (Zero-Detachment)        Transferable ArrayBuffers
             │                                           │
             ▼                                           ▼
┌──────────────────────────────────────┐   ┌─────────────────────────────┐
│             Mesh Worker              │   │         CAD Worker          │
│      (src/tools/3d/_mesh/worker)     │   │  (src/tools/3d/_cad/worker) │
│                                      │   │                             │
│ • STL / OBJ / PLY / 3MF Parsers      │   │ • occt-import-js WASM       │
│ • meshoptimizer Simplifier (WASM)    │   │ • STEP / IGES / BREP Parser │
│ • Topology & Watertight Analyzer     │   │ • Deflection Tessellation   │
│ • Component Splitter & Merger        │   │ • Assembly Flattening       │
│ • Exporters (STL, OBJ, PLY, 3MF)     │   │ • mm Unit Normalization     │
└──────────────────────────────────────┘   └─────────────────────────────┘
```

### 5.2 Worker Lifecycles & Buffer Safety

1. **Buffer Safety (No Caller Buffer Detachment):**
   - In `src/tools/3d/_mesh/client.ts`, caller-owned `MeshModel` objects (`positions`, `indices`) are communicated to Web Workers via structured cloning rather than `Transferable` buffer ownership transfer.
   - This ensures caller buffers remain active in memory and are never inadvertently detached if a job is cancelled or re-run.
   - Only ephemeral buffers created internally (e.g. raw file `ArrayBuffer` during import) are transferred.
2. **Cancellation Lifecycle:**
   - Both `cancelMeshJobs()` and `cancelCadJobs()` increment internal generation counters and terminate active workers immediately on user cancellation or navigation away, safely clearing pending promise queues.

---

## 6. Runtime Caps & Validation Guardrails

To prevent browser tab crashes, out-of-memory errors, and denial-of-service conditions, strict guardrails are enforced across all 3D tools in `src/tools/3d/_mesh/validation.ts`:

| Guardrail Parameter | Limit | Implementation & Enforcement |
| :--- | :--- | :--- |
| **Max Mesh File Size** | **100 MB** (`MAX_FILE_SIZE_BYTES`) | Checked before reading buffer into memory or posting to worker. |
| **Max CAD File Size** | **25 MB** (`MAX_CAD_FILE_SIZE_BYTES`) | Validated prior to loading into OpenCASCADE WASM heap. |
| **Max Triangle Count** | **1,000,000 triangles** (`MAX_TRIANGLE_COUNT`) | Enforced during parsing, tessellation, and transform pre-checks. |
| **Max Vertex Coordinate Count** | **3,000,000 floats** (`MAX_VERTEX_COUNT`) | Corresponds to 1,000,000 vertices (X, Y, Z). |
| **Max ZIP Uncompressed Size** | **128 MB** (`MAX_ZIP_UNCOMPRESSED_BYTES`) | Checked against declared headers and tracked during streaming extraction. |
| **Max ZIP Entries & Instances** | **10,000 items** (`MAX_ZIP_ENTRY_COUNT`) | Prevents zip bomb recursion and excessive 3MF object instances. |
| **Coordinate Sanity** | Finite numbers only | Coordinates are validated with `Number.isFinite`; non-finite numbers (NaN/Infinity) throw immediately. |
| **Index Bounds Sanity** | $0 \le \text{idx} < \text{vertexCount}$ | Indices exceeding vertex buffer length trigger immediate validation rejection. |
| **Path Traversal Protection** | No `..`, leading `/` or `\` | Forbidden in 3MF and ZIP internal archive paths. |

---

## 7. Design System & UI Integration

- **Media Index:** Navigating to `/3d` renders `MediaIndex` filtered for 3D tools.
- **Design Tokens:** The 3D family uses dedicated theme tokens `--media-3d` and `--media-3d-soft` defined in `src/design/tokens.css`.
- **Navigation & Icons:** Represented by the Lucide `Box` icon in navigation menus, the home page browse grid, and tool cards.
- **Responsive Viewport:** `MeshViewer.tsx` integrates an automatic `ResizeObserver` that dynamically updates aspect ratio and camera projection matrix to fit any screen resolution without distortion.
