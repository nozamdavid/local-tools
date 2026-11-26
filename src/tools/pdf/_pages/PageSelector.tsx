import { Button } from '../../../components/Controls';
import { formatPages } from './pdfPages';
import styles from './PageSelector.module.css';
import { useI18n } from '../../../lib/i18n';

export interface PageSelectorProps {
  pageCount: number;
  thumbs: Record<number, string>;
  selected: Set<number>;
  rangeText: string;
  rangeError: string | null;
  onChange: (next: string) => void;
  /** "keep" highlights chosen pages in the brand color; "delete" marks them as removed. */
  tone: 'keep' | 'delete';
  rangeLabel: string;
}

export function PageSelector({ pageCount, thumbs, selected, rangeText, rangeError, onChange, tone, rangeLabel }: PageSelectorProps) {
  const { t } = useI18n();

  const toggle = (page: number) => {
    const next = new Set(selected);
    if (next.has(page)) next.delete(page);
    else next.add(page);
    onChange(formatPages(next));
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
          value={rangeText}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button variant="secondary" onClick={() => onChange(pageCount === 1 ? '1' : `1-${pageCount}`)}>
          {t('Select all')}
        </Button>
        <Button variant="secondary" onClick={() => onChange('')}>
          {t('Clear')}
        </Button>
      </div>
      {rangeError && <p className={styles.rangeError}>{t(rangeError)}</p>}

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
