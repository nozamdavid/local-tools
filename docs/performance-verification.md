# Loconvert Bundle and Load Audit (Taproot lc-bundle)

## Executive Summary
This document provides the definitive measurement, runtime performance audit, chunk analysis, and defect inventory for **Loconvert** (Vite 8 + React 19 + strict TypeScript), satisfying Taproot task `lc-bundle`.

All heavy compilation, typechecking, production builds, and headless browser audits were executed under the serialized lock (`flock /tmp/loconvert-heavy.lock`) with resource limits enforced via `systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0`. At all times, host system headroom exceeded 17 GiB of available RAM (well above the 4 GiB requirement).

### Key Findings
1. **Measured Production Baseline:** The total production output in `/tmp/lc-perf-dist` is **102,083,622 bytes (97.35 MB uncompressed, ~102.1 MB)** across **328 files**.
   - The previously circulating "59 MB" claim was outdated: it omitted heavy WASM assets and AI runtimes added in recent phases (e.g., ONNX Runtime WASM at 26.86 MB, OpenCASCADE CAD WASM at 7.60 MB, and Tesseract OCR models at 7.80 MB).
   - WASM binaries account for **79.0%** of total distribution bytes (80.65 MB across 10 files).
   - JavaScript chunks account for **20.6%** of total distribution bytes (21.06 MB across 220 files).
2. **Lazy Loading of Heavy WASM & AI Runtimes Succeeded:** None of the heavy WASM binaries—`@ffmpeg/core.wasm` (32.2 MB), `ort-wasm-simd-threaded.asyncify.wasm` (26.9 MB), `occt-import-js.wasm` (7.6 MB), `tesseract-core-*.wasm.js` (7.8 MB), `heic-to` (3.15 MB), `qpdf.wasm` (1.33 MB), or `pdf.worker.mjs` (1.26 MB)—are downloaded on initial route navigation before user interaction.
3. **Confirmed Eager-Loading Defects Identified:**
   - **`src/lib/image.ts:1`:** Static import of `runFFmpeg` pulls the FFmpeg JS wrapper (`assets/ffmpeg-CDlynsXJ.js`, 5.9 KB) into every image route (`/image/convert`, `/image/heic-to-jpg`, etc.) solely for single-frame GIF export.
   - **`src/components/BatchResults.tsx:5` & `src/lib/zip.ts:1`:** Static import of `JSZip` causes `assets/jszip.min-CIiua8fH.js` (95.9 KB) to be downloaded eagerly on every image format conversion tool before any file is uploaded.
   - **`src/tools/3d/convert/Tool.tsx:6-14`:** Static import of `MeshViewer` pulls Three.js and orbit controls (`assets/_ui-KVosyZfE.js`, 568.9 KB uncompressed, 142.5 KB gzip) eagerly onto `/3d/convert`, driving route first-load over 1.0 MB before a model is provided.
   - **`src/tools/pdf/merge/Tool.tsx:2,14` & `src/tools/pdf/_pages/pdfPages.ts:1`:** Static import of `PDFDocument from 'pdf-lib'` pulls `assets/es-CXhQNGVf.js` (425.0 KB, 177.5 KB gzip) eagerly onto `/pdf/merge` on first visit.
   - **`src/tools/pdf/excel-to-pdf/convert.ts:1`:** Static import of `ExcelJS from 'exceljs'` pulls `assets/exceljs.min-BHGw0GNu.js` (929.4 KB, 256.4 KB gzip) eagerly onto `/pdf/excel-to-pdf`.

---

## 1. Methodology and Commands

### 1.1 Memory Headroom & Serialized Lock
System memory was inspected before starting heavy tasks:
```bash
free -g
```
- Total RAM: 60 GiB, Available: 17–21 GiB (consistently exceeding 4 GiB headroom).

### 1.2 Typecheck Verification
Executed under the shared lock and memory cap:
```bash
flock /tmp/loconvert-heavy.lock systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 npx tsc --noEmit -p .
```
- **Result:** Exited with code `0`. Zero TypeScript diagnostic errors.

### 1.3 Measuring Build Copy
Built into an isolated directory without touching repo files or existing dev servers:
```bash
flock /tmp/loconvert-heavy.lock systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 npx vite build --outDir /tmp/lc-perf-dist --emptyOutDir
```
- **Result:** Vite 8.3.4 compiled cleanly in 1.67 seconds into `/tmp/lc-perf-dist`.

