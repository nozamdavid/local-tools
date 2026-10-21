import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { CategorySections } from '../components/CategorySections';
import { MediaTile } from '../components/Controls';
import { categories, toolsByMedia, type Media } from '../tools/registry';
import { MEDIA_INFO } from '../design/media';
import { searchTools } from '../lib/search';

export function MediaIndex({ media }: { media: Media }) {
  const info = MEDIA_INFO[media];
  const Icon = info.icon;
  const [query, setQuery] = useState('');
  const total = toolsByMedia(media).length;

  const matches = useMemo(() => {
    if (!query.trim()) return null;
    return new Set(
      searchTools(query, 500)
        .filter((t) => t.media === media)
        .map((t) => t.id),
    );
  }, [query, media]);

  return (
    <div className="media-index">
      <header className="page-hero" data-media={media}>
        <MediaTile media={media} size="lg">
          <Icon />
        </MediaTile>
        <div>
          <h1 className="page-title">{info.title}</h1>
          <p className="page-desc">
            {info.description} {total} tools, all running on your device.
          </p>
        </div>
      </header>

      <div className="index-toolbar">
        <label className="filter-input">
          <Search aria-hidden="true" />
          <span className="sr-only">Filter {info.label.toLowerCase()} tools</span>
          <input
            type="search"
            placeholder={`Filter ${total} ${info.label.toLowerCase()} tools`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="filter-clear" aria-label="Clear filter" onClick={() => setQuery('')}>
              <X />
            </button>
          )}
        </label>
        <div className="sr-only" role="status">
          {matches ? `${matches.size} ${matches.size === 1 ? 'tool matches' : 'tools match'} your filter` : ''}
        </div>
        {!matches && (
          <nav className="category-chips" aria-label="Categories">
            {categories
              .filter((c) => c.media === media)
              .map((c) => (
                <a key={c.id} href={`#${c.id}`} className="chip-link">
                  {c.title}
                </a>
              ))}
          </nav>
        )}
      </div>

      {matches && matches.size === 0 ? (
        <div className="empty-state">
          <Search aria-hidden="true" />
          <div className="empty-state-title">
            No {info.label.toLowerCase()} tools match “{query}”
          </div>
          <div>Try a file format or an action, like “png” or “compress”.</div>
        </div>
      ) : (
        <CategorySections media={media} filter={matches ? (t) => matches.has(t.id) : undefined} />
      )}
    </div>
  );
}
