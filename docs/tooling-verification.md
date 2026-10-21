# Loconvert Test, Lint and Formatting Toolchain (Taproot lc-tests, lc-lint)

Date: 2026-10-21

This document records the test, lint, typecheck and formatting setup added in this pass, the state before and after, and the limits of the current checks.

## 1. Toolchain

| Concern | Tool | Version | Configuration |
|---|---|---|---|
| Unit tests | Vitest | 5.0.5 | `vitest.config.ts`, Node environment, `src/**/*.test.ts` |
| Lint | ESLint | 10.13.0 | `eslint.config.js` (flat config) |
| TypeScript lint parser | typescript-eslint | 8.72.0 | `js.configs.recommended` + `tseslint.configs.recommended` |
| React hooks | eslint-plugin-react-hooks | 7.1.1 | `rules-of-hooks: error`, `exhaustive-deps: warn` |
| Formatting | Prettier | 3.9.10 | `.prettierrc`: 140 columns, single quotes, semicolons, trailing commas |
| Typecheck | TypeScript | 7.0.2 native | `tsc --noEmit -p .` |
| Compiler API | TypeScript | 6.0.2 | aliased as `typescript` for typescript-eslint |

### 1.1 TypeScript 7 and the compiler API alias

The repository uses the native TypeScript 7 compiler (`@typescript/native`, version 7.0.2) for `tsc`, but typescript-eslint still needs the JavaScript compiler API, which the native compiler does not expose. `package.json` therefore pins two packages:

```json
"typescript": "npm:@typescript/typescript6@^6.0.2",
"@typescript/native": "npm:typescript@^7.0.2"
```

`node_modules/.bin/tsc` points at `@typescript/native/bin/tsc` (7.0.2), while `require('typescript')` resolves to 6.0.2 for the linter. This is a deliberate workaround; removing either alias breaks either the typecheck or the linter.

## 2. Results

| Check | Before | After | Command |
|---|---|---|---|
| Unit tests | none | 5 files, 39 tests passing | `npm test` |
| Lint | 190 problems: 182 errors, 8 warnings | 85 problems: 0 errors, 85 warnings | `npm run lint` |
| Formatting | 277 files non-conforming | `format:check` passes | `npm run format:check` |
| Typecheck | passing | passing (exit 0) | `npx tsc --noEmit -p .` |

The lint exit code is 0 after the changes. The 85 warnings are:

- 77 `@typescript-eslint/no-explicit-any` warnings. The rule was changed from error to warn as a ratchet: 79 existing uses were reduced to 77 while fixing `avif.verify.ts`; new code should avoid `any`.
- 8 `react-hooks/exhaustive-deps` warnings. These are the same dependency-array warnings that existed before the pass.

The new React Compiler rules (`react-hooks/set-state-in-effect`, `react-hooks/refs`) are not enabled. The config uses the two standard hooks rules instead, so those 30 pre-existing findings are outside the current lint contract rather than silenced. Enabling them would require a separate refactor of document-loading effects across the PDF and subtitle tools.

## 3. Tests

`npm test` runs Vitest in the Node environment:

- `src/lib/format.test.ts` (15 tests): `formatBytes` boundaries and invalid input, `formatDuration` boundaries, `replaceExt`, `withSuffix`.
- `src/lib/image.test.ts` (1 test): `encodeBmp` produces a valid 24-bit bottom-up BMP and flattens alpha onto white.
- `src/lib/zip.test.ts` (3 tests): duplicate-name de-duplication, extensionless names, case-sensitive distinct names.
- `src/lib/errors.test.ts` (9 tests): empty input, AVIF/HEIC/JXL codec failures, FFmpeg and encoder messages, memory and canvas failures, corrupt images, non-Error objects, and preservation of unmapped messages.
- `src/tools/registry.test.ts` (11 tests): every registry entry resolves to an existing `Tool.tsx`, ids and paths are unique, each tool has 3–8 kebab-case tags, no tag equals a media value or category id, category/media consistency, and required metadata is present.

The registry test reads the filesystem, so it assumes it is run from the repository root. It does not render components.

## 4. Lint fixes

The pass fixed every error without changing user-facing behaviour:

- `no-useless-assignment` (30): removed initial values that every branch overwrote, or made variables definitely assigned. TypeScript's control-flow analysis verifies the assignments.
- `preserve-caught-error` (21): added `{ cause: err }` to rethrown errors without changing their messages.
- `prefer-const` (7): automatic fixes after confirming the binding was never reassigned.
- `@typescript-eslint/no-unused-vars` (5), `no-empty` (3), `no-useless-escape` (3), `no-unassigned-vars` (2), `prefer-rest-params` (1), `no-control-regex` (1): minimal mechanical fixes. The control-character regex in `src/tools/_file-utility/rename.ts` keeps its semantics and has a targeted `eslint-disable-next-line` with a reason.
- Two `no-unassigned-vars` findings were real dead paths (`shapeConfig` in the image annotator and `currentPageHeader` in PDF text extraction). They were always undefined and remain so; the change only makes that explicit.

## 5. Formatting

`npm run format` applied Prettier across the repository. `.prettierignore` excludes `dist`, `node_modules`, `package-lock.json`, `public`, and `docs`. `npm run format:check` now passes. Prettier ran after all source edits so the formatting pass did not fight the lint fixes.

## 6. Reproduce

```bash
npm test
npm run lint
npm run format:check
npx tsc --noEmit -p .
```

Heavy steps were run with the shared lock and a 3 GiB memory cap:

```bash
flock /tmp/loconvert-heavy.lock systemd-run --user --scope \
  -p MemoryMax=3G -p MemorySwapMax=0 npx tsc --noEmit -p .
```

## 7. Gaps

- No component or DOM tests; Vitest uses the Node environment and does not render React.
- No coverage thresholds or CI configuration. The scripts are available for CI but are not wired to a provider.
- The registry test depends on the source tree layout and will not run from a published bundle.
- The 85 warnings are accepted, not fixed. `no-explicit-any` is a ratchet, not a clean bill of health.
- The React Compiler hook rules are disabled by omission, as described above.
