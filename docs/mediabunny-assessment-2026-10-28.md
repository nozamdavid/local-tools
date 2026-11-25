# Mediabunny assessment for Loconvert

- **Date:** 2026-10-28
- **Scope:** Read-only investigation of the locked FFmpeg.wasm integration, media call sites, existing performance evidence, and current official Mediabunny and FFmpeg.wasm sources.
- **Decision:** Pilot Mediabunny as a selective browser-native path for metadata, stream-copy conversions, and simple transforms. Keep FFmpeg.wasm for complex filters, GIF, broad codec fallback, and current subtitle/merge flows until parity is demonstrated.

## Recommendation

Mediabunny is a promising fit for simple remuxing and common WebCodecs conversions. Its demuxer/muxer can copy encoded packets without decode/re-encode, and its conversion API covers trim, resize, rotation, crop, and frame-rate changes. Its base package uses browser WebCodecs for codec work and can therefore avoid Loconvert's large FFmpeg core download on supported cases. It may transcode faster on devices with a working hardware encoder, but the result depends on the browser, device, codec, and selected settings. No Mediabunny-versus-FFmpeg timing was measured for this report.

A full migration would leave gaps in the current media surface. Loconvert uses FFmpeg filters and codecs for concat with normalization, overlays, subtitle burn-in, GIF, AVI, and audio formats that Mediabunny cannot cover uniformly with native browser codecs. Some features could be rebuilt over Mediabunny's lower-level sample APIs, but that is custom media-pipeline work rather than a direct command substitution.

The lowest-risk trial starts with FFmpeg-backed metadata/probing and stream-copy operations, then checks trimming and audio extraction. Keep an operation-level FFmpeg fallback for unsupported formats, codecs, and browser capabilities. Measure transcodes only after matching codec, output bitrate, resolution, frame rate, audio settings, and quality checks; FFmpeg CRF 23 and Mediabunny's qualitative Quality levels do not describe equal output settings.

## What Loconvert runs today

The locked dependencies are **@ffmpeg/ffmpeg 0.12.15**, **@ffmpeg/core 0.12.10**, and **@ffmpeg/util 0.12.2** ([package.json](../package.json), [package-lock.json](../package-lock.json)). [src/lib/ffmpeg.ts](../src/lib/ffmpeg.ts) shares one FFmpeg instance and serializes jobs. The core is initialized on first use. Each input File or Blob is read fully with arrayBuffer(), copied into FFmpeg's virtual filesystem, processed in the worker, read back as a full output buffer, and returned as a Blob.

The official FFmpeg.wasm core overview lists FFmpeg 5.1.4 plus x264/x265, libvpx, LAME, Opus/Vorbis, libass, and other codec/filter libraries. Loconvert's current tools use libx264, libvpx, libmp3lame, AAC, libopus, and FFmpeg filter graphs; subtitle burn-in rasterizes cues to PNG and overlays them, while soft subtitles use MP4 mov_text. The exact available set comes from the core build; installing the wrapper does not add missing codecs. [FFmpeg.wasm core overview][ffmpeg-overview]