### 1.4 Preview Server Isolation
The production build was served on isolated port 5302 (leaving dev server on 5300 untouched):
```bash
npx vite preview --outDir /tmp/lc-perf-dist --port 5302 --strictPort
```

### 1.5 Headless Browser Audit
Executed using `playwright-core` from `/tmp/lc-e2e/node_modules` with Chromium executable `/home/david/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`.
The test script navigated to 7 target routes (`/`, `/video/compress`, `/image/heic-to-jpg`, `/image/convert`, `/pdf/merge`, `/file-converter`, `/3d/convert`), intercepting every HTTP request, response header, status code, and payload byte during initial clean load and subsequent page reload.

---

## 2. Production Build Baseline Measurements

### 2.1 Distribution Summary
- **Total Output Size:** 102,083,622 bytes (97.35 MB / 102.1 MB)
- **Total Files Emitted:** 328 files

#### Breakdown by Asset Type
| Asset Category | File Count | Total Raw Bytes | Total Size (MB) | Share of Total |
|----------------|------------|-----------------|-----------------|----------------|
| **WASM**       | 10         | 80,654,155      | 76.92 MB        | 79.01%         |
| **JS / MJS**   | 220        | 21,060,333      | 20.08 MB        | 20.63%         |
| **CSS**        | 85         | 220,415         | 0.21 MB         | 0.22%          |
| **Fonts**      | 11         | 146,868         | 0.14 MB         | 0.14%          |
| **HTML**       | 1          | 1,369           | <0.01 MB        | <0.01%         |
| **Images**     | 1          | 482             | <0.01 MB        | <0.01%         |
| **Total**      | **328**    | **102,083,622** | **97.35 MB**    | **100.0%**     |

### 2.2 Entry Graph & Modulepreloads (`dist/index.html`)
The root HTML entry point consists of:
```html
<script src="/theme-init.js"></script>
<script type="module" crossorigin src="/assets/index-B7IvWmLb.js"></script>
<link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-BCiCTKAo.js">
<link rel="stylesheet" crossorigin href="/assets/index-DzfUKXsW.css">
```
- `index.html`: 1,369 bytes (document)
- `/theme-init.js`: 335 bytes (synchronous theme setup to prevent FOUC)
- `assets/index-DzfUKXsW.css`: 56,448 bytes (global design system and component styles)
- `assets/rolldown-runtime-BCiCTKAo.js`: 1,301 bytes (module loading runtime)
- `assets/index-B7IvWmLb.js`: 370,557 bytes (React 19, react-router-dom, shell, tool registry definitions; gzip: 115.70 KB)

### 2.3 The 30 Largest Assets in the Distribution
All assets above 90 KB in the production output, grouped and named with their library attribution:

