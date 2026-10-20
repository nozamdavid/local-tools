# Loconvert design system

The live reference is the `/design` route (`src/pages/DesignSystem.tsx`). It renders every token and component in the current theme.

## Files

| File | Contents |
| --- | --- |
| `src/design/tokens.css` | Primitives (`--gray-*`, `--berry-*`), semantic colours, type, spacing, radius, elevation, motion, z-index |
| `src/design/base.css` | Reset, document defaults, focus ring, `.sr-only`, `.skip-link` |
| `src/design/components.css` | Global component classes: buttons, fields, slider, switch, segmented, badges, chips, alerts, file drop, progress, results, batch list, media tile, and zero-specificity defaults inside `.tool-content` |
| `src/design/theme.ts` | `useTheme()` hook (system / light / dark, saved in `localStorage`) |
| `src/design/media.ts` | `MEDIA_LIST` / `MEDIA_INFO`: label, title, description, path and icon for each media family |
| `public/theme-init.js` | Applies the saved theme before first paint (external file because of the CSP) |
| `src/styles.css` | Imports the three layers, then app shell and page layouts |

## Principles

1. **Privacy is the product.** Every surface that touches a file repeats, quietly, that it stays on the device. Success green signals "safe/local".
2. **One primary action per view.** Usually *Choose file*, *Run*, or *Download*. Everything else is secondary or ghost.
3. **Drop → options → progress → result.** Every tool follows this flow using the shared components, so all 126 tools feel like one product.
4. **Tokens, not values.** Components never use hex values or primitives directly. Use semantic tokens so light and dark both work.

## Colour tokens

Each semantic token holds both modes via `light-dark()`. The scheme follows the OS, or `<html data-theme="light|dark">` when the user picks one. **Do not write `@media (prefers-color-scheme)` in tool CSS**: it ignores the user's choice.

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
- **Radius:** `xs 4 · sm 6 · md 8 · lg 12 · xl 16 · 2xl 22 · full`. Controls use `md`, cards `lg`, large panels `xl`.
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
| `Badge`, `Kbd`, `Alert`, `MediaTile` | Status labels, keyboard keys, inline notices (info/success/warning/danger), tinted emoji/icon square. |
| `FileDrop` | Click, keyboard, drag and drop, or paste. It filters by `accept` and picks up files handed over from the home page (`src/lib/handoff.ts`). |
| `ProgressBar` | Determinate, or `indeterminate` for unknown durations such as model downloads. |
| `ResultPanel`, `BatchResults` | Previews, size change and download actions. |
| `ToolPage` | Breadcrumb, header, panel and related tools. Always pass `currentId`. |
| `ToolGrid` / `ToolCard` | `default` cards or `compact` rows. |
| `CommandPalette` | ⌘K / Ctrl K / `/` tool search (`src/lib/search.ts`). `openCommandPalette(query?)` opens it from anywhere. |

Global classes that tools use directly: `.meta-chips` / `.meta-chip`, `.error-banner`, `.action-buttons`, `.stats-row`, `.toolbar`, `.status-text`, `.preview-media`, `.checker`, `.empty-state`.

## Writing tool styles

- Prefer the shared components. Use a `Tool.module.css` only for layout specific to the tool (canvases, page grids).
- Inside `.tool-content`, unstyled `<button>`, text inputs, `<select>`, `<textarea>`, tables and `code` get design-system defaults at zero specificity. Any module class overrides them.
- Use semantic tokens only. The old `--color-*` names were removed.
- Dark editing canvases (video/image stages) may keep a fixed dark backdrop on purpose. Everything around them uses tokens.
- Icons come from `lucide-react`. Tool identities stay as the emoji in the registry, shown inside a `MediaTile`.