| Loconvert work | Current FFmpeg path | Mediabunny fit |
|---|---|---|
| Video conversion and remux | [video convert](../src/tools/convert/Tool.tsx) selects H.264/AAC, VP8/Opus, MPEG-4/MP3, GIF, or stream copy; [file converter](../src/tools/file-converter/engines.ts) also writes AVI, Ogg, FLAC, and Opus. | Strong for stream copy and supported MP4, MOV, MKV, WebM, audio containers, and browser-encodable codecs. No AVI or GIF output. Codec/container compatibility and browser encoder availability must be checked. |
| Trim, crop, resize, compression | [trim](../src/tools/trim/Tool.tsx) offers stream-copy and H.264/AAC re-encode; [crop](../src/tools/crop/Tool.tsx), [resize](../src/tools/resize/Tool.tsx), and [compress](../src/tools/compress/Tool.tsx) use FFmpeg filters and x264 CRF. | High for trim, crop, resize, rotation, and frame-rate conversion. An arbitrary nonzero trim start currently forces both video and audio to transcode in Mediabunny's conversion API. |
| Audio extraction and editing | [audio extraction](../src/tools/audio-extract/Tool.tsx) encodes MP3, AAC/M4A, or WAV; [boost volume](../src/tools/boost-volume/Tool.tsx), [remove audio](../src/tools/remove-audio/Tool.tsx), [add soundtrack](../src/tools/add-soundtrack/Tool.tsx), and [_whisper audio preparation](../src/tools/_whisper/extractAudio.ts) also use FFmpeg. | Track removal, packet copy, PCM/WAV, resampling, and custom audio processing fit. MP3 needs Mediabunny's LAME WASM extension where WebCodecs has no MP3 encoder. AAC may need its FFmpeg AAC WASM extension. |
| Merge, speed, loop, overlays, segmentation | [merge](../src/tools/merge/Tool.tsx) builds a filter graph to scale/pad/fps-normalize clips, synthesize missing silence, resample audio, and concatenate. [Speed](../src/tools/speed/Tool.tsx), [loop](../src/tools/loop/Tool.tsx), [image overlay](../src/tools/overlay/Tool.tsx), and [_segment compositing](../src/tools/_segment/videoProcessor.ts) are also FFmpeg-backed. | Mediabunny provides per-frame and per-audio-sample callbacks, so some operations can be implemented manually. Its high-level conversion API has no equivalent one-call concat or general FFmpeg filter graph. |
| Subtitles | [Burn-in](../src/tools/subtitles/burnSubtitles.ts) rasterizes cues to PNG, overlays them, and re-encodes video; [soft subtitles](../src/tools/subtitles/embedSubtitles.ts) mux SRT as MP4 mov_text. | Mediabunny writes WebVTT subtitle tracks, but does not read subtitle tracks or provide an SRT-to-mov_text equivalent. Burn-in needs a custom timed canvas overlay and video transcode. |
| GIF and media inspection | [Video convert](../src/tools/convert/Tool.tsx) and [file converter](../src/tools/file-converter/engines.ts) generate palette-optimized GIF; [image GIF output](../src/lib/image.ts) calls FFmpeg. [Video info](../src/tools/video-info/Tool.tsx) and [file-converter detection](../src/tools/file-converter/detect.ts) also invoke FFmpeg for probing. | Metadata and codec inspection are a low-risk fit for supported containers. Mediabunny does not list GIF as a supported container. |

The official Mediabunny format list covers MP4/ISOBMFF, MOV, CMAF, MKV, WebM, Ogg, MP3, WAVE, ADTS/AAC, FLAC, MPEG-TS, and HLS. Its listed codecs include AVC/H.264, HEVC, VP8, VP9, AV1, AAC, Opus, Vorbis, and PCM. Container support and per-browser codec support are separate: native WebCodecs availability varies by browser and configuration, and the official guide provides canEncode*/canDecode* probes for that reason. [Supported formats and codecs][mb-formats]

Loconvert's WebM path pins VP8 because the existing browser-matrix notes a VP9 crash/memory problem in FFmpeg.wasm 0.12; it also forces yuv420p, which loses alpha. A Mediabunny WebM/VP9 or transparency path would change current behavior and needs explicit browser and alpha checks. [WebM settings](../src/tools/convert/Tool.tsx) [Historical browser matrix](browser-matrix.md)

## Performance and memory

**Where speed could improve**

- For remuxes, both libraries can copy compressed packets without re-encoding. This avoids codec work; likely cost is file reading, parsing, and writing, so a large transcode speedup should not be expected from remuxing alone. Mediabunny prefers packet copy when no operation forces transcoding, the output container accepts the codecs, and timestamps fit. [Conversion guide][mb-conversion]
- For transcodes, Mediabunny uses WebCodecs and exposes a hardwareAcceleration hint. Hardware encoding can be much faster on supported devices, but the hint is not a guarantee and the available codecs/configurations are device-specific. Software fallback behavior is also browser-dependent. [Mediabunny encoding options][mb-sources] [MDN VideoEncoder][mdn-video]
- The current FFmpeg core is single-threaded. FFmpeg.wasm's own FAQ says its multi-thread build can be around twice as fast in some cases, with higher CPU and memory use; this project does not load that build. [FFmpeg.wasm FAQ][ffmpeg-faq]
- Encoder quality controls differ. Loconvert's x264 paths use CRF values, while WebCodecs exposes codec-specific bitrate/quality controls. Equal CRF labels do not exist across the two encoders. Compare equal target bitrate and output dimensions, then report quality and size separately.

**Memory**

The current runFFmpeg path holds the complete input bytes for the virtual filesystem and reads the complete output back before creating a Blob. FFmpeg.wasm documents a 2 GB hard input limit for its WebAssembly build; practical browser limits are lower because input, WASM heap, frame buffers, and output can coexist. [FFmpeg.wasm FAQ][ffmpeg-faq]