| # | Emitted Asset Filename | Type | Raw Bytes | Display Size | Library / Component Attribution |
|---|------------------------|------|-----------|--------------|---------------------------------|
| 1 | `ffmpeg-core-CgUfceKH.wasm` | WASM | 32,232,419 | 32.23 MB | `@ffmpeg/core` WebAssembly binary |
| 2 | `ort-wasm-simd-threaded.asyncify-CxOG5pUO.wasm` | WASM | 26,861,777 | 26.86 MB | ONNX Runtime WASM (`@huggingface/transformers`) |
| 3 | `occt-import-js-BhHfLpto.wasm` | WASM | 7,604,031 | 7.60 MB | OpenCASCADE CAD WASM (`occt-import-js`) |
| 4 | `tesseract-core-simd-lstm.wasm-D4IWHdQk.js` | JS | 3,899,472 | 3.90 MB | Tesseract OCR SIMD LSTM core (`tesseract.js-core`) |
| 5 | `tesseract-core-lstm.wasm-DhgzXyTR.js` | JS | 3,896,484 | 3.90 MB | Tesseract OCR fallback LSTM core (`tesseract.js-core`) |
| 6 | `avif_enc_mt-DFoVXd45.wasm` | WASM | 3,534,665 | 3.53 MB | libavif multi-threaded WASM encoder (`@jsquash/avif`) |
| 7 | `avif_enc-Co4TcJko.wasm` | WASM | 3,485,872 | 3.49 MB | libavif single-threaded WASM encoder (`@jsquash/avif`) |
| 8 | `heic-to-B9edJ3jv.js` | JS | 3,150,907 | 3.15 MB | libheif / heic-to converter bundle (`heic-to`) |
| 9 | `jxl_enc_mt_simd-dX2xfs-R.wasm` | WASM | 2,012,670 | 2.01 MB | libjxl multi-threaded SIMD WASM encoder (`@jsquash/jxl`) |
| 10 | `jxl_enc_mt-DeBV9omF.wasm` | WASM | 1,375,371 | 1.38 MB | libjxl multi-threaded WASM encoder (`@jsquash/jxl`) |
| 11 | `jxl_enc-Brgqtac1.wasm` | WASM | 1,363,824 | 1.36 MB | libjxl single-threaded WASM encoder (`@jsquash/jxl`) |
| 12 | `qpdf-C3Giu3T4.wasm` | WASM | 1,334,286 | 1.33 MB | QPDF WebAssembly binary (`@embedpdf/qpdf-wasm`) |
| 13 | `pdf.worker.min-CjEcRF4W.mjs` | JS | 1,264,342 | 1.26 MB | PDF.js Web Worker (`pdfjs-dist`) |
| 14 | `pptx-preview.es-D6nxyFt5.js` | JS | 1,227,383 | 1.23 MB | PowerPoint preview engine (`pptx-preview`) |
| 15 | `exceljs.min-BHGw0GNu.js` | JS | 929,401 | 929.40 KB | Excel spreadsheet parser/builder (`exceljs`) |
| 16 | `jxl_dec-BE7lT9uY.wasm` | WASM | 849,240 | 849.24 KB | libjxl WASM decoder (`@jsquash/jxl`) |
| 17 | `_ui-KVosyZfE.js` | JS | 568,871 | 568.87 KB | Three.js runtime & 3D UI (`three`, `lucide-react`) |
| 18 | `aiWorker-ueVXp548.js` | JS | 547,425 | 547.43 KB | Whisper / speech recognition worker (`@huggingface/transformers`) |
| 19 | `worker-Bf-nJh49.js` | JS | 547,337 | 547.34 KB | PDF / text AI worker (`@huggingface/transformers`) |
| 20 | `segmentWorker-C9Xl8lrY.js` | JS | 546,736 | 546.74 KB | Image background removal worker (`@huggingface/transformers`) |
| 21 | `dist-D6fM5LnN.js` | JS | 452,706 | 452.71 KB | Word document builder (`docx`) |
| 22 | `mesh.worker-Bdt8qBEo.js` | JS | 450,784 | 450.78 KB | 3D mesh processing worker (`three`, `meshoptimizer`) |
| 23 | `pdf-DpjSUBhL.js` | JS | 430,241 | 430.24 KB | PDF.js main runtime bundle (`pdfjs-dist`) |
| 24 | `es-CXhQNGVf.js` | JS | 425,027 | 425.03 KB | PDF document manipulation engine (`pdf-lib`) |
| 25 | `index-B7IvWmLb.js` | JS | 370,557 | 370.56 KB | Application entry bundle (React 19, react-router-dom, shell) |
| 26 | `pptxgen.es-laQFj4gR.js` | JS | 272,553 | 272.55 KB | PowerPoint presentation generator (`pptxgenjs`) |
| 27 | `jxl.worker-BszJoLr7.js` | JS | 115,996 | 116.00 KB | JXL codec worker bridge (`@jsquash/jxl`) |
| 28 | `ffmpeg-core-CI9Irx9p.js` | JS | 111,804 | 111.80 KB | FFmpeg core JS Emscripten loader (`@ffmpeg/core`) |
| 29 | `worker.min-32WLk7pY.js` | JS | 111,307 | 111.31 KB | Tesseract worker bridge (`tesseract.js`) |
| 30 | `jszip.min-CIiua8fH.js` | JS | 95,932 | 95.93 KB | ZIP archive compression utility (`jszip`) |

---

## 3. Per-Route First-Load Measurements

Measurements taken via automated Playwright Chromium instances starting from a fresh context (empty cache) and recording all requests until network idle.

