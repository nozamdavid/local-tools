# Cross-Browser Verification Matrix: Taproot lc-browsers

- **Date:** 2026-10-21
- **Production build URL:** `http://localhost:5304`
- **Code commit:** `021ae93` (the matrix ran against this source while it was uncommitted; the content was then committed)
- **Working tree:** clean after the verification commits

## Tested browser versions

- **Chromium:** `153.0.8010.12` (`/home/david/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`)
- **Firefox:** `157.0` (`/home/david/.cache/ms-playwright/firefox-1555/firefox/firefox`)
- **WebKit:** `27.2` (`/home/david/.cache/ms-playwright/webkit-2370/pw_run.sh`)
- **Harness:** `playwright-core 1.64.1` on Node.js v24.21.0, Linux x86_64

## Results matrix

| Browser | Case | Result | Artifact | Evidence |
|---|---|---|---|---|
| **Chromium** | 1. HEIC decode | **PASS** | `/tmp/lc-cross/chromium/heic-decode/sample.jpg` | 427,729 bytes; magic `FF D8 FF` (valid JPEG) |
| **Chromium** | 2. AVIF encode | **PASS** | `/tmp/lc-cross/chromium/avif-encode/cube.avif` | 10,141 bytes; contains `ftypavif` brand |
| **Chromium** | 3. GIF encode | **PASS** | `/tmp/lc-cross/chromium/gif-encode/cube.gif` | 245,273 bytes; magic `GIF89a` |
| **Chromium** | 4. WebM alpha | **FAIL (alpha lost)** | `/tmp/lc-cross/chromium/webm-alpha/alpha.webm` | Conversion succeeds: 1,764 bytes, `codec_name=vp8`, `pix_fmt=yuv420p`; alpha channel absent |
| **Chromium** | 5. Subtitle burn | **PASS** | `/tmp/lc-cross/chromium/subtitle-burn/subtitled.mp4` | 309,621 bytes; 11.0 s; H.264 + AAC; OCR of the bottom crop at 2, 4, 6 and 8 s reads the JFK transcript |
| **Chromium** | 6. Long-video memory | **PASS (observation)** | `/tmp/lc-cross/chromium/long-video-memory/test-60s-compressed.mp4` | Peak RSS 743.53 MB; peak JS heap 37.77 MB; output 2,804,353 bytes |
| **Firefox** | 1. HEIC decode | **PASS** | `/tmp/lc-cross/firefox/heic-decode/sample.jpg` | 510,332 bytes; magic `FF D8 FF` |
| **Firefox** | 2. AVIF encode | **PASS** | `/tmp/lc-cross/firefox/avif-encode/cube.avif` | 10,141 bytes; contains `ftypavif` brand |
| **Firefox** | 3. GIF encode | **PASS** | `/tmp/lc-cross/firefox/gif-encode/cube.gif` | 245,273 bytes; magic `GIF89a` |
| **Firefox** | 4. WebM alpha | **FAIL (alpha lost)** | `/tmp/lc-cross/firefox/webm-alpha/alpha.webm` | Conversion succeeds: 1,764 bytes, `codec_name=vp8`, `pix_fmt=yuv420p`; alpha channel absent |
| **Firefox** | 5. Subtitle burn | **PASS** | `/tmp/lc-cross/firefox/subtitle-burn/subtitled.mp4` | 310,496 bytes; 11.0 s; H.264 + AAC; OCR reads the JFK transcript at 2, 4, 6 and 8 s |
| **Firefox** | 6. Long-video memory | **NOT RUN** | none | `performance.memory` is Chromium-only; this case was scoped to Chromium |
| **WebKit** | 1. HEIC decode | **PASS** | `/tmp/lc-cross/webkit/heic-decode/sample.jpg` | 427,729 bytes; magic `FF D8 FF` |
| **WebKit** | 2. AVIF encode | **PASS** | `/tmp/lc-cross/webkit/avif-encode/cube.avif` | 10,141 bytes; contains `ftypavif` brand |
| **WebKit** | 3. GIF encode | **PASS** | `/tmp/lc-cross/webkit/gif-encode/cube.gif` | 245,273 bytes; magic `GIF89a` |
| **WebKit** | 4. WebM alpha | **FAIL (alpha lost)** | `/tmp/lc-cross/webkit/webm-alpha/alpha.webm` | Conversion succeeds: 1,764 bytes, `codec_name=vp8`, `pix_fmt=yuv420p`; alpha channel absent |
| **WebKit** | 5. Subtitle burn | **FAIL (no subtitle overlay)** | `/tmp/lc-cross/webkit/subtitle-burn/subtitled.mp4` | 255,192 bytes; 11.0 s; H.264 + AAC; the burn flow completes and the file plays, but OCR of the bottom crop at 2, 4, 6 and 8 s is empty and frame inspection shows no subtitle text |
| **WebKit** | 6. Long-video memory | **NOT RUN** | none | `performance.memory` is Chromium-only; this case was scoped to Chromium |

