import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, X } from 'lucide-react';
import { FileDrop } from '../components/FileDrop';
import { ToolGrid } from '../components/ToolGrid';
import { Button } from '../components/Controls';
import { categories, toolsByMedia, type ToolMeta } from '../tools/registry';
import { MEDIA_LIST } from '../design/media';
import { clearPendingFiles, setPendingFiles, suggestToolsForFiles } from '../lib/handoff';
import { formatBytes, formatNumber } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { localizeCategory } from '../tools/registry';
import { localizeMediaInfo } from '../design/media';

function QuickDrop() {
  const { t } = useI18n();
  const [files, setFiles] = useState<File[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hadFiles = useRef(false);
  const suggestions = suggestToolsForFiles(files).slice(0, 12);

  // Swapping the drop zone for the result list unmounts the focused control, so hand focus to whatever replaces it.
  useEffect(() => {
    const has = files.length > 0;
    if (has !== hadFiles.current) {
      const next = has
        ? wrapperRef.current?.querySelector<HTMLElement>('.quick-drop-result')
        : wrapperRef.current?.querySelector<HTMLElement>('.file-drop button');
      next?.focus({ preventScroll: true });
    }
    hadFiles.current = has;
  }, [files.length]);

  const first = files[0];
  return (
    <div ref={wrapperRef}>
      {files.length === 0 ? (
        <FileDrop
          multiple
          label={t('Drop a file to find the right tool')}
          hint={t('Choose a suggested tool and your file opens there.')}
          onFiles={setFiles}
        />
      ) : (
        <QuickDropResult
          files={files}
          first={first}
          suggestions={suggestions}
          onClear={() => {
            setFiles([]);
            clearPendingFiles();
          }}
        />
      )}
    </div>
  );
}

function QuickDropResult({
  files,
  first,
  suggestions,
  onClear,
}: {
  files: File[];
  first: File;
  suggestions: ToolMeta[];
  onClear: () => void;
}) {
  const { t } = useI18n();
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="quick-drop-result" tabIndex={-1} role="region" aria-label={t('Files ready')}>
      <div className="quick-drop-file">
        <div>
          <div className="quick-drop-label">{files.length > 1 ? t('{count} files ready', { count: files.length }) : t('File ready')}</div>
          <div className="quick-drop-name">
            {first.name}
            {files.length > 1 && <span> {t('and {count} more', { count: files.length - 1 })}</span>}
          </div>
          <div className="quick-drop-meta">{t('{size} total · stays on your device', { size: formatBytes(totalSize) })}</div>
        </div>
        <Button variant="ghost" icon={<X />} onClick={onClear}>
          {t('Clear')}
        </Button>
      </div>
      <div className="quick-drop-heading">{t('Choose a tool to open these files.')}</div>
      <ToolGrid tools={suggestions} variant="compact" onSelect={(tool) => setPendingFiles(files, tool.path)} />
    </div>
  );
}

export function Home() {
  const { t } = useI18n();
  return (
    <div className="home">
      <section className="quick-drop" aria-label={t('Open a file')}>
        <QuickDrop />
      </section>

      <section className="home-browse" aria-labelledby="browse-title">
        <h1 className="section-title" id="browse-title">
          {t('Browse tools')}
        </h1>
        <div className="home-browse-list">
          {MEDIA_LIST.map((rawInfo) => {
            const info = localizeMediaInfo(rawInfo);
            const Icon = info.icon;
            const mediaCategories = categories.filter((category) => category.media === info.media).map(localizeCategory);
            const toolCount = toolsByMedia(info.media).length;
            return (
              <section key={info.media} className="home-browse-group" data-media={info.media}>
                <h2 className="home-browse-heading">
                  <Link to={info.path}>
                    <Icon aria-hidden="true" />
                    <span className="home-browse-title">{info.title}</span>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </h2>
                <nav className="home-browse-categories" aria-label={t('{media} categories', { media: info.label })}>
                  {mediaCategories.map((category) => (
                    <Link key={category.id} to={`${info.path}#${category.id}`} className="chip-link">
                      {category.title}
                    </Link>
                  ))}
                  <Link to={info.path} className="chip-link" aria-label={t('All {media} tools', { media: info.label.toLowerCase() })}>
                    +{formatNumber(toolCount)}
                  </Link>
                </nav>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}