| Route | Requests | Total Transferred | JS Transferred | CSS Transferred | Document / Fonts | Heavy WASM / Libraries Loaded |
|---|:---:|:---:|:---:|:---:|:---:|---|
| `/` | 7 | 482,538 B (471.2 KB) | 372,193 B (363.5 KB) | 56,448 B | 53,897 B | **None** (Clean baseline) |
| `/video/compress` | 15 | 479,557 B (468.3 KB) | 392,340 B (383.1 KB) | 56,448 B | 30,769 B | `ffmpeg-CDlynsXJ.js` (5.9 KB wrapper). FFmpeg core WASM (32 MB) **ABSENT**. |
| `/image/heic-to-jpg` | 20 | 589,690 B (575.9 KB) | 501,332 B (489.6 KB) | 57,589 B | 30,769 B | `ffmpeg` wrapper (5.9 KB), `jszip` (95.9 KB). `heic-to` bundle (3.15 MB) **ABSENT**. |
| `/image/convert` | 20 | 589,589 B (575.8 KB) | 501,231 B (489.5 KB) | 57,589 B | 30,769 B | `ffmpeg` wrapper (5.9 KB), `jszip` (95.9 KB). JXL/AVIF WASMs **ABSENT**. |
| `/pdf/merge` | 17 | 906,125 B (884.9 KB) | 817,321 B (798.2 KB) | 58,035 B | 30,769 B | `pdf-lib` (`es-CXhQNGVf.js`, 425.0 KB). `qpdf.wasm` and `pdf.worker` **ABSENT**. |
| `/file-converter` | 23 | 695,713 B (679.4 KB) | 605,780 B (591.6 KB) | 59,164 B | 30,769 B | `ffmpeg` wrapper (5.9 KB), `jszip` (95.9 KB), `detect` (73.9 KB). Heavy WASMs **ABSENT**. |
| `/3d/convert` | 12 | 1,039,434 B (1,015.1 KB) | 947,384 B (925.2 KB) | 61,281 B | 30,769 B | Three.js runtime (`_ui-KVosyZfE.js`, 568.9 KB). `occt.wasm` (7.6 MB) **ABSENT**. |

---

## 4. Lazy-Load Evidence & Library Absence Audits

Before any file is chosen or processed by the user:

1. **FFmpeg Core WASM (`ffmpeg-core-CgUfceKH.wasm`, 32.23 MB) & Emscripten JS (`ffmpeg-core-CI9Irx9p.js`, 111.80 KB):**
   - **Status:** **ABSENT** on all routes, including `/video/compress` and `/file-converter`.
   - **Verification:** Inspection of `src/lib/ffmpeg.ts` confirms URLs are imported via `?url` queries and `ffmpeg.load()` is called only when `getFFmpeg()` is invoked during an active conversion job.
2. **HEIC Decoder Bundle (`heic-to-B9edJ3jv.js`, 3.15 MB):**
   - **Status:** **ABSENT** on initial load of `/image/heic-to-jpg` and all image converter routes.
   - **Verification:** `src/lib/image.ts:61` uses dynamic `await import('heic-to/csp')` inside `decodeImage()` only when a file matching the HEIC MIME/extension signature is supplied.
3. **PDF.js Web Worker (`pdf.worker.min-CjEcRF4W.mjs`, 1.26 MB) & PDF.js Main (`pdf-DpjSUBhL.js`, 430.24 KB):**
   - **Status:** **ABSENT** on `/pdf/merge` and initial page loads.
   - **Verification:** `src/lib/pdf.ts` uses dynamic `import('pdfjs-dist')` inside `loadPdfjs()` and references worker via `?url`.
4. **ONNX Runtime / Transformers AI WASM (`ort-wasm-simd-threaded.asyncify-CxOG5pUO.wasm`, 26.86 MB):**
   - **Status:** **ABSENT** across all initial route loads.
   - **Verification:** Only imported inside dedicated worker scripts (`segmentWorker.ts`, `aiWorker.ts`, `worker.ts`), which are spawned on-demand upon initiating an AI task.
5. **Tesseract OCR WASM Cores (`tesseract-core-*.wasm.js`, 2 × 3.90 MB):**
   - **Status:** **ABSENT** across all initial route loads.
   - **Verification:** `src/tools/pdf/ocr/ocrEngine.ts:61` dynamically imports `tesseract.js` only when `startOcrJob()` is called.
