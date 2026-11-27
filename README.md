# Browser file tools

> **Private media and file tools that run in your browser.** Your files are processed locally on your device using WebAssembly, WebCodecs, and WebGPU. File data stays on your device. Static assets, WASM codecs, and model weights are downloaded as needed.

## Tools

- **Files and data** — Convert supported image, audio, video, document, and data formats. Inspect files and ZIP archives, rename files in batches, and work with CSV and JSON.
- **Images** — Convert, resize, compress, and crop images. Compare two images, make favicons, optimize SVGs, or redact part of an image.
- **PDF and Office** — Convert supported documents, merge or split PDFs, add watermarks, and manage passwords. Use local OCR to create searchable PDFs or on-device models to summarize and translate documents.
- **Video and audio** — Trim, crop, resize, or compress video. Extract audio, adjust volume, or edit subtitles.
- **3D meshes and CAD** — View and convert models, inspect geometry, simplify meshes, change scale and orientation, and split or merge components.

Use **⌘K / Ctrl+K** to search by tool, format, or task. **Recent files** can reopen locally saved files and editor drafts, subject to browser storage limits. Download finished results to keep them separately.

## Editors

- **Photo Editor** (`/image/photo-editor`) adjusts light and color, rotates and crops images, and adds text, drawings, shapes, or redactions in a full-screen workspace.
- **Video Editor** (`/video/video-editor`) lets you arrange, split, and trim clips, adjust framing and speed, and mix original audio with a soundtrack. Export as MP4 or WebM. Try it with the [six-second sample](public/samples/workspace-demo.mp4).
- **Timelapse Editor** (`/video/timelapse`, `/image/timelapse`) turns a sequence of images into a video. Try the built-in demo with 240 sample frames. Based on [Interval](https://github.com/nozamdavid/interval).

Press **Space** to play or pause in Video Editor and Timelapse Editor.

Preview and export support depend on the browser and the codecs available. Local FFmpeg handles many video operations when browser codecs are unavailable. Office conversions focus on content and structure, and layout can vary with browser rendering and fonts.

## Development

Install the locked dependencies and start the local server. Release checks use Node 24.

```bash
npm ci
npm run dev
```

Run these checks before publishing.

```bash
npm run build                 # Type check and build the production bundle
npx tsc -b                    # Standalone type check
npm test                      # Unit tests
npm run lint -- --max-warnings=0
npm run format:check
```

Arcane serves the production build on the LAN. Camera access requires a secure browser context. The deployment guide includes a localhost forwarding command. [Open the tools](http://192.168.0.199:3052) · [Deployment guide](docs/deployment.md)

## Documentation

- [Tool coverage and source mapping](docs/tool-coverage.md)
- [3D tools and pipeline](docs/3d-tools.md)
- [Browser compatibility](docs/browser-matrix.md)
- [Privacy verification](docs/privacy-verification.md)
- [Architecture and development guidelines](CONTEXT.md)
- [Design system](docs/design-system.md)
- [Changelog](CHANGELOG.md)
