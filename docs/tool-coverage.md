# Tool Coverage & Source Mapping Report

## Overview
This document maps all 15 source entries from WebUtilityHub (`/category/converter/` and `/category/file-utility/`) to their Loconvert implementation, route, registration details, verified behavior, and limitations.

Loconvert processes supported files locally in the user's web browser using client-side WebAssembly (WASM), Web Workers, and WebGPU. User file content is not transmitted to external servers. Static assets, compiled WASM codecs, and model weights are downloaded to the browser from static hosting as needed.

---

## 15 Source Entries Mapping

### Category: Converter (8 Tools)

| # | Source Tool | Loconvert Tool ID | Route | Registration / Status | Verified Behavior | Limitations & Technical Details |
|---|---|---|---|---|---|---|
| 1 | **Video to MP3** | `audio-extract` | `/video/audio-extract` | Existing tool in `video-audio` category (`video('audio-extract', 'Video to MP3 & Audio Extract', ...)`) | Extracts audio tracks from MP4, WebM, MOV, MKV, AVI files into MP3, AAC, or WAV using FFmpeg WASM. | Requires browser WebAssembly support. Bitrate selection up to 320 kbps. |
| 2 | **AVIF ↔ PNG** | `img-convert` & `file-converter` | `/image/convert`, `/file-converter` | Existing tool in `image-convert` category and promoted `file-converter` | Bidirectional conversion between supported formats (AVIF, PNG, JPG, WebP, JXL, BMP, GIF) via Canvas API and local codecs (WASM for JXL). | AVIF encoding relies on browser native canvas `toBlob('image/avif')` support across both dedicated and universal converter tools; browsers without native AVIF canvas encoding cannot export AVIF (no standalone WASM fallback). |
| 3 | **MHTML to HTML** | `mhtml-to-html` | `/mhtml-to-html` | Registered in `file-convert` (`fileTool('mhtml-to-html', ...)`) | Parses RFC 2557 / MIME multipart web archives (`.mhtml`, `.mht`), extracts HTML and embedded assets (images, CSS, fonts), and repacks into a standalone self-contained HTML file. | Embedded active scripts are neutralized to maintain client-side security. |
| 4 | **GPX ↔ KML** | `gpx-kml` | `/gpx-kml` | Registered in `file-convert` (`fileTool('gpx-kml', ...)`) | Bidirectional conversion between GPS Exchange Format (`.gpx`) and Keyhole Markup Language (`.kml`). Parses waypoints, tracks (`<trk>`), and routes (`<rte>`). | Supports standard GPS coordinates (WGS84). 3D altitude preserved when available. |
| 5 | **Image to SVG** | `img-image-to-svg` | `/image/image-to-svg` | Registered in `image-convert` (`image('image-to-svg', ...)`) | Converts raster images (PNG, JPG, WebP) into vector SVG either via clean base64 data raster encapsulation or pixel geometric vector shape generation (`<rect>` runs). | Pixel vector mode optimized for pixel art and icons up to 128×128 px to avoid oversized SVG DOM. |
| 6 | **Icon Converter (ICO ↔ PNG)** | `img-icon-converter` | `/image/icon-converter` | Registered in `image-convert` (`image('icon-converter', ...)`) | Unpacks multi-frame Windows `.ico` files into individual PNGs, or generates standard multi-resolution `.ico` bundles (16, 32, 48, 64, 128, 256 px). | Adheres to Windows Icon Directory specifications, supporting both PNG-compressed and BMP DIB frame formats. |
| 7 | **TXT to CSV** | `txt-to-csv` | `/txt-to-csv` | Registered in `file-data` (`fileTool('txt-to-csv', ...)`) | Converts plain text, logs, and delimited records into standardized CSV. Automatically detects comma, tab, semicolon, or pipe delimiters (or accepts custom character); handles embedded quotes and multiline cells. | Preserves UTF-8 encoding. In-browser table preview is bounded to the first 25 rows without search or pagination; full converted CSV is downloadable. |
| 8 | **JSON ↔ CSV** | `json-csv` | `/json-csv` | Registered in `file-data` (`fileTool('json-csv', ...)`) | Bidirectional conversion between structured JSON arrays/objects and tabular CSV. Maps objects to CSV using union headers across all records, and serializes nested objects/arrays as JSON strings within cells; converts CSV back to flat object records. | Does not flatten nested JSON paths or reconstruct deep nested objects from dotted CSV headers (nested values remain JSON-stringified). Rejects duplicate header names with descriptive syntax diagnostics. |

---

### Category: File Utility (7 Tools)