6. **OpenCASCADE CAD WASM (`occt-import-js-BhHfLpto.wasm`, 7.60 MB):**
   - **Status:** **ABSENT** on `/3d/convert` before a STEP/IGES/BREP file is selected.
   - **Verification:** `src/tools/3d/_cad/client.ts` initializes the worker in `CadJobManager.convert()`, and `cad.worker.ts` dynamically resolves the factory and wasm URL on-demand.
7. **QPDF WebAssembly (`qpdf-C3Giu3T4.wasm`, 1.33 MB):**
   - **Status:** **ABSENT** on `/pdf/merge` before user operations.
   - **Verification:** `src/tools/pdf/_qpdf/qpdf.ts` only starts `new Worker()` inside `runQpdfRaw()` when an actual QPDF operation (e.g., encryption check, repair) is invoked.

---

## 5. Cache-Header Findings & Reload Behavior

### 5.1 Observed Headers from Vite Preview Server
- **Initial Request Headers (e.g., `/assets/index-B7IvWmLb.js`):**
  ```http
  HTTP/1.1 200 OK
  Cache-Control: no-cache
  Content-Type: text/javascript
  Content-Encoding: gzip
  ETag: W/"370557-1792575545516"
  Last-Modified: Wed, 21 Oct 2026 09:39:05 GMT
  ```
- **Page Reload Behavior:**
  - When the browser reloads (`page.reload()`), the browser issues conditional GET requests with `If-None-Match: W/"..."`.
  - The server responds with `HTTP 304 Not Modified` for all static assets.
  - Reload network transfer for `/`: **7 requests, 1,369 bytes** (4 requests returned 304, 3 requests returned 200 for HTML/theme-init).
  - Reload network transfer for `/video/compress`: **15 requests, 1,369 bytes** (13 requests returned 304, 2 returned 200).
  - Reload network transfer for `/image/convert`: **20 requests, 1,369 bytes** (18 requests returned 304, 2 returned 200).
  - Reload network transfer for `/3d/convert`: **12 requests, 1,369 bytes** (10 requests returned 304, 2 returned 200).

### 5.2 Architectural Production Gap
- The preview server sets `Cache-Control: no-cache` for all files.
- While `304 Not Modified` saves payload transfer bytes, it still incurs roundtrip latency (RTT) for every chunk on the page.
- In production hosting (Cloudflare Pages, Vercel, Netlify, Nginx), assets in `/assets/*` have content-hashed filenames and should be served with:
  ```http
  Cache-Control: public, max-age=31536000, immutable
  ```
- This allows subsequent navigations to resolve from the browser's disk/memory cache with **zero HTTP roundtrips**.
- Root HTML documents (`/`, `/index.html`) should remain `Cache-Control: no-cache` to ensure instant propagation of updates.

---

## 6. Concrete Defects & Eager-Loading Root Causes

### Defect 1: FFmpeg Wrapper Eagerly Loaded by Image Module
- **Files & Lines:** `src/lib/image.ts:1` (`import { runFFmpeg } from './ffmpeg';`)
- **Usage:** Only line 203 (`encodeGif(canvas: HTMLCanvasElement)`) uses `runFFmpeg`.
- **Impact:** Every tool importing utilities from `src/lib/image` (e.g., `IMAGE_ACCEPT`, `decodeImage`, `canvasToBlob`, `loadImage`) transitively pulls in `assets/ffmpeg-CDlynsXJ.js` (5,890 B raw).
- **Routes Affected:** `/image/convert`, `/image/heic-to-jpg`, `/file-converter`, and all 35 image editing/conversion tools.
- **Quantification:** Unnecessary 5.9 KB JS transferred on initial visit for tools that only process PNGs, JPEGs, or WebP.

### Defect 2: JSZip Eagerly Loaded by Batch Converter Shell
- **Files & Lines:**
  - `src/components/BatchResults.tsx:5` (`import { zipFiles } from '../lib/zip';`)
  - `src/lib/zip.ts:1` (`import JSZip from 'jszip';`)
  - `src/tools/image/_convert/Converter.tsx:8` (`import { BatchResults } from '../../../components/BatchResults';`)
- **Impact:** The shared `Converter` component statically renders `BatchResults` for multi-file downloads. Because `zip.ts` statically imports `jszip`, `assets/jszip.min-CIiua8fH.js` (95,932 B raw, 28.5 KB gzip) is fetched on initial page load of every single image converter before the user even uploads a file.
- **Routes Affected:** `/image/convert`, `/image/heic-to-jpg`, `/file-converter`.
- **Quantification:** 95.9 KB JS unnecessarily loaded on initial visit.

