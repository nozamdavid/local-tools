# Accessibility verification

Taproot node: `lc-a11y` (Accessibility pass for the app shell and shared tool UI).

This page records what was scanned and tested, the numbers before and after the changes, and what is still open. It does not claim conformance with WCAG or any other standard. Automated checks find a subset of problems, and the manual keyboard checks cover the paths listed below only. No screen reader was used.

## Method

- Tool: axe-core (installed outside the repo in `/tmp/lc-a11y`, `package.json` untouched) run through Playwright Chromium against the Vite dev server at `http://localhost:5300`.
- Scan matrix: 14 routes × 2 viewports (1280×900, 390×844) × 2 themes (light, and dark via `prefers-color-scheme: dark`) = 56 scans.
- Routes: `/`, `/file`, `/video`, `/image`, `/pdf`, `/3d`, `/design`, `/video/compress`, `/video/trim`, `/image/compress`, `/image/photo-editor`, `/pdf/merge`, `/file-converter`, `/3d/convert`.
- Each page was scanned in its initial state (before any file is loaded), after the network went idle plus a short settle delay. All axe rules were enabled, including best-practice rules.
- Extra states scanned once at 1280×900 or 390×844 light: mega menu open, command palette open, mobile menu open, profile-resizer with an image loaded.
- A wider sweep covered all 140 routes reachable from the five index pages (same two viewports and themes, initial state, 560 scans). It ran only after the fixes: the first attempt hit Vite error overlays from other agents' in-progress edits, so there is no clean before number for it.
- Scripts (throwaway, not committed): `/tmp/lc-e2e/a11y-axe.mjs`, `a11y-all.mjs`, `a11y-keys.mjs`, `a11y-motion.mjs`. Raw results: `/tmp/lc-e2e/out-a11y/axe-before.json`, `axe-after.json`, `axe-all-final.json`, `keyboard-log.txt`.

## Results: 14 audited routes (56 scans)

Counts are violating nodes summed over all 56 scans.

| Rule | Impact | Before | After |
| --- | --- | ---: | ---: |
| `color-contrast` | serious | 158 | 0 |
| `label-content-name-mismatch` | serious | 36 | 0 |
| `nested-interactive` | serious | 36 | 0 |
| **Total** | | **230** | **0** |

By impact: serious 230 → 0, critical 0 → 0, moderate 0 → 0, minor 0 → 0.

What caused the before counts:

- `color-contrast` (158): `--text-subtle` was 2.55–2.76:1 on light surfaces and 3.63–3.89:1 on dark ones (footer text, hero search hint, header search label, category counts); `badge-neutral` muted text was 4.28:1; the dark `btn-danger` (white on `#e5383b`) was 4.23:1; the dark 3D media tone (`#c936ae` text on `#14161b`) was 3.98:1.
- `label-content-name-mismatch` and `nested-interactive` (36 each, one per scan of `/`, `/design` and every tool route with a drop zone): the `FileDrop` zone was a `role="button"` that contained a second button, and its `aria-label` did not contain its visible text.

The wider sweep of 140 routes (560 scans, after the fixes) still reports violations on 12 routes. All are inside individual tool pages and are listed under Known issues.

## Changes

Tokens and base styles (`src/design/tokens.css`, `base.css`, `components.css`, `src/styles.css`)

- `--text-muted` light is now `--gray-600`; `--text-subtle` is `--gray-550` (new) in light and `--gray-450` (new) in dark. All pass 4.5:1 on every surface token in both themes.
- `--danger-solid` is `--red-600` in both themes (white text 5.7:1). `--media-3d` uses `--berry-400` in dark (5.7:1 on the dark surface).
- Focus: buttons, inputs, selects, sliders, switches, segmented options, tool cards and the filter field now show a 2px solid accent outline in addition to the soft ring. Previously several removed the outline and relied on a 40% alpha ring. The palette input gets an accent underline. Forced-colours mode keeps a `Highlight` outline.
- `prefers-reduced-motion: reduce` removes transitions and entrance animations and runs looping animations once. Spinners keep a slow rotation so work in progress stays visible.
- The mobile menu's search button was hidden at widths of 860px and below (it shared the header button's `display: none`). It is visible again and full width. Below 1080px the header search label is visually hidden instead of `display: none`, so the icon-only button keeps its name.

Shared components (`src/components`)