Mediabunny lazily reads only the input byte ranges needed. Its output targets make a material difference: BufferTarget retains the entire output in one ArrayBuffer and the docs recommend it for smaller files (under roughly 100 MB); StreamTarget sends chunks to a writable stream, applies backpressure, and can target a FileSystemWritableFileStream. Loconvert currently returns a Blob to its result UI, so retaining that interface still keeps the full output in memory. Direct-to-file output would need an output-flow change and a fallback: MDN's current compatibility data lists showSaveFilePicker for Chrome but not Firefox or Safari. [Reading files][mb-reading] [Writing files][mb-writing] [MDN File System API compatibility][mdn-filesystem]

## Package footprint and license

Sizes below are distinct scopes. Registry tarball bytes were counted from the versioned npm tarball URLs on 2026-10-28; the registry's unpacked size describes all published package files. Neither is the amount Loconvert would download for one browser operation.

| Package or asset | Measured/published size | Scope |
|---|---:|---|
| mediabunny@1.62.1 | **2,231,316 B** tarball; **11,056,268 B** unpacked | npm package archive and all published files. The project README says tree-shaking can produce a minimal bundle as small as 5 kB gzip; that is a minimal-use case, not an estimate for importing all formats or full conversion support. [Mediabunny README][mb-readme] |
| @mediabunny/mp3-encoder@1.62.1 | **692,357 B** tarball; **1,685,429 B** unpacked | Separate LAME/WASM extension. Its guide describes the LAME WASM component as about 130 kB gzip; that figure is codec asset scope, not the full npm archive. |
| @mediabunny/aac-encoder@1.62.1 | **1,287,890 B** tarball; **4,701,885 B** unpacked | Separate WASM extension based on FFmpeg's AAC encoder. The guide does not publish a single compressed runtime-asset size. |
| @ffmpeg/core@0.12.10 | **20,634,719 B** tarball; **64,689,644 B** unpacked | npm archive and published package, including distribution variants. |
| Existing Loconvert production asset audit | **32,232,419 B** WASM + **111,804 B** core JS | Raw emitted ESM asset sizes in [performance-verification.md](performance-verification.md); HTTP transfer size was not measured. The audit found the core absent on initial route visits and loaded only after a media job starts. |

Mediabunny core is pure TypeScript with no runtime dependencies, and its current npm metadata reports MPL-2.0. Its MP3/AAC encoder extensions are separate packages, also reported as MPL-2.0; the extensions embed LAME and FFmpeg AAC-derived codec code, so review their notices when adopting them. Loconvert's locked @ffmpeg/ffmpeg wrapper is MIT, while @ffmpeg/core is reported as GPL-2.0-or-later. FFmpeg.wasm's FAQ notes that the core follows FFmpeg and its external libraries' licenses. This is a distribution-license consideration, not a legal conclusion. [Mediabunny npm metadata][mb-npm] [MP3 extension metadata](https://registry.npmjs.org/@mediabunny%2Fmp3-encoder/1.62.1) [AAC extension metadata](https://registry.npmjs.org/@mediabunny%2Faac-encoder/1.62.1) [MP3 extension][mb-mp3] [AAC extension][mb-aac] [FFmpeg core metadata][ffmpeg-core-npm] [FFmpeg.wasm FAQ][ffmpeg-faq]

## Browser, worker, and security constraints

Mediabunny's codec path is browser WebCodecs, not a bundled software implementation of every codec. Its pure-TypeScript container logic handles parsing and muxing; the browser supplies native decoders/encoders. The MP3 and AAC packages are optional WASM codec polyfills. There is no general browser-side software fallback for every input codec when a WebCodecs decoder is missing. [Introduction][mb-intro] [Supported codecs][mb-formats] [MP3 extension][mb-mp3] [AAC extension][mb-aac]

MDN's browser-compatibility data accessed on this date lists VideoEncoder from Chrome 94, Firefox 130, and Safari 16.4; iOS Safari mirrors Safari. It lists AudioEncoder from Chrome 94 and Firefox 130, and Safari 26; Firefox Android is currently marked unsupported for these encoder interfaces. API support still does not guarantee H.264, VP8, AAC, or another particular codec/configuration. Probe the actual codec, dimensions, frame rate, and bitrate with Mediabunny's capability APIs at runtime. [MDN VideoEncoder compatibility][mdn-video-bcd] [MDN AudioEncoder compatibility][mdn-audio-bcd] [Mediabunny capability queries][mb-formats]

