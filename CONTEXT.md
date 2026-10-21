# Loconvert Developer & Agent Context

## Privacy Rule (Hard Requirement)
**User files never leave the browser.**
- No file uploads, no external APIs, no remote processing, no analytics.
- Client libraries, static assets, and AI model weights may be downloaded from allowable CDNs/Hugging Face as permitted by CSP.
- All media transcoding, analysis, and generation must execute 100% locally on-device via WebAssembly / WebCodecs / WebGPU / in-browser JS.
- Do not add remote hosts to the CSP in `index.html`.

## Tool Scope & Collaboration Contract
- **Isolation:** Each tool lives strictly within its own folder.
  - File tools: `src/tools/<slug>/Tool.tsx` (registry id is `<slug>`, route is `/<slug>`).
  - Video tools: `src/tools/<id>/Tool.tsx` (registry id is `<id>`, route is `/video/<id>`).
  - Image tools: `src/tools/image/<slug>/Tool.tsx` (registry id is `img-<slug>`, route is `/image/<slug>`).
  - PDF tools: `src/tools/pdf/<slug>/Tool.tsx` (registry id is `pdf-<slug>`, route is `/pdf/<slug>`).
  - 3D tools: `src/tools/3d/<slug>/Tool.tsx` (registry id is `three-<slug>`, route is `/3d/<slug>`).
- Shared modules for a group of tools live in `src/tools/<media>/_<group>/` (for example `image/_pdf`, `image/_convert`, `pdf/_pages`, `pdf/_qpdf`, `pdf/_render`, `3d/_mesh`, `3d/_cad`, `3d/_ui`).
- **Tool styling:** Follow the design system (`docs/design-system.md`, live at `/design`). Use shared components from `src/components`, global classes from `src/design/components.css`, and semantic tokens from `src/design/tokens.css`. A local `Tool.module.css` is for tool-specific layout only: no hex colours, no legacy `--color-*` variables, and no `@media (prefers-color-scheme)`.
- **Protected Files:** Sub-agents must not edit shared files outside their assigned scope.

## Folder Layout
```
loconvert/
├── index.html              # HTML entry point with Content-Security-Policy
├── package.json            # Project dependencies & scripts
├── tsconfig.json           # Strict TypeScript configuration
├── vite.config.ts          # Vite build configuration (ffmpeg excluded from optimizeDeps)
├── assets/                 # Shared project assets (e.g. icon.svg)
├── public/                 # Static files served by Vite
├── src/
│   ├── main.tsx            # Application entry
│   ├── App.tsx             # Router: /, /file, /video, /image, /pdf, /3d, tool routes & redirects
│   ├── styles.css          # Imports design layers + app shell/page layouts
│   ├── design/             # Design system: tokens.css, base.css, components.css, theme.ts, media.ts
│   ├── components/         # Shared UI components
│   │   ├── BatchResults.tsx    # Multi-file results list with per-file and ZIP download
│   │   ├── CategorySections.tsx# Tools of one media grouped by category
│   │   ├── CommandPalette.tsx # ⌘K tool search
│   │   ├── Controls.tsx    # Button, Field, Input, Textarea, Select, Slider, Checkbox, Switch, SegmentedControl, Badge, Alert, Kbd, MediaTile
│   │   ├── FileDrop.tsx    # Drag-and-drop file upload zone
│   │   ├── Layout.tsx      # Header with mega menus, search, theme toggle, mobile nav, footer
│   │   ├── ProgressBar.tsx # Standardized progress indicator
│   │   ├── ResultPanel.tsx # Output preview, stats, download, and reset triggers
│   │   ├── ToolGrid.tsx    # Responsive grid of tool cards
│   │   └── ToolPage.tsx    # Consistent wrapper for tool pages + "More tools" grid
│   ├── lib/                # Shared utilities & hooks
│   │   ├── download.ts     # downloadBlob()
│   │   ├── ffmpeg.ts       # getFFmpeg(), runFFmpeg(), mimeFromName()
│   │   ├── format.ts       # formatBytes(), formatDuration(), replaceExt(), withSuffix()
│   │   ├── handoff.ts      # Home-page file handoff to tool FileDrops, accept matching, tool suggestions
│   │   ├── search.ts       # searchTools() ranking for the palette and index filters
│   │   ├── image.ts        # Image decode/encode helpers
│   │   ├── jxl.ts          # JPEG XL WASM client, encode/decode, preview fallback
│   │   ├── jxl.worker.ts   # Dedicated worker for @jsquash/jxl
│   │   ├── media.ts        # getVideoMeta()
│   │   ├── pdf.ts          # loadPdfjs()
│   │   ├── useJob.ts       # useJob() lifecycle & progress management hook
│   │   ├── useObjectUrl.ts # useObjectUrl() hook managing lifecycle of Blob/File URLs
│   │   └── zip.ts          # zipFiles()
│   ├── pages/
│   │   ├── Home.tsx        # Hero, drop-any-file suggestions, popular tools, browse by type
│   │   ├── MediaIndex.tsx  # /file, /video, /image, /pdf, /3d pages with filter + category chips
│   │   └── DesignSystem.tsx# /design living style guide
│   └── tools/
│       ├── registry.ts     # Tool registry definitions, categories & lookup helpers
│       ├── file-converter/ # Universal file format converter (Tool.tsx)
│       ├── <slug>/         # Top-level file tools (txt-to-csv, csv-viewer, etc.)
│       ├── image/          # Image tools (img-<slug>)
│       ├── pdf/            # PDF tools (pdf-<slug>)
│       ├── 3d/             # 3D mesh & CAD tools (three-<slug>)
│       │   ├── _mesh/      # Shared mesh worker, formats (STL/OBJ/PLY/3MF), topology, simplify
│       │   ├── _cad/       # Shared CAD worker & client (occt-import-js OpenCASCADE WASM)
│       │   ├── _ui/        # Shared 3D workbench, MeshViewer WebGL viewport, controls
│       │   ├── convert/    # 3D Format Converter (/3d/convert)
│       │   ├── simplify/   # 3D Mesh Simplifier & Decimator (/3d/simplify)
│       │   ├── inspect/    # 3D Mesh Inspector & Topology Analyzer (/3d/inspect)
│       │   ├── transform/  # 3D Mesh Transform & Unit Scaler (/3d/transform)
│       │   ├── normals/    # 3D Normals & Face Winding Reorienter (/3d/normals)
│       │   ├── split/      # 3D Mesh Component Splitter (/3d/split)
│       │   └── merge/      # 3D Mesh Merger (/3d/merge)
│       └── <id>/           # Video tools (compress, trim, etc.)
```

