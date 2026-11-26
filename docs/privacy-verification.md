# Imported-Markup Privacy Boundary Verification Report

## 1. Overview & Verification Scope

This report documents the concrete implementation and empirical browser-level verification of imported-markup privacy boundaries across client-side parsing, rendering, and conversion workflows in Loconvert.

### Verified Scopes:
- `src/lib/inertMarkup.ts` (shared zero-dependency sanitization primitives)
- `src/tools/mhtml-to-html/mhtml.ts` & `Tool.tsx` (MHTML archive extraction & sanitization)
- `src/tools/css-viewer/Tool.tsx` (CSS rawtext breakout neutralization & sample HTML sanitization)
- `src/tools/pdf/_render/render.ts` (`createStage` isolated realm & DOM pre-render sanitization)
- `src/tools/pdf/html-to-pdf/convert.ts` (HTML pre-render sanitization & PDF conversion)
- `src/tools/pdf/word-to-pdf/convert.ts` (DOCX archive `.rels` relationship neutralization)
- `src/tools/pdf/powerpoint-to-pdf/convert.ts` (PPTX archive `.rels` relationship neutralization)
- `src/tools/pdf/_pages/verify.ts` (QPDF AES-256 encryption, decryption, and relationship checks)

### Dependency & Build Integrity:
- **`package-lock.json` SHA-256:** `e9e1d1f7ffbdcff39f9644d58ba4d7760996832fe66b820365da44076dc815cd` (verified unchanged).
- **Dependency installation:** `flock /tmp/loconvert-heavy.lock systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 npm ci` resolved missing remote design packages (`lucide-react`, `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`).
- **Full Typecheck:** `./node_modules/.bin/tsc --noEmit -p .` completed cleanly with **0 errors** across all files in the repository.
- **Production Build:** `npm run build` completed cleanly (exit 0) emitting all scoped bundles and Geist fonts into `dist/assets/`.

---

## 2. Genuine Failure Observed & Minimal Remediation

### Defect: Broken DOCTYPE Internal Subset `[...]` Stripping in `neutralizeOfficeRels`
- **Location:** [src/lib/inertMarkup.ts](../src/lib/inertMarkup.ts)
- **Symptom:** In browser environments where `DOMParser` is active, XML `.rels` files containing `<!DOCTYPE ... [ <!ENTITY ...> ]>` failed parsing with `parsererror` because the original regex `/<!DOCTYPE[\s\S]*?>/gi` terminated at the first `>` inside the entity declaration, leaving trailing `\n]>\n` before `<Relationships>`. In Node CLI runs, this failure was masked because Node lacked `DOMParser` and took the regex fallback.
- **Fix:** Enhanced the DTD stripping regex to match bracketed internal subsets:
  ```ts
  const cleanXml = relsXml
    .replace(/<!DOCTYPE\s+[^>\[]+(?:\[[\s\S]*?\])?\s*>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '');
  ```
- **Result:** Browser `DOMParser` now cleanly parses, neutralizes external relationships, and serializes XML with 0 parse errors.

---

## 3. Live Browser Network Request Verification (Port 5301)

Instead of relying solely on in-memory string checks or dev server console output, live network request verification was performed using a dedicated local HTTP server serving the production `dist/` on port 5301, configured to record all same-origin requests matching `/privacy-canary*`.

### 3.1 Positive Control & Canary Counter Calibration
- **Positive Control Request:** A deliberate HTTP GET request to `http://localhost:5301/privacy-canary-positive-control` was sent.
- **Result:** Counter incremented to **1** (`{"hits":[{"url":"/privacy-canary-positive-control","method":"GET"}],"count":1}`).
- **Reset:** Counter was reset via `/_canary_reset` and confirmed **0**.

### 3.2 Tested Output Flows & Egress Audit

| Flow / Tool | Attack / Canary Surface Injected | Verification Method & Environment | Network Hits to `/privacy-canary*` | Functional Output Integrity |
|---|---|---|:---:|---|
| **MHTML to HTML** (`/mhtml-to-html`) | Quoted CSS `@import`, escaped URL, relative URL `/privacy-canary-relative.png`, `srcset`, SVG `<use>`, `<feImage>`, `<object>`, `<iframe>`, `<form>`, `<base>`, `<meta refresh>` | File upload in production UI; parsed & converted in both Standalone and ZIP modes; previewed in UI iframe | **0** | **3 assets resolved, 11 remote refs blocked**; embedded PNG loaded and confirmed non-blank via 2x2 canvas pixel inspection; safe assets emitted to ZIP. |
| **MHTML Standalone Export (Unsandboxed)** | Standalone converted HTML loaded in browser | Converted HTML rendered directly in an **unsandboxed** `<iframe>` (without `sandbox` attribute) to verify defense-in-depth without relying solely on sandbox | **0** | Embedded 2x2 image loaded (`naturalWidth: 2, naturalHeight: 2`), canvas pixel data confirmed non-blank. |
| **CSS Viewer** (`/css-viewer`) | Closing `</style>` variants (`</style>`, `</style >`, `</style\t>`, `</style\n>`, `</style/x>`, `</style attr="bar">`) with meta-refresh, sample HTML forms, frames, and outbound links | Injected into CSS and HTML live editors; observed DOM structure, host styles, and iframe rendering | **0** | Closing tag variants neutralized via `escapeStyleTagBreakout`; host styles unaffected; built-in presets (`card`, `buttons`, `form`, `typography`) rendered without error. |
| **Office .rels Neutralization** (`word-to-pdf`, `powerpoint-to-pdf`) | Single-quoted, double-quoted, non-self-closing `<Relationship>`, protocol-relative `//`, entity-encoded targets, DTD entities | Tested via browser DOMParser & XMLSerializer in live browser preview | **0** | Internal image targets (`media/image1.png`) preserved 100%; external images replaced with 1x1 transparent PNG data URIs; external links converted to `#`. |
| **HTML to PDF** (`/pdf/html-to-pdf`) | HTML containing styled tables, embedded data URI image, external canary link and external canary image | Executed real end-to-end conversion via production UI | **0** | Emitted **72.2 KB PDF** with 1 page; `PDFDocument.load()` verified exact dimensions (`595.28 x 841.89` pt); external image replaced with alt text placeholder. |

