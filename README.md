<p align="center">
  <img src="public/assets/icon.svg" width="80" height="80" alt="Loconvert Logo" />
</p>

# Loconvert

> **Private media and file tools that run in your browser.** Files are processed locally on your device using WebAssembly, WebCodecs, and WebGPU. No file data is uploaded to external servers; static assets, WASM codecs, and model weights are downloaded to the client on demand.

---

## Features

Loconvert includes 140 tools, including eight for 3D meshes and CAD files.

- **🔒 Client-Side Privacy:** Your documents, photos, audio, videos, and 3D models are processed locally in your browser. Supported formats execute in client memory without uploading file data to external servers.
- **Languages:** The interface supports English, Spanish, Italian, German, Portuguese, and French. It follows the browser's preferred supported language on first visit and remembers an explicit choice on the device.
- **Tool search (⌘K / Ctrl+K):** Search locally by tool, format, or task phrase. It tolerates common one-character typos and searches English plus the current interface language, including accents (for example, “make PDF smaller” or “remove sound from video”).
- **Recent files** shows a thumbnail for supported images and videos. Choose a row to reopen the original files and any saved editor draft in the tool you used. The browser keeps up to 10 entries in IndexedDB. Video editor projects can use up to 512 MiB each and 1 GiB combined, subject to available browser storage. Browsers that require the ArrayBuffer fallback can save up to 64 MiB of new video project media per write. Other files and photo drafts have a 64 MiB limit per file or draft and a 128 MiB combined limit. Removing an entry deletes its stored files and draft. Download the finished result to keep it separately.
- **📁 Universal File Tools:**
  - **Format Converter:** Convert between supported image, audio, video, document, and data formats. Supported document workflows focus on client-side content and structural export: OpenDocument files (ODT, OTT, ODM, FODT, ODS, OTS, FODS, ODP, OTP, FODP, ODG, OTG, FODG, ODF) to text, HTML, and PDF, with Calc spreadsheets (ODS, OTS, FODS) additionally to CSV, TSV, and JSON; EPUB to text, HTML, and PDF; VSDX diagram textual labels; XLSX to PDF, CSV, TSV, JSON, and TXT; PPTX to PDF and TXT; and DOCX, including DOTX templates handled identically to DOCX. PDF is supported as a native document format. Legacy binary DOC, DOT, WPS, XLS, XLT, PPT, PPS, VSD, and PUB files, RTF, and OpenDocument ODB and OXT files are recognized for identification and inspection only, with no conversion offered.
  - **Spreadsheets & Data:** CSV Viewer with multi-column search and pagination, TXT to CSV with delimiter detection and quote/multiline support, and bidirectional JSON ↔ CSV (using union headers and JSON-stringified nested values).
  - **File Utilities:** File Inspector (binary magic bytes, hex view, hashes), Batch File Rename (numbering, patterns, case transforms, ZIP export), Video Health Inspector (container atom boundaries, truncation, and browser playability), CSS Viewer (sandboxed live preview, presets, partial browser diagnostics).
  - **Web & Geo Formats:** MHTML to HTML unpacker, GPX ↔ KML GPS track converter.