## Tool Registry Contract (`src/tools/registry.ts`)
Every tool has one entry in `TOOL_METAS` (built with `fileTool(...)`, `video(...)`, `image(...)`, `pdf(...)`, or `three(...)` helpers). `tools: ToolDef[]` adds the lazy component, resolved via `import.meta.glob`. Tool components are exported as `default`.

```ts
export type Media = 'video' | 'image' | 'pdf' | 'file' | '3d';

interface ToolMeta {
  id: string;            // file: slug ('txt-to-csv'); video: id ('compress'); image: 'img-<slug>'; pdf: 'pdf-<slug>'; 3d: 'three-<slug>'
  slug: string;          // URL segment and folder name
  media: Media;
  path: string;          // '/<slug>' for file; '/video/<id>'; '/image/<slug>'; '/pdf/<slug>'; '/3d/<slug>'
  title: string;
  description: string;   // one sentence
  icon: string;          // emoji
  category: CategoryId;
  tags: string[];
  popular?: boolean;
}
interface ToolDef extends ToolMeta { component: LazyExoticComponent<ComponentType> }
```

Exports: `categories`, `TOOL_METAS`, `tools`, `getToolMeta(id)`, `toolsByMedia(media)`, `toolsByCategory(categoryId)`, `toolsByTag(tag)`, `allTags()`.

### Routes
- `/`: Home (includes promoted universal converter and category sections).
- `/file`, `/video`, `/image`, `/pdf`, `/3d`: Category-grouped indexes.
- `/design`: Design system reference.
- `/<slug>`: File tools (e.g. `/file-converter`, `/csv-viewer`, `/mhtml-to-html`, `/gpx-kml`, `/batch-rename`, `/file-inspector`, `/video-health`, `/css-viewer`, `/txt-to-csv`, `/json-csv`).
- `/video/<id>`: Video tools.
- `/image/<slug>`: Image tools.
- `/pdf/<slug>`: PDF tools.
- `/3d/<slug>`: 3D mesh & CAD tools (`/3d/convert`, `/3d/simplify`, `/3d/inspect`, `/3d/transform`, `/3d/normals`, `/3d/split`, `/3d/merge`).
- Legacy `/<id>`: Redirects to `/video/<id>`.

