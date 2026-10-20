<p align="center">
  <img src="public/assets/icon.svg" width="80" height="80" alt="Loconvert Logo" />
</p>

# Loconvert

> **Private media and file tools that run in your browser.** Files are processed locally on your device using WebAssembly, WebCodecs, and WebGPU. No file data is uploaded to external servers; static assets, WASM codecs, and model weights are downloaded to the client on demand.

---

## Features

- **🔒 Client-Side Privacy:** Your documents, photos, audio, and videos are processed locally in your browser. Supported formats execute in client memory without uploading file data to external servers.
- **📁 Universal File Tools:**
  - **Format Converter:** Convert between supported image, audio, video, document, and data formats.
  - **Spreadsheets & Data:** CSV Viewer with multi-column search and pagination, TXT to CSV with delimiter detection and quote/multiline support, and bidirectional JSON ↔ CSV (using union headers and JSON-stringified nested values).
  - **File Utilities:** File Inspector (binary magic bytes, hex view, hashes), Batch File Rename (numbering, patterns, case transforms, ZIP export), Video Health Inspector (container atom boundaries, truncation, and browser playability), CSS Viewer (sandboxed live preview, presets, partial browser diagnostics).
  - **Web & Geo Formats:** MHTML to HTML unpacker, GPX ↔ KML GPS track converter.
- **🖼️ Image Tools & Modern Codecs:**
  - **JPEG XL (JXL):** Lossless and quality-controlled lossy encode/decode in a dedicated Web Worker with in-browser preview fallback.
  - **AVIF ↔ PNG / JPG / WebP:** On-device image conversion, resizing, and compression (AVIF encoding is browser-dependent, requiring native canvas support).
  - **Vector & Icons:** Image to SVG (embedded raster and pixel-vector shapes), Icon Converter (multi-resolution `.ico` bundles and frame extraction).
  - **Editing & Privacy:** Signature Cleaner (transparent ink extraction with threshold/detail controls and stamp color protection), Blur & Solid Redaction (permanent irreversible blackout).
- **📄 PDF & Office Suite:**
  - **Word to PDF / Excel to PDF / PowerPoint to PDF:** Client-side document conversion rendered inside an isolated Content Security Policy (CSP) iframe sandbox (subject to browser layout and font rendering constraints).
  - **PDF to Office:** PDF to DOCX, PPTX, and XLSX export.
  - **Security & Organization:** AES-256 PDF encryption/protection, password unlocking, merge, split, rotate, watermark, page numbering, and form flattening.
  - **On-Device OCR & AI:** Searchable PDF generation with local Tesseract OCR, and on-device document summarization/translation with Transformers.js.
- **🎬 Video & Audio Suite:**
  - **Video to MP3 & Audio Extraction:** Local audio extraction and volume boost via FFmpeg WASM.
  - **Video Editing:** Trim, crop, loop, speed, resize, merge, and subtitles.

---

## Tech Stack

- **Framework:** React 19, TypeScript, Vite
- **Codecs & Runtimes:**
  - FFmpeg WASM (`@ffmpeg/ffmpeg`)
  - JPEG XL (`@jsquash/jxl`)
  - QPDF WASM (`@neslinesli93/qpdf-wasm`)
  - PDF manipulation (`pdf-lib`, `pdfjs-dist`)
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
```

---

## Documentation

- [Tool Coverage & Source Mapping](docs/tool-coverage.md)
- [Final Integration & Verification Report](docs/final-verification.md)
- [PDF Security & Sandbox Verification](docs/pdf-verification.md)
- [Architecture & Development Guidelines](CONTEXT.md)