### Defect 3: Three.js Runtime Eagerly Loaded on 3D Format Converter
- **Files & Lines:**
  - `src/tools/3d/convert/Tool.tsx:6-14` (Static import: `import { MeshViewer, ... } from '../_ui';`)
  - `src/tools/3d/_ui/MeshViewer.tsx:2-3` (`import * as THREE from 'three';`, `import { OrbitControls } ...`)
- **Impact:** `<MeshViewer>` is only rendered when `currentModel` is non-null (after a file is uploaded and parsed). Because it is imported statically in `Tool.tsx`, `assets/_ui-KVosyZfE.js` (568,871 B raw, 142.5 KB gzip) is loaded immediately on page visit.
- **Routes Affected:** `/3d/convert` (total first load is 1,039,434 B; Three.js constitutes **54.7%** of the transferred route JS).
- **Quantification:** 568.9 KB JS unnecessarily loaded on initial visit.

### Defect 4: `pdf-lib` Eagerly Loaded on PDF Merge & Manipulation Tools
- **Files & Lines:**
  - `src/tools/pdf/merge/Tool.tsx:2` (`import { PDFDocument } from 'pdf-lib';`)
  - `src/tools/pdf/_pages/pdfPages.ts:1` (`import { PDFDocument } from 'pdf-lib';`)
  - `src/tools/pdf/word-to-pdf/convert.ts:1` (`import { PDFDocument } from 'pdf-lib';`)
- **Impact:** `PDFDocument` is only executed when the user triggers the merge/convert action. Because of static imports, `assets/es-CXhQNGVf.js` (425,027 B raw, 177.5 KB gzip) is downloaded before any file is dropped.
- **Routes Affected:** `/pdf/merge` (total first load: 906,125 B; `pdf-lib` constitutes **46.9%** of the payload).
- **Quantification:** 425.0 KB JS unnecessarily loaded on initial visit.

### Defect 5: `ExcelJS` Eagerly Loaded on Excel-to-PDF Tool
- **Files & Lines:**
  - `src/tools/pdf/excel-to-pdf/convert.ts:1` (`import ExcelJS from 'exceljs';`)
  - `src/tools/pdf/excel-to-pdf/Tool.tsx:16` (`import { checkXlsx, excelToPdf } from './convert';`)
- **Impact:** Opening `/pdf/excel-to-pdf` loads `assets/exceljs.min-BHGw0GNu.js` (929,401 B raw, 256.4 KB gzip) and `pdf-lib` (425.0 KB) immediately on route visit before any spreadsheet is dropped.
- **Routes Affected:** `/pdf/excel-to-pdf`.
- **Quantification:** 929.4 KB JS unnecessarily loaded on initial visit.

---

## 7. Prioritized Recommendation List

1. **Priority 1 (High Impact - 568.9 KB JS saved on `/3d/convert`):**
   - Refactor `src/tools/3d/convert/Tool.tsx` and sibling 3D tools to code-split `MeshViewer` via `const MeshViewer = React.lazy(() => import('../_ui/MeshViewer').then(m => ({ default: m.MeshViewer })))`.
   - Defers Three.js and OrbitControls until after a 3D model is chosen and successfully parsed into memory.
2. **Priority 2 (High Impact - 929.4 KB JS saved on `/pdf/excel-to-pdf`):**
   - Refactor `src/tools/pdf/excel-to-pdf/convert.ts` to replace top-level `import ExcelJS from 'exceljs'` with `const { default: ExcelJS } = await import('exceljs')` inside `checkXlsx` and `excelToPdf`.
3. **Priority 3 (High Impact - 425.0 KB JS saved on `/pdf/merge`):**
   - Refactor `src/tools/pdf/merge/Tool.tsx` and `src/tools/pdf/_pages/pdfPages.ts` to dynamically import `PDFDocument` inside the execution action rather than at top-level module scope.
4. **Priority 4 (Medium Impact - 95.9 KB JS saved across all image converters):**
   - Refactor `src/lib/zip.ts` so `JSZip` is imported dynamically inside `zipFiles()` (`const { default: JSZip } = await import('jszip')`).
   - Prevents `jszip.min.js` from being downloaded eagerly on all image tools using `BatchResults`.