### Categories
| Media | Id | Title | Description |
| --- | --- | --- | --- |
| file | `file-convert` | Format converters | Convert between file formats including MHTML, GPX and KML |
| file | `file-data` | Data & spreadsheets | Convert, inspect, and view CSV, JSON, and text spreadsheets |
| file | `file-utility` | File utilities | Inspect file headers, verify hashes, rename files and check video health |
| video | `video-edit` | Edit | Trim, crop, loop, speed up, resize, merge and overlay videos |
| video | `video-convert` | Convert & compress | Change video formats and shrink file sizes |
| video | `video-audio` | Audio | Extract, remove, boost or add audio tracks |
| video | `video-ai` | AI | Transcripts, subtitles and background removal with on-device AI |
| video | `video-utility` | Utilities | Inspect media files and calculate playback speeds |
| image | `image-optimize` | Resize & compress | Make images smaller in dimensions or file size |
| image | `image-convert` | Format converters | Convert between JPG, PNG, WEBP, GIF, BMP, AVIF, JXL and more |
| image | `image-edit` | Editing | Crop, adjust, annotate, watermark, blur, and remove backgrounds |
| image | `image-transform` | Transform & layout | Rotate, flip, round, pad, merge and build collages |
| image | `image-effects` | Effects | Sketch, grayscale, invert and meme effects |
| image | `image-pdf` | PDF & documents | Turn images, PDFs and Word files into each other |
| image | `image-social` | Social media | Presets for covers, banners, stories, thumbnails and avatars |
| image | `image-bulk` | Bulk processing | Resize, compress and convert many images at once |
| image | `image-color` | Colour | Pick colours, build palettes and check contrast |
| image | `image-metadata` | Metadata & developer | EXIF data, favicons and Base64 encoding |
| image | `image-generate` | Generators | Create QR codes, barcodes and printable labels |
| pdf | `pdf-organize` | Organize | Merge, split, reorder, and remove pages |
| pdf | `pdf-optimize` | Optimize | Compress, repair, and OCR scanned PDFs |
| pdf | `pdf-to` | Convert to PDF | Turn images, Word, Excel, PowerPoint, and HTML into PDF |
| pdf | `pdf-from` | Convert from PDF | Turn PDFs into images, Word, Excel, PowerPoint, and Markdown |
| pdf | `pdf-edit` | Edit | Rotate, crop, number, watermark, annotate, and fill forms |
| pdf | `pdf-security` | Security | Lock, unlock, sign, redact, and compare PDFs |
| pdf | `pdf-ai` | AI | Summarize and translate PDFs with on-device AI |
| 3d | `3d-format` | Format | Convert between 3D model formats |
| 3d | `3d-edit` | Edit | Simplify, transform, reorient, split and merge 3D models |
| 3d | `3d-inspect` | Inspect | Measure dimensions, volume, area and inspect mesh topology |

## Shared Library APIs (`src/lib` & `src/tools/3d`)

### `src/lib/jxl.ts`
- `isJxlSignature(bytes: Uint8Array): boolean`: Recognizes raw codestream `0xFF 0x0A` and 12-byte container signatures.
- `isJxlFile(blob: Blob): Promise<boolean>`: Content-based detection independent of filename or MIME type.
- `decodeJxl(buffer): Promise<ImageData>`: Offloads decoding to `jxl.worker.ts`.
- `decodeJxlToCanvas(buffer): Promise<HTMLCanvasElement>`: Decodes onto canvas.
- `decodeJxlToBlob(buffer): Promise<Blob>`: Decodes to displayable PNG blob.
- `encodeJxl(imageData, options?): Promise<Blob>`: Encodes raw ImageData to JXL blob.
- `encodeJxlCanvas(canvas, options?): Promise<Blob>`: Encodes canvas to JXL blob with quality and lossless options.

### `src/lib/ffmpeg.ts`
- `getFFmpeg(): Promise<FFmpeg>`: Lazy singleton returning the loaded FFmpeg instance using local core and wasm URLs.
- `runFFmpeg(opts): Promise<Blob>`: Queued job executor with MEMFS isolation.
- `mimeFromName(filename: string): string`: Returns standard MIME types.

