<p align="center">
  <img src="public/assets/icon.svg" width="80" height="80" alt="Loconvert Logo" />
</p>

# Loconvert

> **Private media and file tools that run in your browser.** Files are processed locally on your device using WebAssembly, WebCodecs, and WebGPU. No file data is uploaded to external servers; static assets, WASM codecs, and model weights are downloaded to the client on demand.

---

## Features

- **🔒 Client-Side Privacy:** Your documents, photos, audio, videos, and 3D models are processed locally in your browser. Supported formats execute in client memory without uploading file data to external servers.
- **📁 Universal File Tools:**
  - **Format Converter:** Convert between supported image, audio, video, document, and data formats. Supported document workflows focus on client-side content and structural export: OpenDocument files (ODT, OTT, ODM, FODT, ODS, OTS, FODS, ODP, OTP, FODP, ODG, OTG, FODG, ODF) to text, HTML, and PDF, with Calc spreadsheets (ODS, OTS, FODS) additionally to CSV, TSV, and JSON; EPUB to text, HTML, and PDF; VSDX diagram textual labels; XLSX to PDF, CSV, TSV, JSON, and TXT; PPTX to PDF and TXT; and DOCX, including DOTX templates handled identically to DOCX. PDF is supported as a native document format. Legacy binary DOC, DOT, WPS, XLS, XLT, PPT, PPS, VSD, and PUB files, RTF, and OpenDocument ODB and OXT files are recognized for identification and inspection only, with no conversion offered.
  - **Spreadsheets & Data:** CSV Viewer with multi-column search and pagination, TXT to CSV with delimiter detection and quote/multiline support, and bidirectional JSON ↔ CSV (using union headers and JSON-stringified nested values).
  - **File Utilities:** File Inspector (binary magic bytes, hex view, hashes), Batch File Rename (numbering, patterns, case transforms, ZIP export), Video Health Inspector (container atom boundaries, truncation, and browser playability), CSS Viewer (sandboxed live preview, presets, partial browser diagnostics).
  - **Web & Geo Formats:** MHTML to HTML unpacker, GPX ↔ KML GPS track converter.
- **🖼️ Image Tools & Modern Codecs:**
  - **JPEG XL (JXL):** Lossless and quality-controlled lossy encode/decode in a dedicated Web Worker with in-browser preview fallback.
  - **AVIF ↔ PNG / JPG / WebP:** On-device image conversion, resizing, and compression with native canvas encoding and lazy bundled local `@jsquash/avif` WASM fallback.
  - **Vector & Icons:** Image to SVG (embedded raster and pixel-vector shapes), Image to Favicon / ICO (supported image formats, recommended or custom resolutions, and ICO frame extraction).
  - **Editing & Privacy:** Signature Cleaner (transparent ink extraction with threshold/detail controls and stamp color protection), Blur & Solid Redaction (permanent irreversible blackout).
- **📄 PDF & Office Suite:**
  - **Word to PDF / Excel to PDF / PowerPoint to PDF:** Client-side document conversion rendered inside an isolated Content Security Policy (CSP) iframe sandbox (subject to browser layout and font rendering constraints).
  - **PDF to Office:** PDF to DOCX, PPTX, and XLSX export.
  - **Security & Organization:** AES-256 PDF encryption/protection, password unlocking, merge, split, rotate, watermark, page numbering, and form flattening.
  - **On-Device OCR & AI:** Searchable PDF generation with local Tesseract OCR, and on-device document summarization/translation with Transformers.js.
- **🎬 Video & Audio Suite:**
  - **Video to MP3 & Audio Extraction:** Local audio extraction and volume boost via FFmpeg WASM.
  - **Video Editing:** Trim, crop, loop, speed, resize, merge, and subtitles.
