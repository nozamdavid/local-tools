# Loconvert design system

The in-app design reference is the `/design` route (`src/pages/DesignSystem.tsx`), which displays token swatches and shared component samples.

## Files

| File | Contents |
| --- | --- |
| `src/design/tokens.css` | Neutral and supporting hue primitives, signal colours, semantic colours, type, spacing, radius, elevation, motion, z-index |
| `src/design/base.css` | Reset, document defaults, focus ring, `.sr-only`, `.skip-link` |
| `src/design/components.css` | Global component classes: buttons, fields, slider, switch, segmented, badges, chips, alerts, file drop, progress, results, batch list, media tile, and zero-specificity defaults inside `.tool-content` |
| `src/design/theme.ts` | `useTheme()` hook: charcoal on first visit, with Dark, Light, or System preferences saved in `localStorage` |
| `src/design/media.ts` | `MEDIA_LIST` / `MEDIA_INFO`: label, title, description, path and icon for each media family |
| `src/design/tool-icons.ts` | Canonical tool ID to Lucide icon mapping and `getToolIcon(meta)` lookup, with media-family fallback for unknown IDs |
| `src/lib/i18n.ts` / `src/locales/` | Six-language interface messages, browser language selection, saved explicit choice, and live React subscriptions |
| `public/theme-init.js` | Applies the saved theme before first paint (external file because of the CSP) |
| `src/styles.css` | Imports the three layers, then app shell and page layouts |

## Principles

1. **Flat workspace surfaces.** Use charcoal in dark mode and warm paper in light mode, with thin dividers and restrained hover fills. Use signal lime for shared primary buttons. Use semantic accent tokens for focus and selection, and media-family tints for category identity.
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

- The homepage pairs a large headline with a file drop panel. Opening files there suggests compatible tools. Below it, the ruled directory lists each media family, its category links, and a link to the full family index with a localized tool count.
- The shared shell has compact category navigation, search, and appearance and language controls. The interface supports English, Spanish, Italian, German, Portuguese, and French. First visit follows the browser's preferred supported language. Explicit language choices are saved on the device, and the document language and number formatting follow the selection.
- Media indexes group tools by category and use tool-specific icons selected by canonical registry ID. Category links jump to their corresponding sections, and filtering shows the matching tools.
- Tool pages use breadcrumbs, a tool-specific heading icon, the task content, and a link back to their media index. They do not add a related-tools grid.
- The footer links home and offers a search button with its keyboard shortcut alongside a short note about browser technologies.
- The shared file selector shows “Processed on this device. Nothing is uploaded.” beside the selection controls. Do not repeat this assurance as decorative copy throughout every surface.
- The simplified presentation keeps the existing routes in `src/App.tsx`: `/`, `/file`, `/video`, `/image`, `/pdf`, `/3d`, `/design`, registry-defined tool paths, and legacy video slug redirects.

## Colour tokens

Theme-dependent colours resolve through `light-dark()`. Charcoal is the first-visit theme. The monitor button follows the OS, and the sun or moon button selects the opposite appearance. Each preference is saved on the device and its resolved theme is applied through `<html data-theme="light|dark">`. Use semantic tokens in tool CSS so it follows the user's appearance preference.

| Token | Use |
| --- | --- |
| `--bg` | Page background |
| `--surface` | Cards, panels, header |
| `--surface-sunken` | Wells, previews, chips, inner panels |
| `--surface-raised` | Menus and dialogs |
| `--surface-hover` / `--surface-active` | Hover and pressed fills |
| `--border-quiet` | Subtle divisions between sections, panels and rows |
| `--border` / `--border-strong` / `--border-hover` | Default, emphasized and hovered control edges |
| `--text` / `--text-muted` / `--text-subtle` | Primary, secondary, placeholder/decorative text |
| `--signal` / `--signal-ink` | Signal-lime fill and dark ink for shared primary buttons |
| `--accent` / `--accent-hover` | Theme-aware emphasis for focus and interactive states |
| `--accent-soft` / `--accent-text` / `--accent-border` | Selected tint, text on tint, tinted outline |
| `--on-accent` | Text on `--accent` |
| `--focus-ring` | 3px focus halo (`box-shadow: 0 0 0 3px var(--focus-ring)`) |
| `--input-bg` / `--input-border` | Form fields |
| `--success`, `--warning`, `--danger`, `--info` + `-soft` + `-border` | Status text, tint and outline. `--danger-solid` for destructive buttons |
| `--media-{file,video,image,pdf,3d}` + `-soft` | Media family hues. Set `data-media="pdf"` on an element to get `--tone` / `--tone-soft` |
| `--checker-a` / `--checker-b` | Transparency checkerboard (`.checker`) |

## Scales

- **Type:** Geist Variable for display, headings, body and controls. Geist Mono Variable for counts, shortcuts, metadata and code. Both are bundled locally via `@fontsource-variable`. The shared scale runs from `--text-2xs` (11px) to `--text-4xl` (36px), plus a fluid `--text-display`. Body text uses `--text-base` (15px), controls use `--text-md` (14px), and the home headline uses its own fluid display size.
- **Spacing:** 4px grid, `--space-1` (4px) … `--space-20` (80px), plus half steps `-0-5`, `-1-5`, `-2-5`.
- **Radius:** `xs 2 · sm 4 · md 6 · lg 8 · xl 10 · 2xl 12 · full`. Controls and previews use small-to-medium radii. Tool catalog rows use flat surfaces and dividers.
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