### `src/lib/image.ts`
- `IMAGE_ACCEPT`: `accept` string for file inputs (jpg, png, webp, gif, bmp, avif, heic, heif, jxl, svg).
- `loadImage(file: Blob): Promise<HTMLImageElement>`: Decodes through an object URL (revoked after decode).
- `decodeImage(file: File): Promise<HTMLImageElement>`: Handles JPG, PNG, WebP, AVIF, HEIC/HEIF (`heic-to/csp`), SVG, and JPEG XL (`decodeJxlToBlob`).
- `imageToCanvas(img, width?, height?): HTMLCanvasElement`: Draws a source onto a new canvas.
- `canvasToBlob(canvas, mime, quality?): Promise<Blob>`: Encodes canvas to specified MIME type.
- `encodeBmp(canvas): Blob`: 24-bit BMP.
- `encodeIco(canvases): Promise<Blob>`: Multi-resolution Windows ICO.
- `encodeGif(canvas): Promise<Blob>`: Single-frame GIF through FFmpeg.

### `src/tools/pdf/_qpdf/qpdf.ts`
- `runQpdf(inputBytes, args): Promise<Uint8Array>`: Executes QPDF WASM inside a dedicated Web Worker.
- `encryptPdf(bytes, userPassword, ownerPassword?, allowPrint?, allowCopy?, allowModify?): Promise<Uint8Array>`: Encrypts PDF with AES-256.
- `decryptPdf(bytes, password): Promise<Uint8Array>`: Decrypts password-protected PDF.

### `src/tools/3d/_mesh/client.ts`
- `importModel(file: File): Promise<MeshModel>`: Dispatches file parsing to `mesh.worker.ts` or routes CAD files to `_cad/client.ts`. Preserves caller buffers via structured cloning.
- `inspectModel(model: MeshModel): Promise<MeshStats>`: Evaluates bounding box, surface area, signed volume (divergence theorem), watertightness, and non-manifold/boundary edge counts in Web Worker.
- `processModel(model: MeshModel, operation: MeshOperation): Promise<MeshModel>`: Dispatches simplification (`meshoptimizer` WASM with error and border bounds), transform (scale, rotate, center, ground), or face winding inversion to Web Worker.
- `splitModel(model: MeshModel): Promise<MeshModel[]>`: Decomposes disconnected mesh shells using Union-Find in Web Worker.
- `mergeModels(models: MeshModel[]): Promise<MeshModel>`: Combines and flattens multiple mesh buffers into a single unified container in Web Worker.
- `exportModel(model: MeshModel, format: MeshFormat): Promise<Blob>`: Serializes `MeshModel` to STL, OBJ, PLY, or 3MF Blob.
- `cancelMeshJobs(): void`: Cancels active worker jobs, terminates worker, and clears pending promises.

### `src/tools/3d/_cad/client.ts`
- `importCadModel(file: File, quality?: CadQuality): Promise<MeshModel>`: Tessellates STEP, IGES, or BREP files into a normalized millimeter `MeshModel` using `occt-import-js` (OpenCASCADE WASM) in a dedicated Web Worker (`cad.worker.ts`).
- `cancelCadJobs(): void`: Cancels pending CAD conversion jobs and terminates worker.

## Project Tracking (Taproot)

The living plan is the Taproot project **Loconvert**:
http://192.168.0.199:8789/p/rAe4dFS9FGHjmu

Branches: ✅ Shipped (foundation, shared code, all tools), 📌 Next up, 🚢 Release & ops, 🗺️ Backlog / ideas, 📖 Project context. Node ids are stable and descriptive (`lc-commit`, `lc-tool-v-trim`), so updates never need a lookup.

- Preferred transport: MCP at `http://192.168.0.199:8789/mcp` with `Authorization: Bearer …`. Use it for all board reads and writes. In T3 Code these arrive as native `tools.taproot.*`; the raw JSON-RPC examples below are for other clients.
- MCP tools: `list_projects`, `get_project` (`format: "outline"` is compact), `add_nodes`, `update_node`, `set_done`, `apply_ops` (atomic batches), `get_project_image`, `search`, `get_activity`.
- REST fallback: `http://192.168.0.199:8789/api/v1` with the same token, for exports, OpenAPI and interactive docs.
- Credentials: `~/.config/taproot/loconvert.env` (mode 600) exports `TAPROOT_MCP`, `TAPROOT_API`, `TAPROOT_PROJECT`, `TAPROOT_TOKEN`. Keep tokens out of the repo.
- Upkeep rules: before starting/delegating work find or create matching task; update notes on starting, meaningful progress, blockers and scope changes; on completion mark done with evidence (file/report paths, checks, run/task id); preserve completed history; keep unfinished work open.
- Collapse upkeep rule: after task status changes, recursively collapse every task or subtask with children when all its children and their descendants are done; apply at every depth; retain open branches and completed history.
- Working rule: Design-system migration is deferred until the user explicitly requests it; continue functional fixes without visual redesign.
