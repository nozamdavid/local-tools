import { useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { CategorySections } from '../components/CategorySections';
import { MediaTile } from '../components/Controls';
import { categories, localizeCategory, toolsByMedia, type Media } from '../tools/registry';
import { getMediaInfo } from '../design/media';
import { searchTools } from '../lib/search';
import { useI18n } from '../lib/i18n';

export function MediaIndex({ media }: { media: Media }) {
  const { t, locale } = useI18n();
  const info = getMediaInfo(media);
  const Icon = info.icon;
  const [query, setQuery] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const total = toolsByMedia(media).length;

  const matches = useMemo(() => {
    if (!query.trim()) return null;
    return new Set(searchTools(query, 500, locale, media).map((t) => t.id));
  }, [query, media, locale]);

  return (
    <div className="media-index">
      <header className="page-hero" data-media={media}>
        <MediaTile media={media} size="lg">
          <Icon aria-hidden="true" />
        </MediaTile>
        <div>
          <h1 className="page-title">{info.title}</h1>
          <p className="page-desc">{t('{description} {count} tools.', { description: info.description, count: total })}</p>
        </div>
      </header>

      <div className="index-toolbar">
        <div className="filter-input">
          <Search aria-hidden="true" />
          <input
            ref={filterRef}
            type="search"
            aria-label={t('Filter {media} tools', { media: info.label.toLowerCase() })}
            placeholder={t('Filter {count} {media} tools', { count: total, media: info.label.toLowerCase() })}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="filter-clear"
              aria-label={t('Clear filter')}
              onClick={() => {
                setQuery('');
                filterRef.current?.focus();
              }}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="sr-only" role="status">
          {matches
            ? matches.size === 1
              ? t('One tool matches your filter')
              : t('{count} tools match your filter', { count: matches.size })
            : ''}
        </div>
      </div>

      <div className={matches ? 'index-directory' : 'index-directory index-directory-browse'}>
        {!matches && (
          <nav className="index-categories" aria-label={t('Categories')}>
            {categories
              .filter((c) => c.media === media)
              .map((category) => localizeCategory(category))
              .map((c) => (
                <a key={c.id} href={`#${c.id}`}>
                  {c.title}
                </a>
              ))}
          </nav>
        )}
        <div className="index-results">
          {matches && matches.size === 0 ? (
            <div className="empty-state">
              <Search aria-hidden="true" />
              <div className="empty-state-title">{t('No {media} tools match “{query}”', { media: info.label.toLowerCase(), query })}</div>
              <div>{t('Try a file format or an action, like “png” or “compress”.')}</div>
            </div>
          ) : (
            <CategorySections media={media} filter={matches ? (t) => matches.has(t.id) : undefined} />
          )}
        </div>
      </div>
    </div>
  );
}
