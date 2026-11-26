# Codebase review, November 26, 2026

The review started at `dbce103` and covered the shared application, the 140 registered tools, local file and draft storage, workers, build configuration, and static deployment. The baseline passed all 235 unit tests. The cases below include bugs found by opening and exporting files that passed the original suite.

## Findings and fixes

| Area | User-visible behavior | What verifies it |
| --- | --- | --- |
| Shared inputs and results | Pasting a PDF goes to the focused comparison slot. A cancelled batch ZIP cannot start a late download. Handoffs survive a React Strict Mode remount and expire after five minutes. | Browser tests transfer two same-name images, check their distinct ZIP contents, merge two PDFs from Home, and reset a pending download. |
| File conversions | CSV and TSV preserve empty rows, trailing columns, significant header spaces, and zero-prefixed IDs. XLSX keeps cached formula errors. MHTML retains attachment bytes and the declared text encoding. GPX/KML retains separate geometries in a placemark. | Regression tests compare output values, raw bytes, filenames, and coordinates. |
| Photos and images | Mask geometry follows rotation and reset. WebKit applies adjustments and blur even when its native canvas context lacks filters. Filter previews use the same scale as the full-size export. AVIF filenames match the encoded file. | Browser checks compare decoded PNG pixels inside and outside rotated masks on opaque and partially transparent images, then reopen the drafts. |
| Video and audio | A stereo export could trap the bundled FFmpeg worker. WebM fallback now encodes Vorbis, and explicit Opus export preserves its codec and channels. Embedded subtitles use the newly generated cues even when the input already has a subtitle track. | Bundled-core tests decode stereo and surround audio, recover after a trapped job, and inspect the embedded text. Browser downloads cover WebM, WAV, VTT, and transparent video. |
| PDF and Office | Page ranges preserve line breaks. Copied form widgets stay attached to their pages, and identically named fields from merged forms remain separately editable. Signatures respect rotated crop boxes. PowerPoint chart exports preserve supplied titles and leaf category labels. | Saved PDFs are reopened to inspect pages, widgets, values, and links. Browser checks cover encrypted merge prompts, two-page DOCX image exports, and rendered bar, line, and pie charts. |
| 3D and CAD | Concave OBJ faces retain winding, folded quads retain their corners, and PLY and CAD parts keep their separate topology. An explicitly empty 3MF build stays empty. Editing tools discard obsolete analysis and export results. | Geometry tests cover bounds, area, components, and format round trips. Browser imports render STL, PLY, STEP, IGES, BREP, and 3MF through the file picker. |

The DOCX-to-PNG and DOCX-to-JPEG tools now use one export workflow. DOCX and PowerPoint share archive preparation. The 3D tools share component tracking and winding operations. These changes keep the existing routes, file formats, and user choices.

## Verification and limits

On Node 24, a clean install from the lockfile passed the production build, formatting, and all **273 tests across 52 files**. The npm audit reported zero known vulnerabilities. The review left 85 ESLint warnings. A follow-up fixed all 67 explicit `any` warnings and 18 React hook dependency warnings. Chromium checks verified that changing languages updates an existing search and changing PDF page-number settings updates both the preview and the download.

Run `npm ci`, `npm test -- --maxWorkers=1`, `npm run lint -- --max-warnings=0`, `npm run format:check`, and `npm run build` to repeat the static and unit checks.

The Chromium route sweep covers 140 tools, seven static pages, 22 redirects, and the unknown-route fallback. Each tool must load its interface. Separate export checks inspect downloaded CSV, PNG, PDF, WebM, WAV, STL, JPEG, AVIF, GIF, and VTT files. Transparent WebM checks compare all 38,400 decoded alpha samples. Deployment checks exercise staging, repeated staging, retained assets, hash collision rejection, and rollback.

All 11 export workflows passed in each of Chromium, Firefox, and Linux WebKit. The saved-project regression reopened a 108 MiB video source and verified the latest trim, reuse of stored media, and removal. [Shared interface regression](frontend-regression.mjs) · [Video draft regression](video-draft-regression.mjs)

Browser coverage uses desktop engines with synthetic local files. The review did not exercise camera hardware, physical phones, live AI model inference, or every combination of settings and third-party documents. The OCR cancellation regression uses a test worker. PowerPoint charts display the leaf labels of hierarchical categories in a single row. Large lazy-loaded codec chunks still trigger build size warnings.
