# Browser tool opportunities for Loconvert

**Research date:** 2026-10-29

**Scope:** First-party product pages, product documentation, project READMEs, APIs, and standards. The comparison covers 12 references. The priority labels below are judgments about catalog gaps, product fit, and implementation cost; they are not usage or demand measurements.

For privacy statements, “publisher says” means the claim comes from that product’s own documentation or privacy page. I did not instrument competitor sites or independently audit their network traffic. An official browser API or source repo can show that client-side processing is feasible; it does not by itself prove how a deployed site is configured.

## Product constraints and current coverage

The [registry](../src/tools/registry.ts) currently contains **133 tools** in five media families: file, video, image, PDF, and 3D. New work can go in existing categories; the current catalog does not need another top-level family. The [README](../README.md) and [architecture decisions](architecture-decisions.md) set the key product constraint: user files and derived data stay in the browser. A static build may download application code, WASM, and model weights, but it has no application server or remote processing fallback. The CSP allow-list and worker policy also affect new packages and heavy engines.

The home page already has a useful one-step handoff. It suggests compatible tools for dropped files, stores the selected files in a module-level in-memory queue, and hands them to the destination route. The queue is tied to one path, expires after five minutes, is consumed by the destination, and clears on reload. See [Home](../src/pages/Home.tsx), [handoff](../src/lib/handoff.ts), and [FileDrop](../src/components/FileDrop.tsx). This is a good base for opening files in a tool; it is not yet a multi-step workflow or a way to send a tool’s result to another tool.

### Overlap checked in the registry and implementations

- **Image:** Compression, exact-size compression, resize, crop, format conversion, SVG-to-PNG, raster-to-SVG, image merge, collage, bulk resize/compress/convert, annotation, background removal, QR/barcode generation, favicon/ICO creation, EXIF reading/removal, and Base64 are already present. `svg-to-png` rasterizes SVG; it does not optimize SVG markup. Collage is a layout editor, not a labeled index of a large photo set. See [registry](../src/tools/registry.ts), [collage](../src/tools/image/collage/Tool.tsx), and [image conversion helpers](../src/tools/image/_convert).
- **PDF:** Merge, split, reorder, repair, OCR, Office conversion, editing, protection, redaction, and PDF comparison are present. **Document comparison is covered by Compare PDF**, including visual and text views in [the implementation](../src/tools/pdf/compare/Tool.tsx). Redact PDF rebuilds pages as raster images and drops source objects, attachments, and metadata; it requires at least one marked redaction and converts selectable text to imagery. A metadata-only cleaner that keeps searchable page content would serve a different job. See [Redact PDF](../src/tools/pdf/redact/Tool.tsx) and its [verification](../src/tools/pdf/_edit/verify.ts).
- **Scanning:** Scan to PDF already accepts camera captures or uploaded images, allows page reorder/removal, and offers original color, grayscale, or adaptive black-and-white output. [Its image pipeline](../src/tools/pdf/scan-to-pdf/scanImage.ts) downsizes to a 2,400-pixel long side. It has no document-edge detection, perspective correction, or deskew control.
- **Video, audio, and subtitles:** Video trim and edit, audio extraction/removal/boost/add soundtrack, transcription, and automatic subtitle generation exist. The subtitles tool edits generated cues, adds/deletes cues, and exports SRT/VTT or burns/embeds subtitles. It does not accept an SRT/VTT sidecar as its input. See [Subtitles](../src/tools/subtitles/Tool.tsx) and [cue formatting](../src/tools/_whisper/formats.ts). There is no audio-only waveform trimmer or microphone recorder in the registry.
- **File and data:** CSV viewing, TXT-to-CSV, JSON↔CSV, CSS inspection/formatting/minification, file signatures/hex/hashes, MHTML extraction, GPX/KML, and batch rename exist. Batch rename can already package arbitrary selected files into a ZIP, and other batch tools use ZIP output. [The shared ZIP helper](../src/lib/zip.ts) and `jszip` dependency already exist. There is no generic ZIP input/extraction tool. JSON↔CSV formats its generated JSON, but does not provide a direct JSON-only prettify/validate operation.
- **Privacy and 3D:** Image EXIF removal, image redaction, PDF redaction, video metadata inspection, and the 3D mesh/CAD tools are present. No recommendation below repeats OCR, background removal, QR/barcode generation, favicon creation, PDF comparison, or image EXIF removal.

## Competitor scan

