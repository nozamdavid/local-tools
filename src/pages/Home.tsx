import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, X } from 'lucide-react';
import { FileDrop } from '../components/FileDrop';
import { ToolGrid } from '../components/ToolGrid';
import { Button } from '../components/Controls';
import { categories, localizeCategory, tools, toolsByMedia, type ToolMeta } from '../tools/registry';
import { MEDIA_LIST, localizeMediaInfo } from '../design/media';
import { clearPendingFiles, setPendingFiles, suggestToolsForFiles } from '../lib/handoff';
import { formatBytes, formatNumber } from '../lib/format';
import { useI18n } from '../lib/i18n';
import styles from './Home.module.css';

function FileRoutes() {
  return (
    <svg viewBox="0 0 184 84" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <g className={styles.traces}>
        <path d="M61 42h17c8 0 8-28 18-28h26M61 42h85M61 42h17c8 0 8 28 18 28h26" />
        <circle cx="77" cy="42" r="3" fill="currentColor" />
      </g>
      <path d="M12 17h27l13 13v35H12z" fill="var(--panel)" stroke="var(--panel-line)" />
      <path d="M20 11h27l14 14v35H20z" fill="var(--surface)" />
      <path d="M47 11v14h14M30 33v14h14" strokeWidth="2.7" />
      <circle cx="42" cy="35" r="2.5" fill="currentColor" stroke="none" />
      <g className={styles.outputs} strokeLinecap="round">
        <rect x="125" y="6" width="23" height="16" rx="2" />
        <path d="m127 19 5-6 4 4 4-5 6 7M150 42h3l3-6 4 13 4-17 3 10h5M131 64h-3v4l-3 2 3 2v4h3m10-12h3v4l3 2-3 2v4h-3" />
      </g>
    </svg>
  );
}

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
    <div ref={wrapperRef} className={styles.intake}>
      {files.length === 0 ? (
        <FileDrop multiple icon={<FileRoutes />} label={t('Drop files here')} onFiles={setFiles} />
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
    <div className={styles.home}>
      <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.intro}>
          <h1 id="home-title" className={styles.title}>
            {t('Your local')} <span>{t('file toolkit.')}</span>
          </h1>
          <p className={styles.description}>
            {t('Convert, edit, and inspect files in your browser. Open a file to see which tools can work with it.')}
          </p>
        </div>
        <section className={styles.drop} aria-label={t('Open a file')}>
          <QuickDrop />
        </section>
      </section>

      <section aria-labelledby="browse-title">
        <header className={styles.catalogHeader}>
          <h2 id="browse-title">{t('Browse tools')}</h2>
          <span className={styles.count}>{t('{count} tools', { count: formatNumber(tools.length) })}</span>
        </header>
        <div className={styles.catalog}>
          {MEDIA_LIST.map((rawInfo) => {
            const info = localizeMediaInfo(rawInfo);
            const Icon = info.icon;
            const mediaCategories = categories.filter((category) => category.media === info.media).map(localizeCategory);
            const toolCount = toolsByMedia(info.media).length;
            return (
              <section key={info.media} className={styles.row} data-media={info.media}>
                <h3 className={styles.family}>
                  <Link to={info.path} className={styles.familyLink}>
                    <Icon aria-hidden="true" />
                    <span>{info.title}</span>
                  </Link>
                </h3>
                <nav className={styles.categories} aria-label={t('{media} categories', { media: info.label })}>
                  {mediaCategories.map((category) => (
                    <Link key={category.id} to={`${info.path}#${category.id}`}>
                      {category.title}
                    </Link>
                  ))}
                </nav>
                <Link to={info.path} className={`${styles.count} ${styles.familyCount}`}>
                  <span className={styles.srOnly}>{t('All {media} tools', { media: info.label.toLowerCase() })} · </span>
                  {t('{count} tools', { count: formatNumber(toolCount) })}
                  <ArrowUpRight aria-hidden="true" />
                </Link>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}