- `Layout`: the skip link focuses `<main>` (which has `tabIndex=-1`) and no longer adds `#main` to the URL. After in-app navigation focus moves to `<main>`. Each route sets `document.title`. Footer column titles are `<h2>`.
- Mega menu: the open panel is rendered directly after its trigger, so Tab moves from the trigger into the panel. Escape closes it and returns focus to the trigger. Tabbing out of the header closes it. `aria-expanded` and `aria-controls` stay on the triggers.
- Mobile menu: it was `role="dialog" aria-modal="true"` with no focus containment. It is now a labelled `<nav>` that follows the menu button in the DOM. Escape closes it and returns focus to the menu button. The menu button has `aria-controls`, and its icons are `aria-hidden`.
- `CommandPalette`: the combobox input has a name, `aria-expanded` and `aria-controls` follow whether results exist, a persistent `role="status"` region announces the result count, and the scrollable list region is focusable. Choosing a tool skips focus restore (the page change moves focus). If the opener has been removed, focus goes to the header search button.
- `FileDrop`: the zone is a labelled `role="group"`. The "Choose file" button is the only control and is in the Tab order. Clicking the zone still opens the picker.
- `Field`: associates the label with a single `Input`, `Select`, `Textarea`, `Slider` or native control found in its children (generated id), adds `aria-describedby` for the hint or error and `aria-invalid` for errors. Other content gets a labelled group. Tool pages contain 397 `<Field>` uses and only 16 `htmlFor` attributes, so most labels pointed at nothing before this.
- `Slider` forwards `aria-describedby` and sets `aria-valuetext` with its unit. `Switch` accepts `aria-label`.
- `ProgressBar`: only the label text is a live region; the percentage is hidden from announcements; `aria-valuetext` is set.
- `ResultPanel` and `BatchResults`: they are labelled regions and take focus when they appear, so completion is announced. A new `useFocusFallback` hook moves focus to `<main>` when a panel that held focus is removed (for example, the drop zone after a file is chosen) and nothing else took it.
- `Home`: after files are dropped, focus moves to the file list; after "Clear" it returns to the drop zone's button. `MediaIndex`: a live region announces how many tools match the filter.

Canvas tools (15 files)

- Display-only canvases got `role="img"` and an `aria-label`: rotate, signature-cleaner, favicon-generator, qr-code-generator, merge, FilterEditorShell (all filter tools), remove-bg result and compare canvases. The colour-picker loupe is `aria-hidden`.
- Pointer drag with no existing equivalent input now has an arrow-key alternative: text-behind-image and text-behind-video (arrows move the text, Shift for larger steps), FitToFrameEditor (arrows pan, plus and minus zoom; the Cover/Contain and background toggles gained `aria-pressed`), and profile-resizer (arrows pan).
- Freehand canvases (pdf/sign draw, pdf/edit drawing) and the photo-editor `CanvasStage` carry a name that states what needs a pointer and where the keyboard path is (pdf/sign: the Type signature mode; photo-editor: side panel controls and Delete). The sign mode buttons gained `aria-pressed`.

## Manual keyboard evidence

Run with Playwright keyboard events against Chromium (log: `keyboard-log.txt`). Chromium on Linux, no screen reader.

| Check | Result |
| --- | --- |
| Tab order on `/` (1280px) | Skip link, Loconvert home, Image, PDF, Video, File, 3D, Convert any file, Search tools, Theme, hero search, Choose files |
| Skip link | First Tab shows it (top 8px). Enter moves focus to `<main>`, URL unchanged |
| Mega menu | Enter on Image: `aria-expanded=true`. Tab moves to the first link in the panel. Escape closes it and focus is on the Image trigger. Space toggles open and closed. Tabbing past the end of the header closes it |
| Command palette | Ctrl+K from the theme button opens `role="dialog"` named "Search tools" with focus in the combobox. Tab keeps focus in the dialog. Typing "merge pdf" announces "3 results". Escape returns focus to the theme button. `/` then ArrowDown, Enter opens the second result, closes the palette, and focus lands on `<main>` with the new page title |
| File drop (`/image/profile-resizer`) | Tab ×14 reaches "Choose file" with a 2px accent outline. Enter opens the file chooser. After choosing a PNG, focus lands on `<main>` (the drop zone is gone) |
| Canvas tool (profile-resizer) | Tab ×4 reaches "Photo position" group. 4× ArrowRight and 3× Shift+ArrowDown change the canvas |
| Mobile menu (390px) | Enter on the menu button: `aria-expanded=true`, nav named "Menu". Tab: Search 133 tools, then each group summary; Space opens a group. Escape closes the menu with focus on the menu button. Choosing search opens the palette and Escape returns focus to the menu button |
| Axe with menus open | No violations with the mega menu, the palette or the mobile menu open |
| Reduced motion | With `reducedMotion: reduce`, mega menu and button transitions compute to 0.00001s; spinner stays at 1.6s |

