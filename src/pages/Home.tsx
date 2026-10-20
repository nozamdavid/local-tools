import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, CloudOff, Cpu, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import { FileDrop } from '../components/FileDrop';
import { ToolGrid } from '../components/ToolGrid';
import { Button, Kbd, MediaTile } from '../components/Controls';
import { openCommandPalette } from '../components/CommandPalette';
import { categories, TOOL_METAS, toolsByMedia } from '../tools/registry';
import { MEDIA_LIST } from '../design/media';
import { clearPendingFiles, setPendingFiles, suggestToolsForFiles } from '../lib/handoff';
import { formatBytes } from '../lib/format';

const POPULAR_IDS = [
  'file-converter',
  'img-compress',
  'pdf-merge',
  'img-heic-to-jpg',
  'compress',
  'pdf-compress',
  'img-resize',
  'img-remove-bg',
  'pdf-pdf-to-word',
  'audio-extract',
  'pdf-sign',
  'trim',
];

const POPULAR = POPULAR_IDS.map((id) => TOOL_METAS.find((t) => t.id === id)).filter((t) => t !== undefined);

function QuickDrop() {
  const [files, setFiles] = useState<File[]>([]);
  const suggestions = suggestToolsForFiles(files).slice(0, 12);

  if (files.length === 0) {
    return (
      <FileDrop
        multiple
        label="Drop any file to see what you can do with it"
        hint="Images, PDFs, videos, Office documents, spreadsheets and more. We'll suggest the right tools and open the file in the one you pick."
        onFiles={setFiles}
      />
    );
  }

  const first = files[0];
  return (
    <div className="quick-drop-result">
      <div className="quick-drop-file">
        <div>
          <div className="quick-drop-label">{files.length > 1 ? `${files.length} files ready` : 'Ready to open'}</div>
          <div className="quick-drop-name">
            {first.name}
            {files.length > 1 && <span> and {files.length - 1} more</span>}
          </div>
          <div className="quick-drop-meta">{formatBytes(files.reduce((sum, f) => sum + f.size, 0))} · still only on your device</div>
        </div>
        <Button
          variant="ghost"
          icon={<X />}
          onClick={() => {
            setFiles([]);
            clearPendingFiles();
          }}
        >
          Clear
        </Button>
      </div>
      <div className="quick-drop-heading">Pick a tool. Your file opens in it straight away.</div>
      <ToolGrid tools={suggestions} variant="compact" onSelect={(tool) => setPendingFiles(files, tool.path)} />
    </div>
  );
}

export function Home() {
  return (
    <div className="home">
      <section className="hero">
        <span className="badge badge-success hero-eyebrow">
          <ShieldCheck />
          Your files never leave this device
        </span>
        <h1 className="hero-title">
          Every file tool you need.
          <br />
          <span className="hero-accent">None of the uploads.</span>
        </h1>
        <p className="hero-description">
          {TOOL_METAS.length} free tools for images, PDFs, video and documents. They run in your browser with WebAssembly, so
          there's nothing to upload and no account to create.
        </p>
        <button type="button" className="hero-search" onClick={() => openCommandPalette()}>
          <Search aria-hidden="true" />
          <span>Try “heic to jpg”, “merge pdf” or “compress video”</span>
          <Kbd>/</Kbd>
        </button>
      </section>

      <section className="quick-drop" aria-label="Open a file">
        <QuickDrop />
      </section>

      <section className="home-section" aria-labelledby="popular-title">
        <div className="section-head">
          <h2 className="section-title" id="popular-title">
            Popular tools
          </h2>
        </div>
        <ToolGrid tools={POPULAR} />
      </section>

      <section className="home-section" aria-labelledby="browse-title">
        <div className="section-head">
          <h2 className="section-title" id="browse-title">
            Browse by type
          </h2>
        </div>
        <div className="media-cards">
          {MEDIA_LIST.map((info) => {
            const Icon = info.icon;
            return (
              <div key={info.media} className="media-card" data-media={info.media}>
                <Link to={info.path} className="media-card-main">
                  <MediaTile media={info.media} size="lg">
                    <Icon />
                  </MediaTile>
                  <span className="media-card-title">
                    {info.title}
                    <ChevronRight aria-hidden="true" />
                  </span>
                  <span className="media-card-desc">{info.description}</span>
                  <span className="media-card-count">{toolsByMedia(info.media).length} tools</span>
                </Link>
                <div className="media-card-cats">
                  {categories
                    .filter((c) => c.media === info.media)
                    .slice(0, 6)
                    .map((c) => (
                      <Link key={c.id} to={`${info.path}#${c.id}`} className="chip-link">
                        {c.title}
                      </Link>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="trust" aria-label="Why Loconvert">
        <div className="trust-item">
          <span className="trust-icon">
            <CloudOff aria-hidden="true" />
          </span>
          <div>
            <h3>Nothing is uploaded</h3>
            <p>Files are read straight from your disk into this tab. There's no server to send them to.</p>
          </div>
        </div>
        <div className="trust-item">
          <span className="trust-icon">
            <Cpu aria-hidden="true" />
          </span>
          <div>
            <h3>Your device does the work</h3>
            <p>FFmpeg, PDF engines, OCR and AI models run locally through WebAssembly, WebCodecs and WebGPU.</p>
          </div>
        </div>
        <div className="trust-item">
          <span className="trust-icon">
            <Sparkles aria-hidden="true" />
          </span>
          <div>
            <h3>Free, with no sign-up</h3>
            <p>No accounts and no daily limits. Close the tab and everything is gone.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
