# Loconvert 0.1.0 release review

November 25, 2026. The initial review covered the working tree on top of `67aa7d6`. The sections below distinguish measurements from that review and the follow-up fixes in this release candidate.

## Release gates

In the initial review, a clean installation passed `npm ci`, ESLint, Prettier, all 183 unit tests in 34 files and the production build on Node 24.21.0. A second build produced the same 367 files byte for byte. The entry bundle was `index-B87dgcwD.js`. ESLint reported 93 warnings, comprising 73 explicit `any` annotations and 20 hook dependency warnings.

## Follow-up verification

- The release candidate built as `index-BA6z4qq3.js` on Node 24.21.0. All 183 tests and the formatting check passed. ESLint reported zero errors and 93 warnings. Chromium loaded all 167 routes with zero console errors.
- The video and universal converters copy transparent video streams when exporting to WebM or MKV. Downloaded files matched all 38,400 source alpha pixels in Chromium, Firefox and WebKit. Firefox also exported a transparent VP9 video with audio. Formats that cannot preserve the full alpha channel stop with an explanation before download.
- PowerPoint to PDF now waits for charts to render before capturing a slide. Chromium exported a two-slide fixture with identical bars and 37,000 colored plot pixels on each page. A separate deck retained its bar, line and pie charts.
- The PDF summary result now reminds readers to check generated details against the original document. Translation and transcription keep their existing workflows.
- GitHub account billing blocked GitHub Actions run 45695857625 for commit `5640701` before any steps ran. The repository had no runners at the time. The passing checks above were local.
- The live Arcane container served the release HTML at `/video/trim`, revalidated stable files, cached hashed JavaScript immutably and returned HTTP 404 for missing JavaScript, fonts and WASM. A two-release container test also verified that old chunks remained available after switching releases. [LAN site](http://192.168.0.199:3052) · [Deployment guide](deployment.md)
- The LAN check covered all 167 routes and inspected downloaded CSV, PNG, PDF, WebM, MKV, WAV and STL files. Chromium used the local FFmpeg fallback over HTTP. The LAN changes add incremental file hashing and text copying when native browser APIs are unavailable. The updated build is `index-DWVpU_cP.js`. All 184 tests passed, and `npm audit` reported zero known vulnerabilities.

## Scope

The registry contains 138 tools. File accounts for 11, video and audio for 21, image for 66, PDF for 33 and 3D for seven. The review covers the five indexes, file handoff, search, language and theme selection, result downloads and the tool families behind those routes. Route checks establish that a tool opens. Output checks exercise specific inputs and operations.

## Findings and changes

| Area | What changed |
| --- | --- |
| Discovery and navigation | Search restores keyboard focus. Clearing a category filter keeps focus, and moving to another category clears its filter. The mobile menu closes when desktop navigation takes over. Three PDF routes now show the catalog title, description and breadcrumb for their own route. |
| File and 3D tools | CSV, TSV and JSON conversions use the shared parser, preserving quoted fields and extra columns. Text-to-PDF wraps long lines. Archive and XML reads have bounds. 3MF imports validate face indices before combining objects. |
| Images | Preview and export use the same conversion dimensions. The image pipeline handles transparency, narrow blur regions, AVIF filenames, JPEG orientation and late JPEG XL preview results. |
| Video and audio | A failed FFmpeg startup can be retried. Soundtrack export keeps the full video duration. Cancelled model jobs settle, and AI video export limits the source, frame count and memory used by encoded frames. |
| PDF | Copying pages preserves links to retained pages and excludes omitted pages reachable through forms. Redaction covers fractional edges. Document replacement and cancellation dispose of workers and prevent stale extracted text from reaching later jobs. |

## Initial browser evidence

- All 167 production route checks passed in Chromium on the final entry bundle `index-B87dgcwD.js`, including 138 lazy tool pages, 21 legacy redirects, seven static pages and the fallback page. The sweep recorded zero console errors.
- The Impeccable pass exercised the shared UI at widths from 320 to 1,280 CSS pixels in both themes. The header passed 42 viewport and language combinations. Checks included keyboard search, rejected files, result handoff and batch ZIP download. Long German queries and Portuguese filenames wrap at 320 px.
- Browser checks inspected actual downloads from Chromium 156, Firefox 155 and WebKit 27.2. The fixtures covered JSON to CSV, PNG resize, PDF rotation with retained text, MP4 to WebM, WAV trimming, OBJ conversion, HEIC decoding, AVIF and GIF encoding, and SRT to VTT. A fixed subtitle cue was visible in the encoded video on all three engines. Transparent WebM input lost its alpha channel on all three.
- All 30 representative download checks passed again on the final build. In a separate transparent WebM check, Firefox crashed once during the full sequence. Three fresh Firefox runs completed that conversion and produced opaque video. The cause of the single crash is unresolved.
- The Chromium verification modules passed for 33 file-handoff cases, six AVIF checks, eight JPEG XL checks, 24 image utility checks, 67 file utility checks and 17 mesh checks. PDF checks covered form flattening, annotations, redaction, page stamping, encrypted pages and staging isolation. Tabular and GPX/KML fixtures also passed.
- Chromium converted DOCX and PPTX fixtures to PDF and a DOCX page to PNG. The outputs retained their embedded images. All three flows now stop if Office archive preparation fails.
- Chromium with GPU disabled produced a searchable OCR PDF, a T5 Small summary, an English to Spanish OPUS-MT translation and a Whisper Tiny transcript. The requests recorded during these checks downloaded assets and carried no uploaded file bodies. The summary added a detail about spring planting that was absent from the source. Linux WebKit also transcribed a short speech fixture and visibly burned its cue into the exported video.
- Desktop browser engines and resized viewports supplied the evidence. Physical phones, Safari hardware and assistive technology remain outside this run. English startup currently preloads the multilingual catalog, roughly 300 kB compressed. The app supports immediate language switching with that catalog already available.

## Dependency findings

The XML parser used for Office and 3MF imports was updated from 5.11.2 to 5.12.1. The follow-up resolved the six remaining production audit entries with scoped Office dependency overrides. The lockfile installs ECharts 6.1.0, uuid 11.1.1 and image-size 2.1.0 for their respective callers. Chromium verified spreadsheet and presentation imports, exports from PDF and rendered charts after these changes. [Chart advisory](https://github.com/advisories/GHSA-fgmj-fm8m-jvvx) · [UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)

The updated lint dependency tree also resolves the minimatch advisory. After a clean install, `npm audit` reported zero known vulnerabilities across production and development packages on November 25, 2026.

## Publishing

1. Run the local release checks for the exact commit being published. [Local validation commands](../README.md#development)
2. Stage the static build and switch the Arcane project to it. Keep the previous release for rollback. [Deployment guide](deployment.md)
3. At the production address, verify that direct tool URLs load the app, missing JavaScript, fonts and WASM return HTTP 404, and cache headers match the production policy. Check that old chunks remain available through a release switch and rollback. [Cache policy](architecture-decisions.md#adr-009-set-production-cache-headers)
