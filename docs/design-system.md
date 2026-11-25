# Loconvert design system

The in-app design reference is the `/design` route (`src/pages/DesignSystem.tsx`), which displays token swatches and shared component samples.

## Files

| File | Contents |
| --- | --- |
| `src/design/tokens.css` | Primitives (`--gray-*`, `--berry-*`), semantic colours, type, spacing, radius, elevation, motion, z-index |
| `src/design/base.css` | Reset, document defaults, focus ring, `.sr-only`, `.skip-link` |
| `src/design/components.css` | Global component classes: buttons, fields, slider, switch, segmented, badges, chips, alerts, file drop, progress, results, batch list, media tile, and zero-specificity defaults inside `.tool-content` |
| `src/design/theme.ts` | `useTheme()` hook: follow the OS by default, with explicit light or dark preferences saved in `localStorage` |
| `src/design/media.ts` | `MEDIA_LIST` / `MEDIA_INFO`: label, title, description, path and icon for each media family |
| `src/design/tool-icons.ts` | Canonical tool ID to Lucide icon mapping and `getToolIcon(meta)` lookup, with media-family fallback for unknown IDs |
| `src/lib/i18n.ts` / `src/locales/` | Six-language interface messages, browser language selection, saved explicit choice, and live React subscriptions |
| `public/theme-init.js` | Applies the saved theme before first paint (external file because of the CSP) |
| `src/styles.css` | Imports the three layers, then app shell and page layouts |

## Principles

1. **Quiet, flat surfaces.** Use neutral backgrounds, thin dividers, and restrained hover fills. Use semantic `--accent` for primary actions, focus, and selected states; keep media-family tints for category identity.
2. **Keep the main task in view.** Keep the controls needed to complete the task and its primary action visible. Put secondary, contextual settings in native `<details className="tool-options">` with `.tool-options-body` when useful.
3. **Keep common flows simple.** File selection carries one concise local-processing reminder. Shared upload, progress, result, and download components use compact layouts and clear actions.
4. **Tokens, not values.** Components use semantic tokens so the same surfaces and controls work in light and dark themes.
5. **Show visual feedback before export where practical.** Prefer a bounded preview that responds to task controls. Keep expensive full exports behind the primary action. Label source-only and approximate previews, and show the full result after export.

## Interactive preview patterns

- Crop editors let users draw and move a selection, resize from edge or corner handles, and make keyboard or numeric adjustments. Image crop uses source-pixel coordinates and a rule-of-thirds grid; video crop coordinates use even pixels.
- Image resize, compression, and conversion previews are bounded to 512 pixels per edge. Image and circle crop editor previews are bounded to 1,280 pixels per edge. Batch image previews show the first item only; compression size figures are estimates from bounded samples.
- Video resize shows the source in the target frame for fit, fill, or stretch without encoding an output on each setting change. Speed uses browser playback rate, trim plays the selected range, and source-only previews for expensive media transforms depend on browser playback support.
- PDF watermark and page-number previews apply the same annotation functions used for export to one selected page, rasterized to at most 900 pixels per edge. Watermark placement supports dragging and arrow keys; PDF crop handles support keyboard adjustment.
- The icon converter shows a target icon preview before Convert. Preview limits are specific to the source type and do not prevent conversion: image previews support files up to 16 MiB; ICO previews support files and frame data up to 4 MiB, at most 16 frames, and frames no larger than 256 × 256 pixels.

## Application shell

- The homepage opens with the file selector, followed by media cards with larger category titles. Each card ends its category navigation with a `+N` link to all tools in that media family; the count reflects the current tool total and follows the selected locale's number formatting. The interface supports English, Spanish, Italian, German, Portuguese, and French. First visit follows the browser's preferred supported language; the shared header has a compact native language selector beside the sun/moon theme toggle. Explicit language choices are saved on the device, and the document language and number formatting follow the selection.
- The shared shell has compact category navigation and search. Category navigation keeps media-family icons; tool catalogs use action icons selected by canonical registry ID.
- Tool pages use breadcrumbs, a tool-specific heading icon, the task content, and a link back to their media index. They do not add a related-tools grid.
- The footer stays minimal: a short note about browser technologies and the search shortcut.
- The shared file selector shows “Processed on this device. Nothing is uploaded.” beside the selection controls. Do not repeat this assurance as decorative copy throughout every surface.
- The simplified presentation keeps the existing routes in `src/App.tsx`: `/`, `/file`, `/video`, `/image`, `/pdf`, `/3d`, `/design`, registry-defined tool paths, and legacy video slug redirects.

## Colour tokens

Each semantic token holds both modes via `light-dark()`. The initial scheme follows the OS. The sun/moon toggle switches between light and dark, and that explicit choice is saved on the device and applied through `<html data-theme="light|dark">`. **Do not write `@media (prefers-color-scheme)` in tool CSS**: it ignores the user's saved choice.

