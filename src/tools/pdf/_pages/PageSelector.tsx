import { useState } from 'react';
import { Button } from '../../../components/Controls';
import { expandRange, formatPages, parseRanges } from './pdfPages';
import styles from './PageSelector.module.css';
import { useI18n } from '../../../lib/i18n';

export interface PageSelectorProps {
  pageCount: number;
  thumbs: Record<number, string>;
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  /** "keep" highlights chosen pages in the brand color; "delete" marks them as removed. */
  tone: 'keep' | 'delete';
  rangeLabel: string;
}

export function PageSelector({ pageCount, thumbs, selected, onChange, tone, rangeLabel }: PageSelectorProps) {
  const { t } = useI18n();
  const [text, setText] = useState(() => formatPages(selected));
  let rangeError: string | null = null;
  if (text.trim()) {
    try {
      parseRanges(text, pageCount);
    } catch (err) {
      rangeError = t(err instanceof Error ? err.message : 'Invalid range.');
    }
  }

  const commit = (next: Set<number>) => {
    onChange(next);
    setText(formatPages(next));
  };

  const toggle = (page: number) => {
    const next = new Set(selected);
    if (next.has(page)) next.delete(page);
    else next.add(page);
    commit(next);
  };

  const handleText = (value: string) => {
    setText(value);
    if (value.trim() === '') {
      onChange(new Set());
      return;
    }
    try {
      const pages = parseRanges(value, pageCount).flatMap(expandRange);
      onChange(new Set(pages));
    } catch {
      // Keep the selection until the draft range is valid; render its error above.
    }
  };

  const mark = tone === 'delete' ? '✕' : '✓';

  return (
    <div>
      <div className={styles.rangeRow}>
        <input
          type="text"
          className={styles.rangeInput}
          aria-label={t(rangeLabel)}
          placeholder={t('{label}, e.g. 1-3, 5, 7-', { label: t(rangeLabel) })}
          value={text}
          onChange={(e) => handleText(e.target.value)}
        />
        <Button variant="secondary" onClick={() => commit(new Set(Array.from({ length: pageCount }, (_, i) => i + 1)))}>
          {t('Select all')}
        </Button>
        <Button variant="secondary" onClick={() => commit(new Set())}>
          {t('Clear')}
        </Button>
      </div>
      {rangeError && <p className={styles.rangeError}>{rangeError}</p>}

      <div className={styles.pageGrid}>
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
          const isSelected = selected.has(page);
          const toneClass = isSelected ? (tone === 'delete' ? styles.pageCardDelete : styles.pageCardKeep) : '';
          return (
            <button
              type="button"
              key={page}
              className={`${styles.pageCard} ${toneClass}`}
              aria-pressed={isSelected}
              aria-label={t('Page {number}', { number: page })}
              onClick={() => toggle(page)}
            >
              {isSelected && <span className={styles.pageMark}>{mark}</span>}
              <div className={styles.pageThumbWrapper}>
                {thumbs[page] ? (
                  <img src={thumbs[page]} alt="" className={styles.pageThumb} />
                ) : (
                  <span className={styles.pageThumbPlaceholder}>{t('Loading…')}</span>
                )}
              </div>
              <span className={styles.pageLabel}>{t('Page {number}', { number: page })}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