5. **Priority 5 (Low Impact / Architectural Cleanup - 5.9 KB JS saved on image routes):**
   - Refactor `src/lib/image.ts` line 203 (`encodeGif`) to use dynamic `const { runFFmpeg } = await import('./ffmpeg')`.
   - Eliminates the static dependency link between the general image library and the FFmpeg loader.
6. **Priority 6 (Hosting / Ops):**
   - Add production header rules (e.g. `_headers` or server configuration) to set `Cache-Control: public, max-age=31536000, immutable` for `/assets/*` and `Cache-Control: no-cache` for `/index.html`.

---

## 8. After the Lazy-Loading Fixes (2026-10-21)

The five eager-loading defects in section 6 were fixed and the same measurement was repeated against a fresh production build. The build command was:

```bash
flock /tmp/loconvert-heavy.lock systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 \
  npx vite build --outDir /tmp/lc-final-dist --emptyOutDir
```

The preview server ran on port 5304. Each route was opened in a fresh Chromium context with an empty cache, and response bodies were summed until network idle. Script: `/tmp/lc-e2e/measure-perf-after.mjs`; raw output: `/tmp/lc-perf-after/summary.json`.

| Route | Before | After | Change |
|---|---:|---:|---:|
| `/` | 482,538 B | 494,944 B | +12,406 B |
| `/video/compress` | 479,557 B | 494,787 B | +15,230 B |
| `/image/heic-to-jpg` | 589,690 B | 501,689 B | **−88,001 B** |
| `/image/convert` | 589,589 B | 501,588 B | **−88,001 B** |
| `/pdf/merge` | 906,125 B | 496,922 B | **−409,203 B** |
| `/file-converter` | 695,713 B | 613,612 B | **−82,101 B** |
| `/3d/convert` | 1,039,434 B | 493,203 B | **−546,231 B** |
| `/pdf/excel-to-pdf` | not measured | 512,789 B | ExcelJS absent |

The small increases on `/` and `/video/compress` come from the accessibility and error-handling additions in this pass (`+6 KB` CSS, a few KB of JS); the lazy-loading changes did not add requests to those routes. The production output is 102,114,953 bytes across 332 files, up from 102,083,622 bytes across 328 files. The four extra files are the lazily loaded `MeshCanvas` chunk and the split PDF/Excel chunks; total bytes are effectively unchanged.

### Eager-load assertions

All five assertions passed:

1. `/image/convert` does not request JSZip before a file is chosen.
2. `/image/convert` does not request the FFmpeg wrapper before a file is chosen.
3. `/pdf/merge` does not request `pdf-lib` (`es-*.js`) before a file is chosen.
4. `/pdf/excel-to-pdf` does not request ExcelJS before a file is chosen.
5. `/3d/convert` does not request Three.js or `MeshCanvas` before a file is chosen.

### Functional smoke tests

All four flows completed in the production preview:

| Flow | Result |
|---|---|
| 3D convert: STL upload, viewer toolbar appears, Three.js loads on demand | PASS |
| Image convert: PNG → JPG, Download button appears | PASS |
| PDF merge: two PDFs, `merged.pdf` available | PASS |
| XLSX → PDF: spreadsheet converts, Download button appears | PASS |

### Production route smoke

A Chromium crawl of the home and category pages found 133 unique tool and page routes. Each route was loaded directly from the production preview and checked for a rendered `h1`, a `main` element, no error boundary, no 404 page, no page errors and no HTTP error. All 133 routes passed.

```bash
flock /tmp/loconvert-heavy.lock systemd-run --user --scope \
  --working-directory=/tmp/lc-e2e -p MemoryMax=3G -p MemorySwapMax=0 \
  node route-smoke.mjs
```

Raw output: `/tmp/lc-e2e/out-route-smoke.json` (`failed: 0`).

### Remaining opportunities

- `/file-converter` still eagerly loads the FFmpeg wrapper and `docxRenderer` (`docxRenderer-D6gZJlGZ.js`, about 100 KB) because the converter shell imports both engines. The FFmpeg core WASM remains lazy.
- `/pdf/merge` downloads a small QPDF wrapper (`qpdf-DNPouHQJ.js`) on first visit; the 1.33 MB QPDF WASM remains lazy.
- The hosting cache recommendation in Priority 6 is still open.
