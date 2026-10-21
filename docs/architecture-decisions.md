# Loconvert Architecture Decisions

This is the durable log for choices that shape the codebase and are expensive to reverse. Each entry uses a lightweight ADR format: context, decision, consequences, status and date. The dates record when the decision was written down; several entries are retrospective records of choices already in force.

Status values:

- **Accepted** — the current code and reviews are expected to follow it.
- **Proposed** — a choice still needs a decision; the entry records the options and criteria.
- **Superseded** — replaced by a later ADR; keep the history.
- **Deprecated** — no longer recommended, but not yet replaced.

| ADR | Status | Decision |
| --- | --- | --- |
| [ADR-001](#adr-001-keep-user-files-in-the-browser) | Accepted | Process user files only in the browser; no uploads or remote processing |
| [ADR-002](#adr-002-use-a-registry-driven-tool-catalog) | Accepted | One folder per tool, metadata and routes from the registry, shared code in `_<group>` modules |
| [ADR-003](#adr-003-keep-a-csp-allow-list-for-remote-code-and-models) | Accepted | Maintain an explicit CSP allow-list for remote code, WASM and model weights |
| [ADR-004](#adr-004-own-shared-code-by-scope) | Accepted | `src/lib` for cross-cutting code, media `_<group>` modules for domain code, no tool-to-tool imports |
| [ADR-005](#adr-005-lazy-load-heavy-engines-and-use-workers) | Accepted | Load heavy engines on demand and run blocking WASM work in workers |
| [ADR-006](#adr-006-ship-a-static-client-only-build) | Accepted | Produce a static Vite SPA with no application server runtime |
| [ADR-007](#adr-007-choose-the-hosting-shape) | Proposed | Choose static hosting or a long-running preview, and record its operational cost |
| [ADR-008](#adr-008-choose-the-ci-provider) | Proposed | Choose where typecheck, tests, lint and build run on push |
| [ADR-009](#adr-009-set-production-cache-headers) | Proposed | Set immutable caching for hashed assets and no-cache for HTML |

## ADR-001: Keep user files in the browser

- **Status:** Accepted
- **Date:** 2026-10-21

**Context.** Loconvert handles private documents, photos, audio, video and 3D models. A server-side conversion path would simplify some codecs and large-file handling, but it would turn every tool into a data-collection and retention problem. The product promise is local processing.

**Decision.** User file bytes and data derived from them never leave the browser. Decoding, encoding, transcoding, analysis, OCR and model inference run in the tab through JavaScript, WebAssembly, WebCodecs, WebGPU or workers. Static code, fonts, WASM binaries and model weights may be downloaded on demand from the CSP allow-list. There are no uploads, remote processing APIs, accounts, analytics or server-side fallback.

**Consequences.**

- Privacy is enforced by architecture, not by a policy promise alone.
- The browser's memory, CPU and codec support are the hard limits; large files need explicit limits and clear errors.
- Features that require a server, cross-device sync or server-side model inference are out of scope unless this ADR is superseded.
- The network boundary is verified in [the privacy report](privacy-verification.md) and summarized in [CONTEXT.md](../CONTEXT.md).

## ADR-002: Use a registry-driven tool catalog

- **Status:** Accepted
- **Date:** 2026-10-21

**Context.** The catalog contains many tools across file, video, image, PDF and 3D media. Hand-maintained routes and navigation would drift from the tool folders and make metadata inconsistent.

**Decision.** `src/tools/registry.ts` is the single source of truth for tool metadata, categories, routes and lazy component resolution. Each tool has one folder:

- File and video: `src/tools/<slug>/Tool.tsx`
- Image: `src/tools/image/<slug>/Tool.tsx`
- PDF: `src/tools/pdf/<slug>/Tool.tsx`
- 3D: `src/tools/3d/<slug>/Tool.tsx`

Code shared by a media group lives in `src/tools/<media>/_<group>/` (for example `image/_convert`, `pdf/_qpdf`, `3d/_mesh`). Tool components are resolved through `import.meta.glob` and `React.lazy`, so a route loads its tool chunk on demand. The registry contract and route shapes are documented in [CONTEXT.md](../CONTEXT.md).

**Consequences.**

- Adding a tool means adding a registry entry and exactly one matching `Tool.tsx`; ids and paths must be unique.
- The registry test validates file existence, unique ids and paths, tag shape, category/media consistency and required metadata.
- Tool folders stay independent and reviewable; shared behavior must be promoted to a `_<group>` module or `src/lib` instead of copied between tools.
- Changing the registry shape or route scheme affects navigation, search, handoff and every tool URL, so it needs its own ADR.

## ADR-003: Keep a CSP allow-list for remote code and models

- **Status:** Accepted
- **Date:** 2026-10-21

**Context.** The app needs to download model weights and some static assets, while the privacy rule forbids sending user data to remote services. The browser's Content Security Policy is one of the few enforcement points that applies to all code in the page.

**Decision.** The CSP in `index.html` is the network boundary. `default-src` is `'self'`. Scripts may use `'self'`, `'wasm-unsafe-eval'` and `blob:`; workers may use `'self'` and `blob:`; `object-src` is `'none'`. Remote `connect-src` origins are limited to:

- `https://huggingface.co`
- `https://*.huggingface.co`
- `https://*.hf.co`
- `https://cdn.jsdelivr.net`

`'self'`, `blob:`, `data:`, `ws:` and `wss:` are also present for local assets, workers and the Vite development server. Adding a remote host, changing a directive, or introducing a new code or model source requires an update to this ADR, `index.html`, and the privacy verification.

**Consequences.**

- A new model or library CDN can fail at runtime until it is explicitly allow-listed.
- Self-hosting a WASM or model asset is preferred when it does not create a maintenance burden.
- Allow-listing a host permits connections to it; it does not make uploading user data acceptable. The privacy rule still applies.
- `ws:` and `wss:` are intentionally broad for Vite HMR in development. A production-only CSP split is an implementation detail to decide if the hosting model separates development and production origins.

## ADR-004: Own shared code by scope

- **Status:** Accepted
- **Date:** 2026-10-21

**Context.** Many tools need the same decoding, encoding, PDF, archive and media primitives. Copying that code creates inconsistent fixes, while a single catch-all utility layer would make ownership unclear.

**Decision.** Shared code is owned at two levels:

- `src/lib` holds cross-cutting primitives and hooks used by unrelated media types: formatting, downloads, ZIP, image helpers, FFmpeg, PDF.js, JXL, object URLs and job state.
- `src/tools/<media>/_<group>` holds code shared by a media family or a related set of tools: for example `image/_convert`, `pdf/_pages`, `pdf/_qpdf`, `pdf/_render`, `3d/_mesh`, `3d/_cad` and `3d/_ui`.
- `src/components` holds shared UI, and `src/design` holds tokens and global styles.

Tools may import shared modules. Shared modules must not import a tool folder, and a tool must not import another tool's folder. If two tools need the same behavior, promote it to the appropriate shared scope.

**Consequences.**

- A shared-module change has a wider verification surface than a tool-local change.
- Tool-specific layout and behavior stay in the tool folder; only reusable behavior moves up.
- Circular dependencies and accidental coupling are avoided by keeping the dependency direction one-way.
- Shared UI and design tokens are covered by the design-system guide.

## ADR-005: Lazy-load heavy engines and use workers

- **Status:** Accepted
- **Date:** 2026-10-21

**Context.** The app uses large clients and WASM engines: HEIC and AVIF codecs, FFmpeg, PDF.js and QPDF, ExcelJS, Three.js, OpenCASCADE, Tesseract and Transformers.js. Loading them on every route would make the first visit needlessly large and could block the UI.

**Decision.** Route components are lazy. Heavy engines are dynamically imported at the point of use. Blocking or memory-heavy WASM work runs in a dedicated worker where the engine supports it; examples include the JXL worker, QPDF worker, mesh worker, CAD worker and the FFmpeg runtime. The 3D viewer's Three.js entry is loaded only after a model is opened. Eager imports of heavy engines need a measured reason and a first-load assertion.

**Consequences.**

- First load stays small; the performance audit contains assertions that specific heavy chunks are absent before a file is chosen.
- Each worker boundary adds startup and memory cost, but keeps the main thread responsive.
- Lazy-loaded engines must expose progress and failure states instead of assuming an instant import.
- Changing the lazy-loading policy is an architecture change and should update [the performance audit](performance-verification.md).

## ADR-006: Ship a static client-only build

- **Status:** Accepted
- **Date:** 2026-10-21

**Context.** The privacy rule and the absence of a backend mean the application has no server-side runtime responsibilities. Vite already produces a static bundle.

**Decision.** `npm run build` emits static files in `dist/`. The production runtime is a client-side React SPA with client-side routing. There is no application server, API, database, server-side rendering or server-side conversion. A static host must serve the files and fall back to `index.html` for client-side routes.

**Consequences.**

- Deployments can be copied as a static directory; server secrets and server-side data stores are not part of the architecture.
- `vite preview` is a local verification server, not the production architecture.
- Browser support, memory limits and first-load size are product constraints.
- The actual host, CI provider and production cache headers remain open decisions in ADR-007, ADR-008 and ADR-009.

## ADR-007: Choose the hosting shape

- **Status:** Proposed
- **Date:** 2026-10-21

**Context.** The current notes describe Tailscale Serve mapping `:5443` to the Vite dev server on `127.0.0.1:5300`. The app can also be served as a static `dist/` directory. The project has not recorded which shape is the production one.

**Decision.** Not made yet. Options include:

1. A static `dist/` behind Tailscale Serve, nginx or a static host.
2. A long-running `vite preview` process behind Tailscale Serve.
3. A managed static host with SPA fallback and header configuration.

Criteria: tailnet-only or public access, memory cost, SPA fallback, HTTPS, cache-header control, restart and rollback behavior, and whether the host can run the required Node build step.

**Consequences of deferring.** Deployment documentation, production cache headers, CI deployment and rollback expectations remain incomplete. The choice also determines which header mechanism ADR-009 can use.

## ADR-008: Choose the CI provider

- **Status:** Proposed
- **Date:** 2026-10-21

**Context.** `package.json` has scripts for tests, lint, format, typecheck and build, but no CI provider is recorded. The repository has a GitHub remote and signed commits; the project also uses Tangled conventions.

**Decision.** Not made yet. Options include GitHub Actions, Tangled CI, or a local pre-push gate with no hosted CI.

Criteria: repository host, secret management, runner memory for browser tests and production builds, signed-commit support, cost, and whether the provider can run Playwright browser checks.

**Consequences of deferring.** Pushes are not automatically gated by typecheck, tests, lint or build. The verification documented in this repository is reproducible manually, but a regression can reach `main` before anyone runs it.

## ADR-009: Set production cache headers

- **Status:** Proposed
- **Date:** 2026-10-21

**Context.** Vite emits content-hashed files under `assets/`. The preview server sends `Cache-Control: no-cache` for everything, so repeat visits still make conditional requests. [The performance audit](performance-verification.md) recommends immutable caching for hashed assets and no-cache for the HTML entry point.

**Decision.** Not made yet. The recommended policy is:

- `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`
- `/index.html` and the SPA fallback: `Cache-Control: no-cache`

The implementation mechanism depends on ADR-007 and may be a `_headers` file, a Cloudflare rule, nginx configuration, or the static host's control panel.

**Consequences of deferring.** Repeat visits pay avoidable round trips. Setting the policy incorrectly can pin a stale `index.html` or serve mismatched assets, so it needs verification after the host is chosen.

## When to record a decision

Add a new ADR, or supersede an existing one, before merging a change that:

- changes what data can leave the browser, the CSP allow-list, or the trust boundary around a dependency;
- changes the registry shape, route scheme, tool folder layout or shared-library ownership;
- changes the build, deployment or runtime model, including cache behavior;
- changes the lazy-loading or worker policy for a heavy engine;
- adds a durable technology choice that future contributors must follow.

Small local implementation choices belong in code comments or the relevant verification document. Accepted ADRs should be superseded rather than rewritten when a decision changes, so the history remains readable.
