# Quality Verification: lc-robust, lc-error-boundary, lc-404, lc-codec-errors

## 1. Overview & File Scope

This verification report covers the implementation and validation of Taproot tasks `lc-robust`, `lc-error-boundary`, `lc-404`, and `lc-codec-errors`.

### File Scope
- [`src/App.tsx`](../src/App.tsx): Wrapped each tool route element in `<RouteErrorBoundary>`; replaced home wildcard redirect with `<NotFound />`.
- [`src/components/ErrorBoundary.tsx`](../src/components/ErrorBoundary.tsx) (new): Class component with `getDerivedStateFromError` and `componentDidCatch`, friendly error panel, privacy reassurance, "Try again" reset button, "Back to all tools" navigation, and `RouteErrorBoundary` functional wrapper resetting on pathname changes.
- [`src/pages/NotFound.tsx`](../src/pages/NotFound.tsx) (new): Real 404 page with page heading, short copy, media category cards linking to `/video`, `/image`, `/file`, `/pdf`, `/3d`, and document title update.
- [`src/lib/errors.ts`](../src/lib/errors.ts) (new): `describeError(err: unknown): string` with case-insensitive mapping for AVIF encode unsupported, HEIC/HEIF decode failures, JPEG XL decode failures, FFmpeg stream errors, encoder missing, out-of-memory, Canvas 2D unavailability, and corrupt images. Preserves original message when unmapped.
- [`src/design/errors.css`](../src/design/errors.css) (new): Light and dark theme styles using existing design tokens (`tokens.css`) for error panels, cards, and 404 links.
- [`src/lib/useJob.ts`](../src/lib/useJob.ts): Adopted `describeError(err)` in `run()` catch handler to automatically format errors across all job-based tools.
- [`src/lib/image.ts`](../src/lib/image.ts): Wrapped HEIC/HEIF and JPEG XL decode failures with format-specific context while preserving AVIF fallbacks and encoding behaviors.
- [`docs/quality-verification.md`](./quality-verification.md) (new): Verification report.

---

## 2. Before vs. After State

| Feature | Before | After |
| :--- | :--- | :--- |
| **Wildcard route** | `<Navigate to="/" replace />` silently redirected unmapped paths back to the home page. | `<NotFound />` displays dedicated 404 page with clear heading, description, document title, and category links to `/video`, `/image`, `/file`, `/pdf`, `/3d`. |
| **Tool crash behavior** | Uncaught component render error or import failure blanked out the entire application shell. | `<RouteErrorBoundary>` catches tool render failures inside the route outlet, keeping `<Layout>` (header, footer, navigation) intact and rendering a recovery panel. |
| **Error boundary reset** | None existed. | Supports in-place reset via "Try again" button, and automatic reset on pathname change via `key={location.pathname}` wrapper. |
| **Codec error messages** | Raw internal errors (e.g. `FFmpeg exited with code 1: [mov,mp4 @ ...] Invalid data found`, `Array buffer allocation failed`, unhandled HEIC errors). | Mapped to friendly messages identifying the problem, explaining device privacy, and suggesting concrete alternative formats (e.g., MP4/WebM/PNG) or browsers (Safari for HEIF, Chrome/Firefox). Unmatched messages remain preserved. |
| **HEIC & JXL decoding** | Raw exceptions bubble up without format context. | Wrapped in `decodeImage` with specific format context (`HEIC/HEIF decode failure: ...`, `JPEG XL decode failure: ...`). |

---

## 3. Verification Evidence

### 3.1 Typecheck Verification
Executed under shared lock and resource cap:
```bash
flock /tmp/loconvert-heavy.lock systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 npx tsc --noEmit -p .
```
- **Exit Code**: `0`
- **Output**: Clean compilation with 0 TypeScript diagnostics across strict project configuration.