## Known issues and limitations

The first four bullets below record the pre-fix state from the initial 140-route sweep. They were addressed in the follow-up section at the end of this document and are kept as history.

- Unlabelled controls (critical `label`/`select-name`, serious `label-title-only`): `/image/barcode-generator` and `/image/qr-code-generator` (colour inputs), `/image/hex-rgb-converter` (slider, native picker), `/image/label-designer` (slider, select), `/image/meme-generator` (colour input), `/image/color-contrast` (colour inputs named only by `title`), `/video/media-speed` (number inputs).
- Dark-theme contrast in tool CSS: active tab or direction buttons on `/csv-viewer`, `/txt-to-csv`, `/json-csv`, `/gpx-kml`, `/image/label-designer`, `/image/qr-code-generator`; preview text on `/image/color-contrast`; badges on `/video/media-speed`; the device controls label on `/css-viewer` (light).
- Heading order: `/css-viewer` skips a level in the initial state, and `/image/profile-resizer` does once an image is loaded.
- `/video/media-speed`: a scrollable table wrapper is not keyboard focusable at 390px.

Pointer-only interactions (no keyboard equivalent exists in the tool):

- Photo editor (`CanvasStage`): placing, moving and resizing layers needs a pointer.
- Image collage: panning and zooming a photo inside a cell needs a pointer (the active cell's zoom slider is keyboard operable).
- Freehand drawing in pdf/sign and pdf/edit needs a mouse, touch or pen. pdf/sign offers Type and Upload modes.
- Colour picker: choosing a colour by clicking the image has no keyboard path.
- remove-bg compare view: the divider follows the pointer. The Original and Result views are keyboard operable.
- Other canvas tools not touched here (for example image crop and the PDF page editors) were not reviewed for keyboard access.

Not tested: screen readers (NVDA, JAWS, VoiceOver, Orca), Firefox and Safari, zoom and text-spacing overrides, touch target size, tool states after a file is loaded other than the profile-resizer check, and the dynamic status messages of individual tools. Contrast was checked by axe for the rendered states only.

## Follow-up: twelve tool routes

A second pass fixed the tool-page violations left open above. The scan covered all twelve routes at 1280×900 and 390×844, in light and dark themes (48 scans). Axe ran on the initial state of each route.

| Rule | Before | After |
|---|---:|---:|
| `label` (critical) | 24 | 0 |
| `color-contrast` (serious) | 20 | 0 |
| `label-title-only` (serious) | 8 | 0 |
| `select-name` (critical) | 4 | 0 |
| `heading-order` (moderate) | 4 | 0 |
| `scrollable-region-focusable` (serious) | 2 | 0 |
| **Total** | **62** | **0** |

Routes: `/image/barcode-generator`, `/image/qr-code-generator`, `/image/hex-rgb-converter`, `/image/label-designer`, `/image/meme-generator`, `/image/color-contrast`, `/video/media-speed`, `/csv-viewer`, `/txt-to-csv`, `/json-csv`, `/gpx-kml`, `/css-viewer`.

What changed:

- Added accessible names to colour inputs, sliders, number inputs, selects, hex/RGB/HSL/HSV/CMYK/named-colour fields, the CSS and HTML editors, and the HTML preset select. Visible labels were kept.
- Replaced `color: var(--accent)` with `var(--accent-text)` on active tabs, direction buttons, badges and preview text where the accent failed dark-theme contrast. The label designer canvas now uses the fixed `--gray-0` paper colour and `--gray-900` ink so it stays readable in both themes.
- Made the playback-speed comparison wrapper focusable (`tabIndex=0`, `role="region"`, `aria-label`) so keyboard users can scroll it at narrow widths.
- Changed the css-viewer diagnostics heading from `h3` to `h2`, keeping its visual size; the contrast preview is marked `aria-hidden` because the ratios are announced separately.
- Added `role="img"` and a name to the barcode and QR previews.

Verification command: `node /tmp/lc-e2e/a11y-12.mjs final` against the dev server at `http://localhost:5300`. Raw results are in `/tmp/lc-e2e/out-a11y/axe12-final.json`. `npx tsc --noEmit -p .` exited 0 after the changes.

The scan was repeated after the lint and formatting pass against the production build served on port 5304: `BASE_URL=http://localhost:5304 node /tmp/lc-e2e/a11y-12.mjs prod-final`. It again reported 48 scans and zero violations of any impact; raw results are in `/tmp/lc-e2e/out-a11y/axe12-prod-final.json`.

Still not covered: screen-reader output, Firefox and Safari, zoom/text-spacing overrides, touch target size, and tool states after a file is loaded. The pointer-only interactions listed above are unchanged.

## Follow-up: 12 tool routes

Taproot node: `lc-a11y`. This closes the tool-page items listed under Known issues above. It does not claim conformance with WCAG or any other standard.

Routes scanned (axe-core, Playwright Chromium, dev server at `http://localhost:5300`, all rules including best-practice): `/image/barcode-generator`, `/image/qr-code-generator`, `/image/hex-rgb-converter`, `/image/label-designer`, `/image/meme-generator`, `/image/color-contrast`, `/video/media-speed`, `/csv-viewer`, `/txt-to-csv`, `/json-csv`, `/gpx-kml`, `/css-viewer`. Matrix: 12 routes × 2 viewports (1280×900, 390×844) × 2 themes = 48 scans per pass, initial state. A second pass of 48 scans loaded a fixture or changed a control first (below).

Results (violating nodes over 48 initial-state scans):

| Rule | Impact | Before | After |
| --- | --- | ---: | ---: |
| `label` | critical | 48 | 0 |
| `select-name` | critical | 4 | 0 |
| `label-title-only` | serious | 12 | 0 |
| `color-contrast` | serious | 40 | 0 |
| `scrollable-region-focusable` | serious | 2 | 0 |
| `heading-order` | moderate | 4 | 0 |
| **Total** | | **110** | **0** |

By impact: critical 52 → 0, serious 54 → 0, moderate 4 → 0. The loaded-state pass found 10 more scans with violations, which are fixed: 0 remain across its 48 scans, and no console errors were logged on any scan.

The "before" scan ran on the working tree as I found it. Most of the fixes for these routes were already in the tree by the time I re-scanned (commit `021ae93`: field labels and `aria-label`s, `--accent-text` for active tabs and badges, a focusable table region on media-speed, css-viewer heading levels). This pass added the four fixes the loaded-state scan showed were still missing:

- `csv-viewer`: the "Rows per page" select had no name (`aria-label`).
- `gpx-kml` and `json-csv`: the scrollable output `<pre>` is focusable (`tabIndex=0`) and named "Converted output preview".
- `label-designer`: the "Copy" button text uses `--accent-text` instead of `--accent` (3.98:1 in dark).

Loaded-state flow per tool (scripts: `/tmp/lc-e2e/a11y-12.mjs`, `flow12.mjs`; results in `/tmp/lc-e2e/out-a11y/`):

| Route | Flow |
| --- | --- |
| `/csv-viewer` | Paste a 3-row CSV |
| `/txt-to-csv` | Paste `a b c` / `1 2 3` |
| `/json-csv` | Paste a 2-object JSON array |
| `/gpx-kml` | Upload a small GPX with one waypoint and a 2-point track |
| `/css-viewer` | Paste two CSS rules |
| `/image/barcode-generator` | Type `12345678` |
| `/image/qr-code-generator` | Type a URL |
| `/image/hex-rgb-converter` | Enter `#336699` |
| `/image/label-designer` | Click the first add button |
| `/image/meme-generator` | Upload a small PNG |
| `/image/color-contrast` | Enter `#222222` as the first colour |
| `/video/media-speed` | Enter `2` in the first number input |

Result: 0 serious or critical violations in both viewports and both themes. `npx tsc --noEmit -p .` exits 0.

Both passes were repeated against the final production build at `http://localhost:5304` after rebuilding: 48 initial-state scans and 48 loaded-state scans, zero violations. Raw results are in `/tmp/lc-e2e/out-a11y/axe12-followup-prod.json` and `/tmp/lc-e2e/out-a11y/flow12-prod.txt`.

Still open:

- Several tool stylesheets keep hex colours on purpose-built white "paper" previews (`qr-code-generator`, `barcode-generator`, `label-designer`, `hex-rgb-converter`, `css-viewer`). They were not changed in this pass.
- Only the flows above were exercised. Other states (every tab, every export format, `meme-generator` text overlays, the label-designer canvas) were not scanned, and drag interactions in label-designer have no keyboard path that I checked.
- The `/image/profile-resizer` heading-order item from the earlier list is outside these 12 routes and was not rechecked.
- No screen reader testing.