WebCodecs is restricted to secure contexts and can run in dedicated workers. Mediabunny can be used in a worker context; its canvas sink supports OffscreenCanvas, while the MP3 extension creates a worker for its WASM encoder. A worker can isolate JS parsing and custom frame processing from the UI, but WebCodecs still uses browser-managed codec implementations. [MDN VideoEncoder][mdn-video] [Mediabunny media sinks][mb-sinks] [MP3 extension][mb-mp3]

The current Loconvert CSP already allows local/blob workers, blob URLs, and WebAssembly compilation (worker-src 'self' blob:, script-src ... 'wasm-unsafe-eval' blob:). Current FFmpeg uses the single-thread core, which does not need cross-origin isolation. FFmpeg.wasm's multi-thread core requires SharedArrayBuffer, and its usage guide calls out the corresponding security headers. Mediabunny's base WebCodecs route does not rely on that multithreaded WASM setup. The optional encoder packages still need their worker/WASM paths bundled and checked against the deployed CSP. [Loconvert CSP](../index.html) [FFmpeg.wasm usage guide][ffmpeg-usage]

The repository's [browser matrix](browser-matrix.md), dated 2026-10-21, exercised FFmpeg-based GIF generation in Chromium, Firefox, and WebKit, and reports a Chromium-only 60-second compression memory observation of **743.53 MB peak process RSS** and **37.77 MB peak JS heap**. It contains no elapsed conversion time, no Mediabunny run, and no actual iOS Safari or Android-device run. Its WebKit subtitle-burn case completes without visible subtitles. This is historical FFmpeg coverage and memory context; it provides no comparison between engines.

## Suggested pilot and dispatch

1. **Metadata first:** use Input/BlobSource for metadata and supported-format detection in video info and file-converter probing. Preserve FFmpeg probing for formats Mediabunny cannot identify.
2. **Copy operations:** pilot stream-copy remux in the existing “Fast (no re-encode)” conversion option and remove-audio. Use Mediabunny only when it can parse the input and the output container accepts each retained track codec. Compare stream/codec metadata and packet hashes.
3. **Trim behavior:** compare start-at-zero/end-only trims and arbitrary-start trims. Mediabunny documents that a non-default trim.start forces a transcode; its packet-copy boundary policy can expand or shrink a copied trim to keyframe/packet boundaries. Keep the current FFmpeg route available where the user expects exact selected boundaries or unsupported codecs.
4. **Audio extraction:** start with WAV/PCM, then test MP3 with the LAME extension and AAC with native canEncodeAudio plus the AAC extension fallback. Check both source decode support and output encode support before choosing the route.
5. **Compression:** test after the earlier paths. Select a supported output codec/configuration with canEncodeVideo and canEncodeAudio; compare with FFmpeg at matched bitrates and quality metrics. Record whether hardware acceleration was requested and whether the browser exposes enough evidence to identify the actual path.
6. **Keep FFmpeg for current complex operations:** continue using it for animated/single-frame GIF, AVI, the current filter-graph merge and soundtrack paths, subtitle burn-in and MP4 mov_text, and any codec/browser pair that fails Mediabunny capability checks. Evaluate a custom Mediabunny implementation only when there is a product reason and an explicit correctness target.

At dispatch time, choose per operation. Use Mediabunny for supported metadata reads and packet-copy paths; use its conversion API for transforms only after validating decode/encode capability for the exact stream settings. Keep FFmpeg as the fallback for absent capabilities and for operations still expressed as FFmpeg filter graphs. Do not silently switch a requested exact trim to a boundary-expanded copy.

## Comparable benchmark plan

This report ran no benchmark, build, or test and installed no dependency. There is no docs/benchmarks/README.md or benchmark directory in the repository. Existing measurements above are cited as historical evidence only.

For a later pilot, use a deterministic fixture set with recorded SHA-256 hashes: the repository's documented 60-second 640x360 H.264 compression fixture; an H.264/AAC MP4 with known keyframes and subtitle cues; a VP8/Opus WebM; a MOV/MKV stream-copy case; and audio fixtures that decode to MP3, AAC/M4A, and WAV. Include one source with an unsupported native-browser decoder to verify fallback.

Run the same cases on desktop Chromium, Firefox, and Safari, plus actual iOS Safari and Android Chrome devices. Record browser/OS/device, package versions, source hash, codec probe results, output hash, dimensions, frame rate, codecs, bitrates, duration, file size, error/result, and requested acceleration hint. Separate cold tests (fresh browser profile/cache and first job) from warm tests (core or chunks already loaded). Measure user-visible startup, conversion wall time, bytes transferred, and peak browser-process RSS on every platform; collect JS heap where exposed and label unavailable measurements.