| First-party reference | Useful capability or product pattern | Execution and privacy evidence |
| --- | --- | --- |
| [Squoosh repository](https://github.com/GoogleChromeLabs/squoosh/blob/dev/README.md) | A focused image compression and format-conversion tool, a useful example of keeping the first action centered on the image and its output. | The project README says compression is local and images are not sent to a server. It also says the site uses analytics, including before/after image-size values. These are publisher statements, not an independent traffic audit. |
| [Photopea privacy policy](https://www.photopea.com/privacy.html) | A full raster/vector editor sets a much broader scope than Loconvert’s small, single-purpose editors. | Photopea says files are processed on the device and do not leave it; it separately documents optional cloud-storage access and transfers. This is its own policy statement, not an independent audit. |
| [SVGO browser usage](https://svgo.dev/docs/usage/browser/) and [SVGOMG source](https://github.com/jakearchibald/svgomg) | SVGOMG is a GUI over SVGO; SVGO documents a browser bundle and browser import path. This is a direct fit for an SVG optimization gap. | The browser API is documented in the open-source project. This establishes a client-side implementation option, not the network behavior of every hosted SVG optimizer. |
| [Excalidraw export API](https://docs.excalidraw.com/docs/%40excalidraw/excalidraw/api/utils/export) | Exports drawings as PNG, SVG, or JSON and provides a reference for a direct manipulation canvas. Loconvert already has image annotation, so a full drawing editor would overlap more than it adds. | The cited source documents export APIs; no privacy or deployed-site processing claim is inferred from it. |
| [PDF24 FAQ](https://tools.pdf24.org/en/faq) | Broad PDF assembly and page operations are a useful workflow reference, but most are already covered by Loconvert. | PDF24 says its online files are uploaded to processing servers and deleted within an hour. It describes PDF24 Creator as an offline desktop alternative. “Online” here does not mean browser-local processing. |
| [Stirling PDF FAQ](https://docs.stirlingpdf.com/Tools/FAQ/) | Offers many PDF operations and also has a mobile scanner and automation features. | Its current FAQ distinguishes modes: in Cloud, viewing/rearranging can happen in the browser while compress/OCR/convert send files to Stirling servers; Desktop has a Local Only mode; self-hosted tools run on the organization’s server. This is a hybrid product, not one uniform browser-local path. |
| [ezgif privacy page](https://ezgif.com/privacy) | Covers animated formats, conversions, cropping, and related media jobs. | ezgif says uploaded files stay on its servers for up to an hour after last use, while some tools expose an optional local-processing checkbox with possible feature limits. The mode is per-tool, so the site-wide “online” label is insufficient evidence of local execution. |
| [123apps tools catalog](https://123apps.com/) | Lists archive extraction, audio trimming, and voice recording alongside video, PDF, and conversion tools; these are useful adjacent tasks to compare with Loconvert’s file and media coverage. | The homepage does not document how each linked app processes files. I did not infer browser-local execution from the “online” branding. |
| [iLovePDF terms](https://www.ilovepdf.com/help/terms) | A large PDF catalog is useful for finding user tasks, but merge, split, OCR, compare, redaction, and conversion mostly overlap with Loconvert. | The terms say files processed on iLovePDF servers are deleted within two hours, with exceptions for iLoveSign. This is a publisher statement about a server workflow. |
| [CyberChef README](https://github.com/gchq/CyberChef/blob/master/README.md) | A recipe model combines small data operations; recipes can be saved locally and operations can be reordered. It is a useful workflow reference, though its four-pane drag-and-drop recipe UI would be too much for Loconvert’s default flow. | The project README says the app is entirely client-side and that input/recipe data are not sent to its server. It also notes that a share URL can include the input; a URL is therefore not a private recipe container. These are project statements; no live network capture was made. |
| [IT-Tools catalog](https://it-tools.tech/) and [source repository](https://github.com/CorentinTh/it-tools) | Its official indexed catalog lists JSON pretty/minify, JSON diff, text diff, YAML/TOML/XML conversion, and many unrelated developer utilities. It demonstrates breadth, not a reason for Loconvert to add every small utility. | The repository documents self-hosting. The hosted page did not expose readable body text in direct fetch, so the listed tools are based on the official catalog’s search-indexed content; I did not establish the hosted site’s processing mode for every tool. |
| [PairDrop source](https://github.com/schlagmichdoch/PairDrop) | Cross-device file sending is adjacent to a file tool product but is a different user job from conversion or cleanup. | The project describes peer-to-peer transfers on a local network and Internet transfers through temporary rooms; it documents a TURN server for some Internet connections. It is a file-sharing system with network services, not a browser-only transformation feature. |

These rows summarize the publishers’ own pages and project sources. PDF24, Stirling Cloud, ezgif, and iLovePDF explicitly document server processing for at least some online operations. Photopea, Squoosh, and CyberChef describe local execution, but those statements were not independently tested here. Stirling and ezgif need per-mode/per-tool distinctions. No privacy conclusion is drawn for Excalidraw or IT-Tools from the cited feature pages.

## Recommended additions

The first three have the strongest combination of a clear registry gap, fit with current categories, and manageable implementation scope. The remaining ideas are valid gaps, with more specialized or heavier work. No new media family or navigation group is needed.

### 1. ZIP inspector and extractor — high priority, low–medium effort

**Scenario:** A user receives a ZIP of photos, documents, or project assets and wants to inspect it and save only a few files. Today the app can create ZIP outputs through batch tools but has no generic way to open one.

**Simple UI:** Drop one ZIP, show a compact file list with path, type, and size, then offer “Download selected” and “Download selected as ZIP.” The latter should be the default for multiple entries so the result is one download. Avoid path extraction to the user’s file system; let the browser download individual files or one new archive.

**Browser fit and dependencies:** `jszip` is already a dependency, and [`src/lib/zip.ts`](../src/lib/zip.ts) already builds archives. JSZip’s [`loadAsync`](https://stuk.github.io/jszip/documentation/api_jszip/load_async.html) reads a ZIP in the browser and sanitizes relative path components such as `..` in entry names. Its [limitations](https://stuk.github.io/jszip/documentation/limitations.html) include no encrypted or multi-volume ZIP support, constrained ZIP64 handling, and full-result memory costs. Set compressed-size, entry-count, and expanded-output limits; report unsupported archives clearly. Effort is low–medium because the parser/generator exists but the inspection and bounded extraction UI do not.

### 2. Image comparison — high priority, low–medium effort

**Scenario:** A user wants to compare two edited exports, screenshots, or product images and spot a crop, color, or layout change. PDF comparison already covers document pairs; image pairs do not have a dedicated comparison view.

**Simple UI:** Two image drop zones and a single draggable before/after wipe, with a side-by-side fallback. Default to contain-fit; do not add alignment, pixel scoring, and color analysis controls at launch. Explain that different crops or dimensions can make a visual comparison misleading.

**Browser fit and dependencies:** The [HTML Canvas standard](https://html.spec.whatwg.org/multipage/canvas.html) provides `drawImage()` and `toBlob()`; the [ImageBitmap API](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html) creates bitmaps from local `Blob` inputs. A local canvas comparison can use existing image loading/export helpers without a new dependency. The main limitation is alignment: this should be a visual aid, not a claim of automatic registration or forensic pixel-diff accuracy.

### 3. SVG optimizer — high priority, medium effort

**Scenario:** A web developer exports a logo or icon from a design app and wants to remove editor metadata and redundant markup before committing it to a site.

**Simple UI:** Add one SVG input in the existing image-conversion area, run the default SVGO preset, show the original and output byte counts, and provide a downloaded SVG. Offer one advanced disclosure for uncommon compatibility choices; avoid exposing the full SVGO plugin list by default.

**Browser fit and dependencies:** The [SVGO browser guide](https://svgo.dev/docs/usage/browser/) documents the `svgo/browser` entry point and `optimize()` call. SVGO documents removing redundant metadata, comments, and markup in its [project README](https://github.com/svg/svgo). The new dependency can be lazy-loaded with the route; a worker is a reasonable follow-up if large SVGs block the UI. Optimization can rewrite markup and may affect files whose IDs, classes, or embedded references are relied on elsewhere, so keep a visual check and preserve the original input for download/retry. There is no promise that every SVG will become smaller.

### 4. Contact sheet — medium priority, low–medium effort

**Scenario:** Someone with a folder of event or product photos wants one labeled overview to review or send, rather than opening every image.

**Simple UI:** Accept multiple images, preserve input order, create an automatic grid, and print each filename under its thumbnail. Limit page size and produce numbered sheets when there are too many inputs. Keep dimensions and captions to a small number of useful defaults.

**Browser fit and dependencies:** Reuse the same Canvas and `createImageBitmap` path as image comparison. This differs from the current [Collage Maker](../src/tools/image/collage/Tool.tsx), which arranges selected photos into design templates rather than producing a filename index. Cap input count and thumbnail dimensions to control canvas memory. A sprite-sheet atlas with per-cell metadata is a possible later extension, but is a narrower game-development task and should not be part of the first contact-sheet UI.

### 5. Import and edit subtitle files — medium priority, low–medium effort

**Scenario:** A user has an SRT/VTT sidecar with one timing error, wants to shift every cue by 0.5 seconds, fix text, and export without running Whisper again or loading a video.

**Simple UI:** Extend the existing Subtitles page with an “Open SRT/VTT” path, reuse its current cue list editor, and add one global time-shift field. Export to SRT or VTT. Keep the video/Whisper flow as the initial route state when users bring a video file.

**Browser fit and dependencies:** The app already has cue editing and SRT/VTT serializers in [`src/tools/subtitles/Tool.tsx`](../src/tools/subtitles/Tool.tsx) and [`src/tools/_whisper/formats.ts`](../src/tools/_whisper/formats.ts). The [W3C WebVTT specification](https://www.w3.org/TR/webvtt1/) defines WebVTT structure, and the [W3C `webvtt.js` repository](https://github.com/w3c/webvtt.js) provides a parser/serializer. That parser addresses VTT, not SRT; SRT needs its own focused parser. A first version can preserve cue text and timestamps while leaving WebVTT styling/regions out of scope. No speech model or video encoder is needed for this path.

### 6. PDF metadata-only cleaner — medium priority, low–medium effort

**Scenario:** A user wants to remove a PDF’s author, title, creator software, keywords, or dates before sharing while keeping its text searchable and pages vector-based.

**Simple UI:** Show the standard document-info fields found, a “Clear these fields” default action, and a verification summary naming exactly what was changed. Keep sensitive page text and attachments on a separate redaction path.

**Browser fit and dependencies:** `pdf-lib` is already in the app; its [`PDFDocument` API](https://pdf-lib.js.org/docs/api/classes/pdfdocument) exposes standard title, author, creator, producer, keywords, language, and date getters/setters. This is distinct from current Redact PDF, which rasterizes pages and strips metadata only as part of redaction. Do not promise to remove arbitrary XMP/custom metadata, embedded files, form values, or signatures unless those are separately inspected and verified. Existing signatures may become invalid when a PDF is rewritten.

### 7. Scan auto-crop and deskew — medium priority, high effort

**Scenario:** A user photographs a paper at an angle and wants a neat page PDF without opening a desktop scanner app.

**Simple UI:** Preserve the existing camera/upload, reorder, and gray/B&W controls. Add auto-detected page edges and perspective correction; when detection is uncertain, let the user drag four corner handles. Start with manual corner correction if a robust automatic path would make the first version too heavy.

**Browser fit and dependencies:** OpenCV.js documents contour detection in its [JavaScript tutorial](https://docs.opencv.org/4.12.0/d5/daa/tutorial_js_contours_begin.html) and perspective transforms in its [geometry tutorial](https://docs.opencv.org/5.0/js_tutorials/js_imgproc/js_geometric_transformations/js_geometric_transformations.html). These are credible browser-side building blocks, but adding OpenCV.js creates a substantial WASM asset and image-processing surface; lazy-load it and run heavy detection off the main thread. Detection will fail on low contrast, textured surfaces, and pages without a visible border. Camera capture still depends on browser permission and secure-context support, as the current scanner already explains.

### 8. Audio-only waveform trimmer — medium priority, medium–high effort

**Scenario:** A user wants to trim a voice note or song clip to a ringtone without adding a video track or running a desktop editor.

**Simple UI:** One audio input, a waveform with two range handles, preview of the selected segment, and one export action. Skip fades, multitrack timelines, and effects in the first version.

**Browser fit and dependencies:** The [Mediabunny conversion guide](https://mediabunny.dev/guide/converting-media-files) documents trim ranges and audio-track conversion. The project already uses Mediabunny and FFmpeg WASM. Codec availability still depends on the browser and requested output; using Web Audio `AudioBuffer` for a full decoded file can consume substantial memory, and the [Web Audio specification](https://www.w3.org/TR/webaudio/) describes AudioBuffer as memory-resident and generally suited to shorter clips. Bound file duration/size, show codec support, and avoid a “works with every audio file” promise. A waveform can be a coarse preview, not a decoded copy of every sample.

### 9. Microphone recorder — medium–low priority, low–medium effort

**Scenario:** A user needs a short voice memo on a shared device and wants to save it locally without an account or remote recorder.

**Simple UI:** One “Record” button, elapsed time, “Stop,” playback, and download. Show the actual output extension and MIME type selected by the browser. Avoid an audio-mixer interface.

**Browser fit and dependencies:** The [W3C MediaStream Recording API](https://www.w3.org/TR/mediastream-recording/) defines recording a `MediaStream`; the browser can return a local `Blob` for download without sending it to a server. This requires microphone permission and secure-context access; supported MIME types and codec output vary by browser, so probe support and label the produced format. No new WASM runtime is needed.

### 10. JSON format and validate — low priority, low effort

**Scenario:** A user opens a JSON configuration and wants a readable copy plus a clear parse error, without converting it to CSV.

**Simple UI:** Paste or drop JSON; pretty-print with two spaces by default; offer a single compact/minify action and copy/download. Do not add JSONPath, schema generation, YAML, XML, SQL, or a generic “developer tools” dashboard in the same change.

**Browser fit and dependencies:** This can use `JSON.parse` and `JSON.stringify` in the current `file-data` category. It is a real gap beside JSON↔CSV, but lower priority because it is a small generic utility and does not expand the media workflows that distinguish the current catalog. The IT-Tools catalog includes formatters and diffs; that breadth is a reference for what users can find elsewhere, not evidence that Loconvert should reproduce the full catalog.

## Combine existing tools before adding a workflow builder

The most useful next step for repeated work is a few **fixed, named workflows**, not a free-form CyberChef-style recipe editor. Candidate examples are:

1. **Photo export:** bulk resize → convert → compress, with a single output ZIP.
2. **Scanned document:** Scan to PDF → OCR PDF, preserving the existing local OCR path.
3. **Subtitle pass:** transcribe → edit cues → export/burn, which is already mostly in one tool; the missing piece is importing an existing sidecar.

Home Quick Drop already ranks tools for a set of selected files and hands them to one route. Extend the existing handoff envelope so a completed tool can offer one relevant “Continue with…” action that passes its result `Blob` as an in-memory `File` to a compatible tool. Keep the same short lifetime and clear behavior. Do not persist user files or workflow data in storage, encode file contents in a URL, or create direct tool-to-tool imports; the [architecture decision](architecture-decisions.md) keeps tool folders independent. A user should see one recommended next action, with manual download still available.

## Suggested implementation order

1. **ZIP inspector/extractor** — reuses JSZip and fills the clearest file-utility gap; add hard limits before supporting large archives.
2. **Image comparison** — no new dependency and a contained UI; use fit plus wipe as the only primary control.
3. **SVG optimizer** — adds a new capability to an existing format family; lazy-load SVGO and keep the original available.
4. **Subtitle sidecar import** — reuse the existing cue editor and serializers without loading the transcription model.
5. **Contact sheet** — build on current image loading and bulk-output patterns.
6. **PDF metadata-only cleaner** — scope the first version to standard document-info fields and report the exact fields touched.
7. **Scanner cleanup** — ship manual corner correction before adding automatic detection if OpenCV.js makes the initial bundle or worker path too costly.
8. **Audio clipper and microphone recorder** — separate the short recording path from longer-file waveform processing; reuse current local media engines only where browser support permits.
9. **JSON formatter** — add only if the file/data category needs another developer-facing utility.

## Defer or avoid

- **Full Photoshop-like editing or Excalidraw-like drawing:** Photopea and Excalidraw are useful references, but a layered editor or general canvas app is a large product direction and overlaps current image editing/annotation. Keep the focused editors already in the registry.
- **Cloud PDF conversion or hosted OCR fallback:** PDF24, iLovePDF, and Stirling Cloud show server-heavy workflows, but these violate Loconvert’s accepted no-upload architecture. Keep OCR and conversion local, with browser/memory limits visible.
- **Large-scale automatic scan recognition in the first scanner change:** OpenCV.js can supply the primitives, but WASM size, page-resolution memory, false edge detection, and worker lifecycle make it a later investment after manual correction.
- **General file sharing or sync:** PairDrop solves cross-device transfer and uses network signaling/relay paths for some connections. It is outside the static local conversion product and would add a service boundary.
- **A giant developer utility collection:** IT-Tools and CyberChef demonstrate breadth, but copying small one-off generators would add navigation and maintenance faster than capability. JSON formatting is the only narrowly scoped developer/data lead here.
- **ZIP support for every archive format:** Start with ordinary ZIP. JSZip’s documented limits exclude password-protected and multi-volume archives and caution about memory. RAR/7z and large streaming extraction need different engines and should be a separate decision.

## Source access note

The 123apps home catalog was retrievable and lists Archive Extractor, audio trimming, and a voice recorder, but it does not state the processing mode of each linked app. Its first-party [legal page](https://123apps.com/legal) declares an effective date of 2022-05-16, so I did not use it as current processing-mode evidence. The IT-Tools homepage was available as a search-indexed official catalog, but direct page fetch exposed no readable body; its listed capabilities are attributed to that indexed catalog, and hosted processing remains unverified. Direct `curl` requests to the two OpenCV documentation URLs returned 403, while the official web fetch exposed the cited contour and perspective-transform documentation. The other cited URLs resolved successfully. Privacy/execution statements remain attributed to the publisher wherever they were not independently established.