- **🧊 3D Mesh & CAD Suite:**
  - **3D Format Converter (`/3d/convert`):** Client-side conversion between STL, OBJ, PLY, and 3MF mesh formats, plus CAD import (STEP/STP, IGES/IGS, BREP) tessellated to meshes.
  - **Mesh Simplifier & Decimator (`/3d/simplify`):** Edge-collapse polygon reduction powered by `meshoptimizer` WASM with error tolerance bounds and border locking.
  - **Mesh Inspector & Topology Analyzer (`/3d/inspect`):** Dimensions, bounding box, surface area, signed volume (divergence theorem), watertightness, and non-manifold/boundary edge counts.
  - **Transform & Unit Scaler (`/3d/transform`):** Scale presets (e.g. inches to mm), Euler XYZ rotation, auto-centering, and grounding to build plate ($Z_{\min} = 0$).
  - **Normals & Winding Reorienter (`/3d/normals`):** Invert triangle face winding globally to fix inverted normals and slicing errors.
  - **Component Splitter (`/3d/split`):** Decompose disconnected shells into separate component meshes with single-file and ZIP archive download.
  - **Mesh Merger (`/3d/merge`):** Combine and flatten multiple 3D models into a single unified container mesh.

---

## Known limitations

- **Document conversion fidelity & scope:** Document and office conversions perform client-side content, text, and tabular data extraction. They do not claim full LibreOffice or Microsoft Office layout, macro, or typographical rendering fidelity.
- **Legacy office & unsupported engines:** Legacy binary formats (`.doc`, `.dot`, `.rtf`, `.wps`, `.xls`, `.xlt`, `.ppt`, `.pps`, `.vsd`, `.pub`) as well as OpenDocument database (`.odb`) and extension package (`.oxt`) formats are recognized for identification and file inspection with explicit no-engine limits; no on-device legacy Office runtime, relational database engine (`.odb`), or plugin execution environment (`.oxt`) is bundled or claimed.
- WebM conversion writes an opaque VP8 stream (`yuv420p`), so transparent WebM input loses its alpha channel in every tested browser.
- Subtitle burn-in exports a playable file without visible subtitles in WebKit 27.2. Chromium and Firefox render the subtitles correctly.
- The cross-browser matrix covers desktop Chromium, Firefox and WebKit only. Mobile browsers and Safari hardware were not tested.

---

## Tech Stack

- **Framework:** React 19, TypeScript, Vite
- **Testing & tooling:** Vitest, ESLint, Prettier
- **UI:** Token-based design system (`src/design`), light/dark themes, Geist fonts bundled locally, `lucide-react` icons
- **Codecs & Runtimes:**
  - FFmpeg WASM (`@ffmpeg/ffmpeg`)
  - JPEG XL (`@jsquash/jxl`)
  - AVIF (`@jsquash/avif`)
  - QPDF WASM (`@neslinesli93/qpdf-wasm`)
  - PDF manipulation (`pdf-lib`, `pdfjs-dist`)
  - 3D processing & CAD (`three`, `meshoptimizer`, `occt-import-js` OpenCASCADE WASM, `jszip`, `fast-xml-parser`)
  - On-device AI (`@huggingface/transformers` ONNX WASM & WebGPU)
  - OCR (`tesseract.js`)
  - Office formats (`docx`, `docx-preview`, `exceljs`, `pptx-preview`)

---

## Development

```bash
# Install dependencies
npm install

# Start local dev server
npm run dev

# Type check and build production bundle
npm run build

# Standalone type check without bundling
npx tsc -b

# Unit tests
npm test

# Lint and format checks
npm run lint
npm run format:check
```

Production runs from the static `dist/` build with an SPA fallback. Tangled CI is the build gate. Host selection and cache headers remain open; see [Architecture Decisions](docs/architecture-decisions.md).

---

## Documentation

- [Architecture Decisions](docs/architecture-decisions.md)
- [Design System](docs/design-system.md) (live at `/design`)
- [3D Tools & Pipeline Specification](docs/3d-tools.md) (live at `/3d`)
- [Tool Coverage & Source Mapping](docs/tool-coverage.md)
- [Final Integration & Verification Report](docs/final-verification.md)
- [Quality & Error Recovery Verification](docs/quality-verification.md)
- [Accessibility Verification](docs/a11y-verification.md)
- [Bundle & Load Audit](docs/performance-verification.md)
- [Cross-Browser Matrix](docs/browser-matrix.md)
- [Test, Lint & Formatting Toolchain](docs/tooling-verification.md)
- [AVIF Fallback Verification Report](docs/avif-verification.md)
- [PDF Security & Sandbox Verification](docs/pdf-verification.md)
- [Architecture & Development Guidelines](CONTEXT.md)