### 3.2 Unit Verification: `describeError` Mapping
Tested with 13 cases covering exact strings, regex patterns, case-insensitivity, and error object varieties:
- **AVIF encode unsupported**: `This browser cannot encode AVIF images...` -> `"AVIF encoding is unsupported in this browser. Try Chrome or Firefox, or export as WebP or PNG instead."`
- **HEIC/HEIF decode failure**: `HEIC/HEIF decode failure: could not decode "photo.HEIC"` -> `"HEIC/HEIF decode failure: the image could not be decoded. Safari natively supports HEIF, or you can convert the photo to JPEG or PNG before uploading."`
- **JPEG XL decode failure**: `JPEG XL decode failure: could not decode "sample.jxl"` -> `"JPEG XL decode failure: the JXL file could not be decoded. Try converting to PNG or WebP in an external image viewer, or view in a browser with JPEG XL enabled."`
- **FFmpeg "Invalid data found"**: `[mov,mp4 @ 0x123] Invalid data found when processing input` -> `"Unsupported or corrupt media: FFmpeg could not read this codec or stream. Try converting the media file to standard MP4 (H.264/AAC) using VLC or another desktop tool first."`
- **FFmpeg "could not find codec parameters"**: Matched and mapped to stream failure description.
- **FFmpeg "Unknown decoder"**: Matched and mapped to stream failure description.
- **FFmpeg "Encoder not found" / "Unknown encoder"**: Matched and mapped to `"Encoder not found: the requested output codec is not supported by the in-browser encoder. Try choosing MP4 (H.264) or WebM (VP8/VP9) as your output format."`
- **Array buffer allocation failed / Out of memory**: `RangeError: Array buffer allocation failed` and `"out of memory"` -> `"Out of memory: the browser ran out of memory while processing this file. Try closing other tabs, using a 64-bit desktop browser (Chrome or Firefox), or reducing the file size/resolution."`
- **Canvas 2D is not available**: `Error: Canvas 2D is not available in this browser.` -> `"Canvas 2D is not available: your browser could not initialize a 2D canvas context. Check browser hardware acceleration settings or try Chrome or Firefox."`
- **Unreadable or corrupt image**: `This image could not be decoded. The file may be corrupt or in an unsupported format.` -> `"Unreadable or corrupt image: the image file could not be decoded. The file may be damaged or in an unsupported format. Try opening and saving it in an image editor first, or converting to PNG/JPEG."`
- **Unmapped errors**: `Special custom error occurred.` -> Preserved raw message `"Special custom error occurred."`.

All 13 test cases passed. Nine representative mappings are now covered by `src/lib/errors.test.ts` in the Vitest suite.

### 3.3 Dev Server E2E Verification (Playwright Chromium)
Dev server running at `http://localhost:5300`. Ran tests using `/tmp/lc-e2e/node_modules/playwright-core` with Chromium headless shell:

1. **404 Route (`/random-unknown-url`)**:
   - Page loaded with title: `Page not found · Loconvert`
   - Heading `h1`: `Page not found`
   - Description confirms tool not found.
   - All 5 category links (`/video`, `/image`, `/file`, `/pdf`, `/3d`) rendered and tested; clicking each link navigated to the appropriate media index page.
2. **Legacy Route & Design Page**:
   - Navigating to `/trim` redirected via React Router to `/video/trim`.
   - Navigating to `/design` rendered living style guide heading `Design system`.
3. **Route Error Boundary & Recovery**:
   - Temporarily injected simulated error throw inside tool route component in `src/App.tsx`.
   - Navigated to `/image/compress`:
     - App header (`.site-header`) and footer (`.site-footer`) remained visible and interactive (no white screen / blank app).
     - Error panel rendered: Heading `This tool stopped responding`, message explaining files stayed safely on device.
     - "Try again" button rendered and active.
     - "Back to all tools" link rendered.
   - Clicked "Try again" after clearing fault: component re-rendered tool (`Compress Image`) successfully.
   - Re-triggered error and clicked "Back to all tools": URL transitioned to `/`, error boundary unmounted, and Home page rendered cleanly.
   - Cleaned up test injection: confirmed `git diff` has zero leftover test throws.
4. **Normal Tool Flow**:
   - Navigated to `/image/compress`.
   - Uploaded test fixture `/tmp/lc-e2e/qr.png`.
   - Triggered compression: completed job, progress bar reached 100%, and download button displayed properly.

---

## 4. Git Diff Cleanliness
Verified `git diff` across `src/App.tsx`, `src/lib/useJob.ts`, and `src/lib/image.ts`:
- No experimental code or leftover test throws.
- Only scoped modifications applied.
- No changes made to `package.json`, `registry.ts`, `styles.css`, tool folders, or shared components owned by parallel agents.

---

## 5. Remaining Limitations
- Client-side error boundaries catch React rendering lifecycle and component mount errors; background Web Workers (such as FFmpeg and QPDF worker threads) report failures through promise rejections, which are intercepted by `useJob` and formatted by `describeError`.