For stream-copy work, compare packet hashes when the container permits and verify all expected tracks, timestamps, duration, and playable output. For trim, include keyframe-aligned and non-keyframe boundaries; check requested start/end against decoded frame timestamps and audio/video sync. For transcodes, align output container, codec/profile, resolution, frame rate, pixel format, and audio bitrate. Match target bitrates rather than quality labels, then compare output size and decoded quality (for example SSIM/VMAF plus sampled-frame review). Include alpha-preservation checks if transparency is in scope. Run cold and warm cases separately and report medians with failures and artifact hashes; do not publish a speedup until these results exist.

## Primary sources

All external sources below were checked on **2026-10-28**. Package-size byte counts above are the downloaded npm tarball sizes and npm registry dist.unpackedSize values for the listed versions.

- [Mediabunny introduction and technical overview][mb-intro]
- [Mediabunny project README and minimal bundle-size claim][mb-readme]
- [Mediabunny supported formats and codecs][mb-formats]
- [Mediabunny conversion API, including copy and trim behavior][mb-conversion]
- [Mediabunny reading and input sources][mb-reading]
- [Mediabunny writing and output targets][mb-writing]
- [Mediabunny media sources and transforms][mb-sources]
- [Mediabunny media sinks][mb-sinks]
- [Mediabunny MP3 encoder extension][mb-mp3]
- [Mediabunny AAC encoder extension][mb-aac]
- [Mediabunny 1.62.1 npm registry metadata][mb-npm]
- [MP3 encoder 1.62.1 npm registry metadata](https://registry.npmjs.org/@mediabunny%2Fmp3-encoder/1.62.1)
- [AAC encoder 1.62.1 npm registry metadata](https://registry.npmjs.org/@mediabunny%2Faac-encoder/1.62.1)
- [FFmpeg.wasm architecture and core packages][ffmpeg-overview]
- [FFmpeg.wasm usage guide][ffmpeg-usage]
- [FFmpeg.wasm FAQ: speed, 2 GB limit, and licenses][ffmpeg-faq]
- [@ffmpeg/core 0.12.10 npm registry metadata][ffmpeg-core-npm]
- [@ffmpeg/ffmpeg 0.12.15 npm registry metadata][ffmpeg-wrapper-npm]
- [MDN VideoEncoder API][mdn-video]
- [MDN AudioEncoder API][mdn-audio]
- [MDN VideoEncoder browser-compatibility data][mdn-video-bcd]
- [MDN AudioEncoder browser-compatibility data][mdn-audio-bcd]
- [MDN showSaveFilePicker browser-compatibility data][mdn-filesystem]

[mb-intro]: https://mediabunny.dev/guide/introduction
[mb-readme]: https://github.com/Vanilagy/mediabunny/blob/main/README.md
[mb-formats]: https://mediabunny.dev/guide/supported-formats-and-codecs
[mb-conversion]: https://mediabunny.dev/guide/converting-media-files
[mb-reading]: https://mediabunny.dev/guide/reading-media-files
[mb-writing]: https://mediabunny.dev/guide/writing-media-files
[mb-sources]: https://mediabunny.dev/guide/media-sources
[mb-sinks]: https://mediabunny.dev/guide/media-sinks
[mb-mp3]: https://mediabunny.dev/guide/extensions/mp3-encoder
[mb-aac]: https://mediabunny.dev/guide/extensions/aac-encoder
[mb-npm]: https://registry.npmjs.org/mediabunny/1.62.1
[ffmpeg-overview]: https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/docs/overview.md
[ffmpeg-usage]: https://ffmpegwasm.netlify.app/docs/getting-started/usage/
[ffmpeg-faq]: https://ffmpegwasm.netlify.app/docs/faq/
[ffmpeg-core-npm]: https://registry.npmjs.org/@ffmpeg%2Fcore/0.12.10
[ffmpeg-wrapper-npm]: https://registry.npmjs.org/@ffmpeg%2Fffmpeg/0.12.15
[mdn-video]: https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder
[mdn-audio]: https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder
[mdn-video-bcd]: https://github.com/mdn/browser-compat-data/blob/main/api/VideoEncoder.json
[mdn-audio-bcd]: https://github.com/mdn/browser-compat-data/blob/main/api/AudioEncoder.json
[mdn-filesystem]: https://github.com/mdn/browser-compat-data/blob/main/api/Window.json