| # | Source Tool | Loconvert Tool ID | Route | Registration / Status | Verified Behavior | Limitations & Technical Details |
|---|---|---|---|---|---|---|
| 9 | **CSV Viewer** | `csv-viewer` | `/csv-viewer` | Registered in `file-data` (`fileTool('csv-viewer', ...)`) | Interactive read-only in-browser tabular viewer. Supports multi-column text search filtering, configurable pagination (10/25/50/100 rows per page), auto-detected or manual delimiter selection, first-row header toggle, visible-page TSV clipboard copy, and CSV export. | Read-only viewer: does not support column sorting, direct cell editing, or chunked streaming. Entire file is read into client memory as text. |
| 10 | **File Inspector** | `file-inspector` | `/file-inspector` | Registered in `file-utility` (`fileTool('file-inspector', ...)`) | Binary magic-byte analysis, MIME signature identification, hex dump viewer, SHA-256 / MD5 cryptographic hashes, and file extension mismatch alerts. | Inspects initial 4 KB for signatures and streams full buffer for checksums. |
| 11 | **Batch File Rename** | `batch-rename` | `/batch-rename` | Registered in `file-utility` (`fileTool('batch-rename', ...)`) | Batch filename transformation supporting custom base name or original name, sequential numbering (configurable start, padding, prefix/suffix, separator), case transforms (lowercase, uppercase, title case), extension preservation (dotfiles and compound extensions like `.tar.gz`), collision detection/resolution, and one-click ZIP download. | Generates client-side ZIP via `jszip` with original file contents intact. Displays memory advisory if batch exceeds 1 GB. |
| 12 | **Video Health Inspector** | `video-health` | `/video-health` | Registered in `file-utility` (`fileTool('video-health', ...)`) | Inspects MP4/MOV (BMFF), WebM/MKV (EBML), and AVI (RIFF) containers: checks magic signatures, atom/segment boundaries, truncation, declared vs actual container sizes, missing `moov`/`mdat` atoms, and probes browser native playability metadata. | Atom-level and container boundary inspection plus native browser playability probe. Does not analyze audio/video stream sync, packet-level decoding, or full frame integrity. |
| 13 | **CSS Viewer** | `css-viewer` | `/css-viewer` | Registered in `file-utility` (`fileTool('css-viewer', ...)`) | In-browser sandboxed live CSS/HTML preview with responsive viewport controls (desktop, tablet, mobile), component presets (card, buttons, form, typography), copy/download actions, and partial browser CSS parsing diagnostics (rule, media query, and keyframe counts, CSP warning heuristics). | Uses browser `CSSStyleSheet` inspection and heuristic regex parsing inside a sandboxed iframe with strict CSP. Does not perform formatting/beautification, minification, full CSS AST parsing/manipulation, or color palette extraction (future palette task deferred). |
| 14 | **Signature Cleaner** | `img-signature-cleaner` | `/image/signature-cleaner` | Registered in `image-edit` (`image('signature-cleaner', ...)`) | Extracts handwritten ink from scanned or photographed paper signatures and stamps. Neutralizes white/off-white background to transparent alpha or white while preserving dark ink strokes and saturated colored inks (stamp chroma protection). | Deterministic pixel processing using perceptual luminance, configurable threshold, edge detail feathering, contrast curve, and ink bounding-box auto-crop. Does not use AI or generic noise-removal algorithms. |
| 15 | **Blur Image & Solid Redaction** | `img-blur` | `/image/blur` | Existing tool in `image-edit` (`image('blur', ...)`) | Area-based privacy protection: Gaussian blur, pixelation, and opaque solid redaction boxes (`#000000` or custom color) permanently burned into the exported canvas. | Irreversible redaction: underlying pixels are completely overwritten before export. |

---

## Universal Format Converter (`file-converter`)
- **Route:** `/file-converter` (promoted on Home and Navigation)
- **Engine:** `src/tools/file-converter/engines.ts`
- **Supported Families:** Images, Videos, Audio, Documents (DOCX, PDF), Data & Text (JSON, CSV, TSV).
- **Format Detection:** Inspects true binary magic bytes independently of file extensions via `src/tools/file-converter/detect.ts`.
- **Office Document Limitations:** Document conversions (such as DOCX to PDF/images) render client-side via DOM and canvas elements (`docx-preview`), which has inherent layout and font rendering constraints compared to native desktop office applications.
- **AVIF Encoding Support:** Encoding to AVIF relies entirely on native browser canvas `toBlob('image/avif')` support without a standalone WASM encoder fallback.

---

## JPEG XL (JXL) Implementation Notes
- **Local WASM Stack:** Uses `@jsquash/jxl` with dedicated `jxl_enc.wasm` and `jxl_dec.wasm` compiled binaries.
- **Worker Isolation:** Encapsulated inside `src/lib/jxl.worker.ts` with serialized job queue (`JxlClient`) to prevent UI thread blocking and memory spikes.
- **SDR Canvas Pipeline:** Encodes standard 8-bit RGBA pixel buffers into `.jxl` (supporting both lossless and quality-controlled lossy compression).
- **Signature Detection:** Recognizes both raw codestream (`0xFF 0x0A`) and 12-byte container (`0x00 0x00 0x00 0x0C 0x4A 0x58 0x4C 0x20 0x0D 0x0A 0x87 0x0A`).
- **Browser Preview Fallback:** For browsers without native JPEG XL decoding support, `ResultPanel` asynchronously decodes the output JXL into a PNG blob preview with automatic object URL lifecycle revocation. A global error-capture fallback in `src/lib/jxl.ts` acts as a secondary safety net.

---

## Verification Evidence
- **Browser Module Test Suites:**
  - `src/lib/jxl.verify.ts`: 8/8 tests passed (WASM asset loading, signature detection, lossless & lossy roundtrip, container format, worker pipeline).
  - `src/tools/image/_utility/verify.ts`: 24/24 tests passed (SVG embedding, pixel SVG runs, ICO frames & masks, signature cleaning, solid redaction).
  - `src/tools/_tabular/verify.ts`: Passed (CSV parsing, quoted multiline cells, delimiter detection, JSON conversion).
  - `src/tools/mhtml-to-html/verify.ts`: Passed (multipart boundary parsing, HTML extraction, embedded image inlining).
  - `src/tools/gpx-kml/verify.ts`: Passed (XML parsing, coordinate transformation, track & waypoint roundtrips).
  - `src/tools/pdf/_stamp/verify.ts`: Passed (rotation coordinate mappings, page numbering, watermark stamping, signature placement).
  - `src/tools/pdf/_pages/verify.ts`: Passed (QPDF AES-256 encryption, decryption retry, dangling link purge).