| Token | Use |
| --- | --- |
| `--bg` | Page background |
| `--surface` | Cards, panels, header |
| `--surface-sunken` | Wells, previews, chips, inner panels |
| `--surface-raised` | Menus and dialogs |
| `--surface-hover` / `--surface-active` | Hover and pressed fills |
| `--border` / `--border-strong` / `--border-hover` | Lines: default, inputs and secondary buttons, hover |
| `--text` / `--text-muted` / `--text-subtle` | Primary, secondary, placeholder/decorative text |
| `--accent` / `--accent-hover` | Primary buttons, focus, active states (berry) |
| `--accent-soft` / `--accent-text` / `--accent-border` | Selected tint, text on tint, tinted outline |
| `--on-accent` | Text on `--accent` |
| `--focus-ring` | 3px focus halo (`box-shadow: 0 0 0 3px var(--focus-ring)`) |
| `--input-bg` / `--input-border` | Form fields |
| `--success`, `--warning`, `--danger`, `--info` + `-soft` + `-border` | Status text, tint and outline. `--danger-solid` for destructive buttons |
| `--media-{file,video,image,pdf}` + `-soft` | Media family hues. Set `data-media="pdf"` on an element to get `--tone` / `--tone-soft` |
| `--checker-a` / `--checker-b` | Transparency checkerboard (`.checker`) |

## Scales

- **Type:** Geist Variable for UI and Geist Mono Variable for numbers, sizes, hashes and code, both bundled locally via `@fontsource-variable`. Sizes go from `--text-2xs` (11px) to `--text-4xl` (36px), plus a fluid `--text-display`. Body text is `--text-base` (15px) and controls use `--text-md` (14px).
- **Spacing:** 4px grid, `--space-1` (4px) … `--space-20` (80px), plus half steps `-0-5`, `-1-5`, `-2-5`.
- **Radius:** `xs 4 · sm 6 · md 8 · lg 12 · xl 16 · 2xl 22 · full`. Controls and previews use small-to-medium radii; tool catalog rows stay flat with dividers.
- **Elevation:** `--shadow-xs … --shadow-lg`, `--shadow-overlay` for dialogs. Borders separate; shadows layer.
- **Motion:** `--duration-fast/base/slow`, `--ease-out`. All durations drop to 0 with `prefers-reduced-motion`.

## Components (`src/components`)

| Component | Notes |
| --- | --- |
| `Button` | `variant`: primary · secondary · ghost · danger. `size`: sm · md · lg. `icon` (lucide element), `loading`. Defaults to `type="button"`. Icon-only when there are no children (give it `aria-label`). |
| `Field` | Label above control, `hint` or `error` below. Pass `htmlFor` with the control's `id`. |
| `Input`, `Textarea`, `Select` | Styled native controls (`.input`, `.textarea`, `.select`). |
| `Slider` | Range with filled track and value readout. |
| `Checkbox`, `Switch` | Boolean inputs. A switch applies immediately, a checkbox is part of a form. |
| `SegmentedControl` | 2–4 mutually exclusive options (radiogroup with arrow keys). |
| `Badge`, `Kbd`, `Alert`, `MediaTile` | Status labels, keyboard keys, inline notices (info/success/warning/danger), and a tinted media-color icon tile. |
| `FileDrop` | Click, keyboard, drag and drop, or paste. Filters by `accept`, picks up files handed over from the home page (`src/lib/handoff.ts`), and shows the local-processing reminder at selection. |
| `ProgressBar` | Determinate, or `indeterminate` for unknown durations such as model downloads. |
| `ResultPanel`, `BatchResults` | Simple output summary and available preview, with start-over and download actions. Batch results also support downloading all files as a ZIP. |
| `ContinueWith` | Secondary button for one contextual next tool; optional “More” lists up to three other tools that accept the output set. Used by `ResultPanel`, `BatchResults`, `PdfPreview`, and ZIP extraction results. The compatible file handoff stays in memory for up to five minutes and is not persisted. |
| `ToolPage` | Breadcrumb, tool-specific icon, heading, task content, and a link back to the media index. Always pass `currentId`. |
| `ToolGrid` / `ToolCard` | Flat tool rows with icons selected by canonical tool ID; `default` includes a one-line description and `compact` keeps the title only. |
| `CommandPalette` | ⌘K / Ctrl K / `/` local search (`src/lib/search.ts`) across tool names, formats, and task phrases. It tolerates common one-character typos and searches English plus the current interface language, including accents. `openCommandPalette(query?)` opens it from anywhere. |

Global classes that tools use directly: `.meta-chips` / `.meta-chip`, `.error-banner`, `.action-buttons`, `.stats-row`, `.toolbar`, `.status-text`, `.preview-media`, `.checker`, `.empty-state`.

## Writing tool styles

- Prefer the shared components. Use a `Tool.module.css` only for layout specific to the tool (canvases, page grids).
- Keep the controls required for the primary task visible. Group secondary contextual settings in native `<details className="tool-options">` and `.tool-options-body`.
- Inside `.tool-content`, unstyled `<button>`, text inputs, `<select>`, `<textarea>`, tables and `code` get design-system defaults at zero specificity. Any module class overrides them.
- Use semantic tokens only. The old `--color-*` names were removed.
- Dark editing canvases (video/image stages) may keep a fixed dark backdrop on purpose. Everything around them uses tokens.
- Category navigation uses media-family icons inside `MediaTile`; tool rows, search results, tool headers, and continue actions use `getToolIcon(meta)` from `src/design/tool-icons.ts`. Keep `MediaTile` colours tied to the media family.