## Gaps and caveats

### Subtitle burn on WebKit

The first pass used `/tmp/test-person-short.mp4`, which has no audio track. Every browser rejected it before model download with `No audio track was found in this file. Please select a file with audio.` The matrix was rerun with `/tmp/loconvert-E-jfk.mp4` (11 s, H.264/AAC, audible JFK speech), and all three engines generated cues and completed the burn export.

Chromium and Firefox produce a visible subtitle. Extracting the bottom quarter of the frame at 2, 4, 6 and 8 seconds and running Tesseract returns the transcript:

```text
And so my fellow Americans ask not what your country can do for you, ask what
you can do for your country.
```

WebKit completes both stages without an on-page error, and the exported file is playable with video and audio, but the subtitle text is missing from every sampled frame. This is a WebKit-specific gap in the burn overlay, not a fixture problem. It needs a separate fix and a regression check once the WebKit rendering path is understood.

### WebM alpha is lost in every engine

`/video/convert` passes `-pix_fmt yuv420p` with `libvpx` (VP8) in `src/tools/convert/Tool.tsx` to avoid the memory corruption seen with VP9 in ffmpeg.wasm 0.12. `yuv420p` has no alpha channel. `ffprobe` confirms `pix_fmt=yuv420p` in all three outputs, so transparency in `/tmp/alpha.webm` is discarded on every engine. The conversion itself succeeds; alpha preservation fails.

### Long-video memory is Chromium-only

`window.performance.memory` is a proprietary Chromium API. The Chromium run sampled the browser process tree spawned by Node (main process plus renderer and utility subprocesses) once per second while compressing a 60-second 640x360 H.264 clip. Peak RSS was 743.53 MB and peak JS heap was 37.77 MB. Firefox and WebKit were not measured because they do not expose `performance.memory`; a process-level measurement would need a different harness.

## Reproduction

The scripts live outside the repository in `/tmp/lc-e2e`:

- `/tmp/lc-e2e/cross-browser.mjs` runs cases 1-6. Pass a browser name and an optional case number.
- `/tmp/lc-e2e/a11y-12.mjs` is unrelated to this matrix.

Generate the long-video fixture once:

```bash
/usr/bin/ffmpeg -y -f lavfi -i testsrc2=size=640x360:rate=25 -t 60 \
  -c:v libx264 -pix_fmt yuv420p /tmp/test-60s-640x360.mp4
```

Run the full suite serially under the shared lock and a 3 GiB memory cap:

```bash
flock /tmp/loconvert-heavy.lock systemd-run --user --scope \
  --working-directory=/tmp/lc-e2e -p MemoryMax=3G -p MemorySwapMax=0 \
  node cross-browser.mjs chromium

flock /tmp/loconvert-heavy.lock systemd-run --user --scope \
  --working-directory=/tmp/lc-e2e -p MemoryMax=3G -p MemorySwapMax=0 \
  node cross-browser.mjs firefox

flock /tmp/loconvert-heavy.lock systemd-run --user --scope \
  --working-directory=/tmp/lc-e2e -p MemoryMax=3G -p MemorySwapMax=0 \
  node cross-browser.mjs webkit
```

Rerun only the subtitle case:

```bash
flock /tmp/loconvert-heavy.lock systemd-run --user --scope \
  --working-directory=/tmp/lc-e2e -p MemoryMax=3G -p MemorySwapMax=0 \
  node cross-browser.mjs chromium 5
```

`FIXTURES.shortMp4` in the script points at `/tmp/loconvert-E-jfk.mp4` for the subtitle case.

Inspect outputs:

```bash
# Image magic bytes
xxd -p -l 3 /tmp/lc-cross/chromium/heic-decode/sample.jpg   # ffd8ff
head -c 32 /tmp/lc-cross/chromium/avif-encode/cube.avif | tr -cd '[:print:]'  # ftypavif
head -c 6 /tmp/lc-cross/chromium/gif-encode/cube.gif       # GIF89a

# WebM alpha
/usr/bin/ffprobe -v error -select_streams v:0 \
  -show_entries stream=pix_fmt,codec_name -of default=nw=1 \
  /tmp/lc-cross/chromium/webm-alpha/alpha.webm

# Subtitle frames and OCR
for t in 2 4 6 8; do
  /usr/bin/ffmpeg -v error -ss "$t" -i /tmp/lc-cross/chromium/subtitle-burn/subtitled.mp4 \
    -frames:v 1 -y "/tmp/lc-cross/chromium/subtitle-burn/frame$t.png"
  /usr/bin/ffmpeg -v error -i "/tmp/lc-cross/chromium/subtitle-burn/frame$t.png" \
    -vf 'crop=iw:ih/4:0:ih*3/4' -f image2pipe -vcodec png - \
    | tesseract stdin stdout
done
```
