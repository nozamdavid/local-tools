import { useState, type ReactNode } from 'react';
import { Download, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Kbd,
  MediaTile,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  Textarea,
} from '../components/Controls';
import { FileDrop } from '../components/FileDrop';
import { ProgressBar } from '../components/ProgressBar';
import { ToolGrid } from '../components/ToolGrid';
import { LogoMark } from '../components/Logo';
import { getToolMeta } from '../tools/registry';
import { MEDIA_LIST } from '../design/media';

const SURFACES = [
  ['--bg', 'Page background'],
  ['--surface', 'Cards, panels, header'],
  ['--surface-sunken', 'Wells, previews, chips'],
  ['--surface-raised', 'Menus, dialogs'],
  ['--surface-hover', 'Hover fill'],
  ['--border', 'Default lines'],
  ['--border-strong', 'Inputs, secondary buttons'],
  ['--text', 'Primary text'],
  ['--text-muted', 'Secondary text'],
  ['--text-subtle', 'Placeholders, decoration'],
];

const ACCENTS = [
  ['--accent', 'Primary actions, focus'],
  ['--accent-soft', 'Selected and hover tint'],
  ['--accent-text', 'Accent text on soft tint'],
  ['--success', 'Done, smaller, safe'],
  ['--warning', 'Caution, larger'],
  ['--danger', 'Errors, destructive'],
  ['--info', 'Neutral notices'],
];

const TYPE_SCALE = [
  ['--text-display', 'Display', 'Hero headline'],
  ['--text-4xl', '4xl · 36', 'Page title'],
  ['--text-3xl', '3xl · 30', 'Tool title'],
  ['--text-2xl', '2xl · 24', 'Section title'],
  ['--text-xl', 'xl · 20', 'Card heading'],
  ['--text-lg', 'lg · 17', 'Lead, file-drop label'],
  ['--text-base', 'base · 15', 'Body copy'],
  ['--text-md', 'md · 14', 'Controls, labels'],
  ['--text-sm', 'sm · 13', 'Hints, meta'],
  ['--text-xs', 'xs · 12', 'Badges'],
];

const SPACES = ['1', '2', '3', '4', '5', '6', '8', '10', '12', '16'];
const RADII = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', 'full'];
const SHADOWS = ['xs', 'sm', 'md', 'lg', 'overlay'];

function Swatch({ token, note }: { token: string; note: string }) {
  return (
    <div className="ds-swatch">
      <span className="ds-swatch-color" style={{ background: `var(${token})` }} />
      <code>{token}</code>
      <span>{note}</span>
    </div>
  );
}

function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section className="ds-section" id={id} aria-labelledby={`${id}-title`}>
      <div className="ds-section-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{intro}</p>
      </div>
      {children}
    </section>
  );
}