- **🖼️ Image Tools & Modern Codecs:**
  - **Photo Editor (`/image/photo-editor`)** lets you adjust light and color, add text, draw and highlight, place arrows and shapes, and redact areas in a full-screen workspace. Use the rotation ruler or enter an angle to the nearest 0.1°. The frame shows the part you’ll keep. The shaded edges are cropped from copies and downloads. Reset rotation brings those edges back.
    With the editor focused, press **V** to select a layer, **T** for text, or **B** to draw. Press **?** for the shortcut guide.
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
  - **Browser-native media paths:** Mediabunny handles supported MP4, MOV, MKV, and WebM conversions, stream-copy remuxes, precise trim, crop, resize, compression, audio removal and extraction, supported file-converter outputs, metadata inspection, and WAV preparation for transcription. Runtime codec probes select this path only when the browser supports the input decoder and requested output encoder.
  - **Local fallback:** Unsupported codecs and containers, GIF, AVI, audio formats outside WAV/MP3/M4A, complex filters, merge, loop, speed, and subtitle workflows continue through the bundled FFmpeg WASM engine. MP3 and AAC encoder extensions are bundled locally and loaded only when native encoding is unavailable; media files and codec requests are never sent to a CDN or remote service.
  - **Video Editor (`/video/video-editor`)** opens one or more local videos or a six-second sample. The first video sets the frame shape. Click inside a timeline clip and press **S** to split it at the playhead. Both pieces stay in the timeline. Use **Trim** to shorten either piece, or drag a clip to reorder it. **Move earlier** and **Move later** also work from the keyboard. Crop the frame, rotate to the nearest 0.1°, flip, and choose a playback speed. While rotating, the shaded area falls outside the exported frame. Rotation and speed apply to the whole timeline. Mix the clips’ original audio with a soundtrack, copy a frame, or export as MP4 or WebM. Recent files reopens saved drafts within the storage limits above. [Six-second sample](public/samples/workspace-demo.mp4)
    Press **I** or **O** to trim the selected clip’s start or end to the playhead. Press **?** in the editor for the full shortcut guide.
  - **Focused video tools** trim, crop, loop, change speed, resize, merge, boost volume, and edit subtitles. Simple volume gain uses Mediabunny sample processing. Loudness normalization uses FFmpeg.
- **🧊 3D Mesh & CAD Suite:**
  - **3D Viewer (`/3d/viewer`):** Open STL, OBJ, PLY, 3MF, STEP/STP, IGES/IGS, and BREP models or GLB and glTF scenes. To open a 3MF assembly with linked objects, select the original `.3mf` archive. The 3MF viewer supports up to 4 million triangles and 4 million vertices, subject to the existing file and archive checks. 3MF editing and analysis are limited to 1 million triangles and 1 million vertices. Use PNG, JPEG, or static WebP textures, either embedded or in local files. Select any external `.bin` buffers and texture files together with the model, or use **Open scene folder** to preserve their relative paths, including texture subfolders. Export without Draco geometry compression, Basis/KTX2 textures, or AVIF textures. The viewer displays a static pose without animation playback. Orbit, pan, and zoom, adjust lighting and render settings, and check dimensions and geometry counts. Click the model or use `Tab` to focus the viewport. Press `?` for the full shortcut reference, `F` to fit the model, `O` for orbit, or `P` for pan.
  - **3D Format Converter (`/3d/convert`):** Client-side conversion between STL, OBJ, PLY, and 3MF mesh formats, plus CAD import (STEP/STP, IGES/IGS, BREP) tessellated to meshes.
  - **Mesh Simplifier & Decimator (`/3d/simplify`):** Edge-collapse polygon reduction powered by `meshoptimizer` WASM with error tolerance bounds and border locking.
  - **Mesh Inspector & Topology Analyzer (`/3d/inspect`):** Dimensions, bounding box, surface area, signed volume (divergence theorem), watertightness, and non-manifold/boundary edge counts.
  - **Transform & Unit Scaler (`/3d/transform`):** Scale presets (e.g. inches to mm), Euler XYZ rotation, auto-centering, and grounding to build plate ($Z_{\min} = 0$).
  - **Normals & Winding Reorienter (`/3d/normals`):** Invert triangle face winding globally to fix inverted normals and slicing errors.
  - **Component Splitter (`/3d/split`):** Decompose disconnected shells into separate component meshes with single-file and ZIP archive download.
  - **Mesh Merger (`/3d/merge`):** Combine and flatten multiple 3D models into a single unified container mesh.

## Interactive previews

Selected image, video, and PDF tools provide visual feedback before export. Where a preview is practical, controls update it before export; expensive full exports run only from the primary action. Previews are labeled when they show the source or an approximation, and the exported file remains the final result.

