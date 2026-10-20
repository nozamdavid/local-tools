# AVIF Encoding Fallback Verification Report

## Overview
This document records the design, implementation, and verification of the lazy bundled local AVIF WASM encoder fallback for Loconvert.

Previously, `canvasToBlob('image/avif')` relied entirely on native browser support. On browsers without native AVIF canvas encoding, `checkAvifSupport()` hid the AVIF option in Image Converter (`Converter.tsx`) and the Universal File Converter (`matrix.ts`), leaving the promised PNG→AVIF feature unavailable.

To close this gap without bloated architecture or eager network fetches:
1. **Lazy Bundled Local WASM Worker:** Implemented `src/lib/avif.worker.ts` and `src/lib/avif.ts` using `@jsquash/avif` (v2.1.1).
2. **Worker Isolation & Serialization:** Encapsulated in a dedicated Web Worker client with a serialized task queue to prevent main-thread UI lag and memory spikes.
3. **Native-First with WASM Fallback:** `canvasToBlob` in `src/lib/image.ts` checks for native `toBlob('image/avif')` first. If unsupported or failing (null/empty/wrong MIME), it lazily imports `src/lib/avif.ts` and encodes via the worker.
4. **Zero Eager Network / Codec Fetch:** `checkAvifSupport()` in `src/tools/image/_convert/convert.ts` verifies native capability or WebAssembly availability without downloading the WASM binary. Unrelated file tools incur 0 KB overhead.
5. **Strict CSP & Local Bundling:** WASM binary is locally emitted by Vite into `dist/assets/avif_enc-[hash].wasm`, completely adhering to strict Content Security Policy (`'wasm-unsafe-eval'`, no `'unsafe-eval'`, no external uploads).

---

## Verification Test Suite (`src/lib/avif.verify.ts`)

Executed inside the collaborative browser environment via `preview_evaluate`:

| # | Test Name | Result | Details & Key Observations |
|---|---|---|---|
| 1 | Production WASM asset loading & compilation | **PASSED** | Loaded and compiled local 3.32 MB `avif_enc.wasm` into `WebAssembly.Module`; initialized encoder. |
| 2 | Signature detection: ISOBMFF ftyp box and avif brand | **PASSED** | Correctly validated standard 28-byte `ftyp` box with `avif` and `avis` brands; rejected PNG, JPEG, JXL magic bytes, truncated buffers, and empty inputs. Validated content-based detection for renamed `.png` files containing AVIF bytes. |
| 3 | WASM encode & decode: 2x2 RGBA fixture, dimensions and alpha transparency | **PASSED** | Encoded 2x2 fixture (Red, Green, Blue, Yellow with alpha=128) into 515-byte AVIF with valid `ftypavif` header. Decoded with native browser engine: exact dimensions 2x2, semi-transparent alpha preserved (131). |
| 4 | Forced unavailable native toBlob: fallback to WASM worker | **PASSED** | Mocked `HTMLCanvasElement.prototype.toBlob` to simulate browsers lacking native AVIF canvas support (returns `null`). `canvasToBlob` successfully intercepted the failure and executed the WASM worker fallback, emitting 314 bytes of valid AVIF with verified 2x2 dimensions. |
| 5 | Worker pipeline: `encodeAvifCanvas`, `decodeImage`, and `imageToCanvas` | **PASSED** | Directly encoded 4x4 canvas to `image/avif` blob; round-tripped through `decodeImage` into an `HTMLImageElement` (`naturalWidth: 4, naturalHeight: 4`) and re-rendered onto canvas. |
| 6 | Universal converter: detection, selectable target formats, and `convertSingleImage` | **PASSED** | Detected synthetic and misnamed AVIF files; confirmed `checkAvifSupport()` returns `true`; confirmed PNG input offers `avif` target in Universal File Converter; confirmed AVIF input offers PNG/JPG/WebP; verified `convertSingleImage` output. |

**Overall Suite Outcome: 6/6 PASSED**

---

## Production Build & Preview Verification (Port 5301)

Production assets were verified against a clean `dist/` preview on port 5301 under memory bounds (`systemd-run --user --scope -p MemoryMax=1G`):

1. **Emitted Assets:**
   - `dist/assets/avif_enc-Co4TcJko.wasm` (3,485,872 bytes).
   - Local fetch test on port 5301 confirmed `status: 200`, `size: 3485872 bytes`.
2. **Single Image Converter (`/image/convert`):**
   - Uploaded PNG image.
   - Format dropdown correctly populated with `AVIF (Next-generation)`.
   - Converted to AVIF: generated `sample.avif` (314 bytes).
   - Inspected output blob: MIME `image/avif`, size 314 B, dimensions 2x2, signature box `ftyp` with brand `avif`.
3. **Universal File Converter (`/file-converter`):**
   - Uploaded `test.png`.
   - Target format matrix offered `AVIF` alongside JPG, PNG, WEBP, JXL, etc.
   - Converted to AVIF: generated `test.avif` (313 bytes).
   - Inspected output blob: MIME `image/avif`, size 313 B, dimensions 2x2, `ftypavif` signature.
4. **Bulk Image Converter (`/image/bulk-convert`):**
   - Batch of multiple images converted to AVIF and packaged into ZIP (`Download all (.zip)`).
5. **No Regressions on Existing Suites:**
   - `src/lib/jxl.verify.ts` re-run in browser: **8/8 PASSED**.

---

## Technical Limitations & Decode Policy
- **Decoding Policy:** In accordance with task requirements, a standalone 1.1 MB `avif_dec.wasm` decoder was intentionally omitted from the runtime bundle. Modern browsers (Chromium, Firefox, Safari >= 16) decode AVIF natively via `Image` and `createImageBitmap`. Should an environment lack native AVIF decode support, images remain downloadable, while preview honestly reports decode limits.
- **Encoding Dimensions:** Worker enforces bounded limits (max 16,384 px per side, max 40 megapixels) to prevent out-of-memory crashes on consumer devices.