export function DesignSystem() {
  const [mode, setMode] = useState<'percent' | 'pixels'>('percent');
  const [quality, setQuality] = useState(82);
  const [keepMeta, setKeepMeta] = useState(true);
  const [lossless, setLossless] = useState(false);

  return (
    <div className="ds">
      <header className="page-hero">
        <LogoMark size={56} />
        <div>
          <h1 className="page-title">Design system</h1>
          <p className="page-desc">
            The tokens and components every Loconvert page and tool is built from. Tokens live in{' '}
            <code>src/design/tokens.css</code>, components in <code>src/components/Controls.tsx</code>. Toggle the theme in
            the header to check both modes.
          </p>
        </div>
      </header>

      <nav className="category-chips ds-nav" aria-label="Sections">
        {['color', 'type', 'layout', 'buttons', 'forms', 'feedback', 'patterns'].map((id) => (
          <a key={id} href={`#${id}`} className="chip-link">
            {id[0].toUpperCase() + id.slice(1)}
          </a>
        ))}
      </nav>

      <Section id="color" title="Color" intro="Components use semantic tokens only. Each token carries its light and dark value via light-dark().">
        <h3 className="ds-sub">Surfaces & text</h3>
        <div className="ds-swatches">
          {SURFACES.map(([token, note]) => (
            <Swatch key={token} token={token} note={note} />
          ))}
        </div>
        <h3 className="ds-sub">Accent & status</h3>
        <div className="ds-swatches">
          {ACCENTS.map(([token, note]) => (
            <Swatch key={token} token={token} note={note} />
          ))}
        </div>
        <h3 className="ds-sub">Media families</h3>
        <p className="ds-note">
          Each kind of file has a hue. Set <code>data-media</code> on an element to get <code>--tone</code> and{' '}
          <code>--tone-soft</code>.
        </p>
        <div className="ds-row">
          {MEDIA_LIST.map((m) => (
            <div key={m.media} className="ds-media" data-media={m.media}>
              <MediaTile media={m.media} size="lg">
                <m.icon />
              </MediaTile>
              <div>
                <strong>{m.label}</strong>
                <code>--media-{m.media}</code>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="type" title="Typography" intro="Geist for interface text, Geist Mono for numbers, code and file data. Bundled locally, so no font CDN.">
        <div className="ds-type">
          {TYPE_SCALE.map(([token, label, use]) => (
            <div key={token} className="ds-type-row">
              <span className="ds-type-meta">
                <code>{token}</code>
                <span>{use}</span>
              </span>
              <span className="ds-type-sample" style={{ fontSize: `var(${token})` }}>
                {label}: Convert locally
              </span>
            </div>
          ))}
          <div className="ds-type-row">
            <span className="ds-type-meta">
              <code>--font-mono</code>
              <span>Sizes, hashes, code</span>
            </span>
            <span className="ds-type-sample" style={{ fontFamily: 'var(--font-mono)' }}>
              4.2 MB → 812 KB · sha256 9f86d08…
            </span>
          </div>
        </div>
      </Section>

      <Section id="layout" title="Space, radius & elevation" intro="A 4px spacing grid. Corners grow with the size of the element. Shadows are kept light and used for layering only.">
        <h3 className="ds-sub">Spacing</h3>
        <div className="ds-spaces">
          {SPACES.map((s) => (
            <div key={s} className="ds-space">
              <span style={{ width: `var(--space-${s})`, height: `var(--space-${s})` }} />
              <code>--space-{s}</code>
            </div>
          ))}
        </div>
        <h3 className="ds-sub">Radius</h3>
        <div className="ds-row">
          {RADII.map((r) => (
            <div key={r} className="ds-box" style={{ borderRadius: `var(--radius-${r})` }}>
              <code>{r}</code>
            </div>
          ))}
        </div>
        <h3 className="ds-sub">Elevation</h3>
        <div className="ds-row">
          {SHADOWS.map((s) => (
            <div key={s} className="ds-box ds-box-shadow" style={{ boxShadow: `var(--shadow-${s})` }}>
              <code>{s}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section id="buttons" title="Buttons" intro="One primary action per view, usually Download or Run. Secondary for alternatives, ghost for low-emphasis actions in toolbars.">
        <div className="ds-demo">
          <div className="ds-row">
            <Button icon={<Download />}>Primary</Button>
            <Button variant="secondary" icon={<RotateCcw />}>
              Secondary
            </Button>
            <Button variant="ghost" icon={<Plus />}>
              Ghost
            </Button>
            <Button variant="danger" icon={<Trash2 />}>
              Danger
            </Button>
          </div>
          <div className="ds-row">
            <Button size="sm">Small</Button>
            <Button>Medium</Button>
            <Button size="lg">Large</Button>
            <Button loading>Working…</Button>
            <Button disabled>Disabled</Button>
            <Button variant="secondary" icon={<Download />} aria-label="Icon only" />
          </div>
        </div>
      </Section>

      <Section id="forms" title="Form controls" intro="Labels sit above controls. Hints explain consequences, not mechanics. Values that matter, like quality, are shown next to the control.">
        <div className="ds-demo ds-form">
          <Field label="Output name" hint="The extension is added for you." htmlFor="ds-name">
            <Input id="ds-name" defaultValue="holiday-photo" />
          </Field>
          <Field label="Format" htmlFor="ds-format">
            <Select
              id="ds-format"
              defaultValue="webp"
              options={[
                { value: 'jpg', label: 'JPG' },
                { value: 'png', label: 'PNG' },
                { value: 'webp', label: 'WebP' },
              ]}
            />
          </Field>
          <Field label="Resize by">
            <SegmentedControl
              aria-label="Resize by"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'percent', label: 'Percentage' },
                { value: 'pixels', label: 'Pixels' },
              ]}
            />
          </Field>
          <Field label="Quality" hint="Lower is smaller, with more visible artefacts.">
            <Slider value={quality} min={1} max={100} unit="%" onChange={setQuality} aria-label="Quality" />
          </Field>
          <Field label="Notes" htmlFor="ds-notes">
            <Textarea id="ds-notes" placeholder="Optional" rows={3} />
          </Field>
          <div className="ds-row">
            <Checkbox label="Keep metadata" checked={keepMeta} onChange={setKeepMeta} />
            <Switch label="Lossless" checked={lossless} onChange={setLossless} />
          </div>
        </div>
      </Section>

      <Section id="feedback" title="Feedback" intro="Tell people what happened and what to do next. Errors say what went wrong in plain words.">
        <div className="ds-demo">
          <Alert tone="info" title="Large file">
            This video is 2.1 GB. Processing may take a few minutes and use a lot of memory.
          </Alert>
          <Alert tone="success">Your PDF was unlocked.</Alert>
          <Alert tone="warning">AVIF encoding isn't supported in this browser, so the result is WebP.</Alert>
          <Alert tone="danger">Couldn't read this file. It may be damaged or password-protected.</Alert>
          <div className="ds-row">
            <Badge>Neutral</Badge>
            <Badge tone="brand">New</Badge>
            <Badge tone="success">68% smaller</Badge>
            <Badge tone="warning">12% larger</Badge>
            <Badge tone="danger">Failed</Badge>
            <Badge tone="info">Beta</Badge>
          </div>
          <div className="meta-chips">
            <span className="meta-chip">
              Name: <strong>IMG_2041.heic</strong>
            </span>
            <span className="meta-chip">
              Size: <strong>3.4 MB</strong>
            </span>
            <span className="meta-chip">
              Dimensions: <strong>4032×3024</strong>
            </span>
          </div>
          <ProgressBar value={0.62} label="Encoding video" />
          <ProgressBar value={0} indeterminate label="Loading AI model" />
          <p className="ds-note">
            Keyboard hints use <Kbd>⌘</Kbd> <Kbd>K</Kbd>.
          </p>
        </div>
      </Section>

      <Section id="patterns" title="Patterns" intro="The pieces every tool is assembled from: drop zone, then options, then progress, then result.">
        <h3 className="ds-sub">File drop</h3>
        <FileDrop accept="image/*" label="Choose an image or drag it here" hint="JPG, PNG, WebP, HEIC, AVIF and more." onFiles={() => {}} />
        <h3 className="ds-sub">Tool cards</h3>
        <ToolGrid tools={['img-compress', 'pdf-merge', 'trim', 'csv-viewer'].map(getToolMeta)} />
        <h3 className="ds-sub">Compact tool rows</h3>
        <ToolGrid tools={['img-heic-to-jpg', 'pdf-sign', 'audio-extract', 'file-inspector'].map(getToolMeta)} variant="compact" />
      </Section>
    </div>
  );
}