- **Image and video crop:** Draw a selection, move it, and resize from its edges or corners. The crop overlay includes a rule-of-thirds grid, keyboard adjustment, and numeric source-pixel controls for precise placement. Video crop coordinates use even pixel values.
- **Image resize, compression, and conversion:** Compare source and target previews while adjusting settings. Standard previews are bounded to 512 pixels per edge; crop and circle-crop editor previews are bounded to 1,280 pixels per edge. Compression file-size figures are estimates from bounded samples. Batch image tools preview only the first selected item.
- **Image results:** Use **Copy** beside **Download** to copy the finished image as a PNG, including individual batch results. On the LAN HTTP address, **Copy** opens the image for the browser’s **Copy Image** command.
- **Icon conversion:** Image-to-ICO shows the target icon before Convert; ICO-to-PNG previews the first frame. Batch previews use the first selected file. Image source previews are limited to 16 MiB; ICO source previews are limited to 4 MiB, 16 frames, and 256 × 256 pixels per frame. Conversion remains available when a preview limit is reached.
- **Video:** Resize previews the source inside the target frame using fit, fill, or stretch; it does not encode the output. Speed preview uses browser playback rate, and trim can play the selected range. Format conversion, compression, soundtrack, audio extraction or removal, and volume tools show source media previews only; playback depends on browser support for the source.
- **PDF:** Watermark and page-number previews render one selected page at a time, apply the same annotation functions as export, and are capped at 900 pixels per edge. Watermarks can be placed by dragging or with arrow keys. PDF crop handles also support keyboard adjustment.

## Additional browser tools and workflows

- **ZIP Inspector & Extractor (`/zip-extract`):** Inspect entries and save selected files or bundle them. Supports standard STORE and DEFLATE archives up to 64 MiB, with at most 1,000 entries, 64 MiB per extracted file, and 128 MiB expanded total. Encrypted, multi-volume, and ZIP64 archives are unsupported.
- **Compare Images (`/image/compare`):** Compare two PNG, JPG, WebP, GIF, or BMP images with a wipe or side-by-side view. Inputs are limited to 100 MiB; dimensions are checked before full decoding, with limits of 40 megapixels and a 32,768-pixel edge. Convert other formats first.
- **Optimize SVG (`/image/svg-optimize`):** Run SVGO 4.1 lazily in the browser, preserving SVG IDs and `viewBox`. External-resource references cause the preview to be withheld. SVG inputs are limited to 5 MiB.
- **Trim Audio (`/video/audio-trim`):** Select a waveform range and export WAV. Inputs are limited to 64 MiB and 10 minutes; browser audio codec support determines whether the source can be previewed.
- **Scan to PDF (`/pdf/scan-to-pdf`):** In addition to camera capture and uploaded images, manually adjust all four page corners for perspective correction. There is no automatic page-edge detection; scan images are normalized to at most 2,400 pixels per side.
- **PDF Metadata Cleaner (`/pdf/metadata-cleaner`):** Remove the standard Info fields Title, Author, Subject, Keywords, Creator, Producer, CreationDate, and ModDate. Custom Info entries, XMP, document language, attachments, and form fields remain. It does not remove every identifying value, and saving a signed PDF invalidates its digital signatures.
- **Subtitles (`/video/subtitles`):** Import, edit, and shift SRT or VTT cues. Files are limited to 5 MB, 10,000 cues, and timestamps within seven days. VTT header and NOTE/STYLE/REGION metadata are discarded with a warning; cue markup becomes plain text, and cue settings are retained only in VTT exports.

---

## Known limitations