---

## 4. Test Suite Execution: CLI vs. Browser Distinction

Earlier reports did not distinguish between tests that executed in Node CLI versus those conditionally skipped due to missing Web Workers or DOM APIs. Below is the precise breakdown:

### 4.1 Focused Module Regressions in Node CLI (`npx tsx`)

```
1. src/tools/_tabular/verify.ts:
   - 10 / 10 checks PASSED (quoted multiline CSV, duplicate header rejection, malformed header rejection, leading zeros, prototype safety, BOM handling, JSON-CSV union).

2. src/tools/_file-utility/verify.ts:
   - 67 / 67 checks PASSED (MD5/SHA streaming hashes, filename collision and padding, ZIP archive verification, BMFF/RIFF/EBML media headers, CSP/sandbox assertions).

3. src/tools/mhtml-to-html/verify.ts:
   - All MHTML parser & conversion unit assertions PASSED (MIME unfolding, Quoted-Printable decoding, Base64 decoding, CSP injection, leak neutralization).

4. src/tools/css-viewer/verify.ts:
   - All CSS viewer assertions PASSED (7 closing style tag variants, sample HTML sanitization, 4 presets validity).

5. src/tools/pdf/_pages/verify.ts (in Node CLI):
   - Test 1 (Encrypted PDF Handling): SKIPPED in CLI (Worker undefined in Node environment).
   - Test 2 (Dangling Link / Cross-Page Destination): PASSED (0 deleted /Page objects copied).
   - Test 3 (Office .rels XML Neutralization): PASSED (via Node regex fallback).
   - Test 4 (HTML/DOM Canary Sanitization Pre-Render): PASSED (User HTML canary neutralized).
   - Test 5 (createStage Isolation): SKIPPED in CLI (document undefined in Node environment).
```

### 4.2 Browser Preview Verification (`preview_evaluate` in Chromium)

To eliminate the CLI skip limitations, the browser-dependent tests were executed inside the live browser preview session:

- **QPDF Worker AES-256 Encryption & Decryption (Test 1):**
  - Generated PDF fixture in memory via `PDFDocument.create()`.
  - Encrypted with AES-256 via `runQpdf` running the compiled WASM Web Worker (`qpdf.worker-B_TT0lpV.js`).
  - Confirmed `isEncrypted === true`.
  - Tested wrong password: rejected as expected (`wrongPwFailed === true`).
  - Decrypted with correct password: recovered document successfully loaded into `PDFDocument` with 1 page.
  - **Status: EXECUTED & PASSED in Browser.**

- **`createStage` Isolated Realm (Test 5):**
  - Verified `createStage` constructs an isolated `<iframe>` with `sandbox="allow-same-origin"` and explicit Content-Security-Policy meta tag (`default-src 'none'; base-uri 'none'`).
  - Confirmed fail-closed behavior without falling back to host document.
  - **Status: EXECUTED & PASSED in Browser.**

---

## 5. Historical Record (Superseded Prior Report)

<details>
<summary>Click to view superseded historical report from prior agent run</summary>

> **Note:** The text below represents the preliminary evaluation before lockfile dependencies (`lucide-react`, Geist fonts) were installed and before live same-origin canary request tracking was conducted. In the earlier run, Node CLI skips were summarized as passes and `tsc` had 15 errors in shared layout components. Both limitations have now been resolved.

*(Historical summary preserved for provenance: Prior agent verified static string assertions and observed 15 TypeScript diagnostics in remote components due to missing node_modules. Production preview on port 5301 confirmed route 200 HTTP responses. The current verification supersedes this by installing all dependencies, fixing the DOCTYPE parser defect, and verifying actual 0 network egress.)*
</details>

---

## 6. Concrete Boundaries & Limitations

1. **Pre-Render Sanitization vs. Sandbox:** Loconvert implements defense-in-depth: HTML and CSS text are sanitized prior to staging, and staging/preview occurs inside CSP-isolated and sandboxed iframes. While this blocks network egress for all tested browser attack surfaces (relative URLs, unescaped URLs, CSS imports, style tag breakouts, inline handlers, SVG use/feImage, and office relationships), users should avoid importing untrusted files containing malicious payloads in browsers with broken sandbox implementations.
2. **External Relationships in Office Files:** When DOCX or PPTX documents contain external image links or external hyperlinks, Loconvert intentionally neutralizes external images to 1x1 transparent PNG data URIs and external hyperlinks to `#`. This prevents remote data leakage but means external images will not render in the converted PDF.
3. **No Unbounded Memory Usage:** All builds and heavy test scripts run capped under `systemd-run -p MemoryMax=3G` or `MemoryMax=1G` to guarantee system stability and preserve >=4 GiB host headroom.
