# Mediabunny migration

Mediabunny 1.63.0 provides a local browser path for supported media inputs. The adapter in `src/lib/mediabunny.ts` loads the package on demand, probes the actual track decoder and requested encoder configuration, and falls back to the existing FFmpeg callback when the input, output, capability check, or conversion fails. MP3 and AAC extensions ship as lazy-loaded local application chunks and are registered only when the browser lacks that encoder; the chunks are fetched from the app at runtime, with no external codec download.

Mediabunny and FFmpeg jobs share one queue. The adapter keeps progress monotonic when a failed native attempt hands off to FFmpeg. It cancels incomplete conversions and outputs and disposes each input on every exit. Mediabunny's conversion pipeline owns and closes its decoded samples; the volume-gain callback returns samples to that pipeline, which closes them after encoding.

## Operation coverage

| Operation | Mediabunny path | FFmpeg path |
|---|---|---|
| Video conversion | MP4, MOV, MKV, and WebM with H.264/AAC or VP8/Opus when the exact decoder and encoder settings are supported. The fast-copy option requires packet copy and checks retained tracks. | Unsupported codecs or containers, plus AVI and GIF. |
| Trim | Precise trim re-encodes supported video/audio from the requested start and end. | Fast trim stays on FFmpeg to retain its keyframe boundary behavior; unsupported precise-trim codecs also fall back. |
| Crop and resize | H.264 video transform with AAC audio for crop; resize maps stretch, contain, and cover to Mediabunny's fit modes and keeps audio packets when the MP4 container accepts them. | Unsupported input codecs, unsupported stream layouts, and failed transforms. |
| Compress | H.264 output, selected maximum resolution without upscaling, quality intent, and optional audio removal. Audio is AAC when retained. Inputs with subtitle or other unsupported tracks fall back so the native path does not drop streams the existing FFmpeg auto-mapping may retain. | Unsupported codecs/configurations and failed conversions. |
| Remove audio | Forced packet copy for compatible MP4, MOV, MKV, or WebM output; supported H.264 re-encode for other inputs. | Unsupported source/output pairs and failed packet copies. |
| Audio extraction | WAV/PCM, MP3, and M4A/AAC from the selected primary audio track. MP3/AAC use native encoding first and the local extension only when needed. | Unsupported decoders, sample rates/channels, and failed encodes. A missing audio track produces an extraction error. |
| File converter | MP4, MOV, MKV, WebM, MP3, M4A, and WAV media branches use Mediabunny first. | AVI, GIF, OGG, FLAC, Opus, unsupported codecs, and failed native conversions. |
| File detection and video info | MediaBunny probes supported containers and adapts track metadata to the existing `ParsedVideoInfo` display. The raw section is labeled as a Mediabunny metadata report. | FFmpeg stream probing and genuine FFmpeg log output for unsupported inputs. |
| Video metadata and transcription audio | `getVideoMeta` uses Mediabunny track metadata when available. Whisper preparation resamples primary audio to mono 16 kHz float WAV before returning samples. | Browser metadata fallback and FFmpeg PCM preparation when Mediabunny cannot decode or convert. |
| Volume boost | Simple gain uses decoded audio samples and a 0.95 peak ceiling when gain exceeds unity; compatible video packets are copied. | Loudness normalization, unsupported input codecs, and failed conversions. |

The adapter rejects conversions that omit selected audio, video, or subtitle tracks unless the operation explicitly drops that track type. Primary-track selection is explicit for tools whose existing output selects one track. Forced-copy requests cannot silently transcode.

Merge/filter graphs, add-soundtrack, overlays, segmentation, speed, loop, GIF, AVI, subtitle burn-in, and MP4 `mov_text` remain FFmpeg-backed. Audio-only speed and loop are not included because they need separate timestamp and sample-boundary work.

## Rate control and capability limits

The adapter checks `InputTrack.canDecode()`, `canEncodeVideo`, and `canEncodeAudio` using the requested codec, output dimensions, frame-rate estimate, sample rate, channel count, and rate-control settings. It makes no user-agent assumptions. A positive probe does not guarantee that a device encoder will complete; runtime conversion failures use FFmpeg fallback.

Mediabunny's `Quality` values and WebCodecs bitrate controls do not reproduce Loconvert's x264 CRF rate control. Compression presets map to qualitative high, medium, and low intent. The converter's video paths use supported encoder settings rather than claiming parity with the previous CRF values. File size and visual/audio quality can differ by browser and device.

`BufferTarget` keeps the complete result in memory to match the existing Blob-based result UI. The adapter does not make a speed or memory-reduction claim.

## Validation

Validation completed on 2026-10-29:

- `npx tsc --noEmit` passed with `GOMAXPROCS=2`.
- ESLint passed on the touched TypeScript and TSX files, including the pre-existing `src/components/Layout.tsx` change.
- Focused Vitest coverage passed: 3 files and 14 tests, including adapter fallback/capability behavior, resource cleanup, forced stream copy, track omission, transform options, progress, and affected file-converter paths.
- A generated H.264/AAC MP4 was demuxed and remuxed through Mediabunny's forced-copy path. Both tracks and all encoded packet hashes matched the input.
- The capped production build passed and emitted local Mediabunny, MP3, and AAC chunks. It reported existing externalized-module and large-chunk warnings.
- A headless Chrome/Playwright attempt fetched the Mediabunny module chunk, but the module import did not resolve. No browser conversion assertions ran; the repository's Vitest environment runs in Node, so native WebCodecs transcoding remains unverified.
- Final review fixed missing-duration handling in `getVideoMeta`: a null or nonfinite probe duration now uses browser metadata instead of returning zero. TypeScript, focused ESLint, and the metadata regression plus adapter tests passed (2 files, 7 tests).

No timing benchmark is part of this migration.