- **Document conversion fidelity & scope:** Document and office conversions perform client-side content, text, and tabular data extraction. They do not claim full LibreOffice or Microsoft Office layout, macro, or typographical rendering fidelity.
- **Legacy office & unsupported engines:** Legacy binary formats (`.doc`, `.dot`, `.rtf`, `.wps`, `.xls`, `.xlt`, `.ppt`, `.pps`, `.vsd`, `.pub`) as well as OpenDocument database (`.odb`) and extension package (`.oxt`) formats are recognized for identification and file inspection with explicit no-engine limits; no on-device legacy Office runtime, relational database engine (`.odb`), or plugin execution environment (`.oxt`) is bundled or claimed.
- The video and universal converters preserve WebM transparency by copying the video stream into WebM or MKV with local FFmpeg. Other video and GIF exports stop with a message when they cannot preserve the full alpha channel. Preview playback depends on browser support for transparent video.
- Mediabunny codec support depends on the browser's WebCodecs decoder and encoder capabilities. Unsupported operations fall back to local FFmpeg WASM. Its qualitative quality controls use different rate control from x264 CRF, so matching labels do not promise matching visual or audio quality.
- The November check confirmed visible subtitles from a fixed cue in Chromium, Firefox and WebKit. The complete transcription and burn-in flow also produced a visible cue in Linux WebKit 27.2. See the [release review](docs/release-review.md) for the tested scope.
- Local AI summaries can introduce details absent from the source. Check them against the original document before relying on them.
- AI video compositing accepts inputs up to 128 MiB and exports up to 900 frames. At 30 fps this is about 30 seconds. A clip can reach the 128 MiB intermediate frame limit sooner depending on its resolution and content.
- The cross-browser matrix covers desktop Chromium, Firefox and WebKit only. Mobile browsers and Safari hardware were not tested.

---

## Tech Stack

- **Framework:** React 19, TypeScript, Vite
- **Testing & tooling:** Vitest, ESLint, Prettier
- **UI:** Charcoal workspace with signal-lime actions, a file-first home, and a compact ruled tool directory. Light, dark, and system appearance, six interface languages, and locally bundled Geist fonts.
- **Codecs & Runtimes:**
  - FFmpeg WASM (`@ffmpeg/ffmpeg`)
  - Mediabunny (`mediabunny`) with lazy local MP3 and AAC encoder extensions
  - JPEG XL (`@jsquash/jxl`)
  - AVIF (`@jsquash/avif`)
  - QPDF WASM (`@neslinesli93/qpdf-wasm`)
  - PDF manipulation (`pdf-lib`, `pdfjs-dist`)
  - 3D processing & CAD (`three`, `meshoptimizer`, `occt-import-js` OpenCASCADE WASM, `jszip`, `saxes`, `fast-xml-parser`)
  - On-device AI (`@huggingface/transformers` ONNX WASM & WebGPU)
  - OCR (`tesseract.js`)
  - Office formats (`docx`, `docx-preview`, `exceljs`, `pptx-preview`)

---

## Development

```bash
# Install the locked dependencies (release checks use Node 24)
npm ci

# Start local dev server
npm run dev

# Type check and build production bundle
npm run build

# Standalone type check without bundling
npx tsc -b

# Unit tests
npm test

# Lint and format checks
npm run lint -- --max-warnings=0
npm run format:check
```

Run the checks above locally before publishing. The codebase review records the latest fixes and verification, and the release review covers the initial release. [Codebase review](docs/codebase-review.md) · [Release review](docs/release-review.md)

Arcane serves the production build on the LAN from a single container. Camera access requires a secure browser context. The deployment guide includes a localhost forwarding command for this case. [Open Loconvert](http://192.168.0.199:3052) · [Deployment guide](docs/deployment.md)

---

## Documentation

- [Changelog](CHANGELOG.md)
- [Architecture Decisions](docs/architecture-decisions.md)
- [Design System](docs/design-system.md) (reference at `/design`)
- [3D Tools & Pipeline Specification](docs/3d-tools.md) (live at `/3d`)
- [Tool Coverage & Source Mapping](docs/tool-coverage.md)
- [Final Integration & Verification Report](docs/final-verification.md)
- [Quality & Error Recovery Verification](docs/quality-verification.md)
- [Accessibility Verification](docs/a11y-verification.md)
- [Bundle & Load Audit](docs/performance-verification.md)
- [Cross-Browser Matrix](docs/browser-matrix.md)
- [Mediabunny Migration](docs/mediabunny-migration.md)
- [Test, Lint & Formatting Toolchain](docs/tooling-verification.md)
- [AVIF Fallback Verification Report](docs/avif-verification.md)
- [PDF Security & Sandbox Verification](docs/pdf-verification.md)
- [Architecture & Development Guidelines](CONTEXT.md)
