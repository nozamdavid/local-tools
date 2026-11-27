import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { MediaTile } from './Controls';
import { categories, findToolByPath, getToolMeta, localizeCategory, localizeToolMeta } from '../tools/registry';
import { getMediaInfo } from '../design/media';
import { getToolIcon } from '../design/tool-icons';
import { useI18n } from '../lib/i18n';

export interface ToolPageProps {
  title: string;
  description: string;
  currentId?: string;
  children: React.ReactNode;
}

export function ToolPage({ title, description, currentId, children }: ToolPageProps) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const route = findToolByPath(pathname);
  const meta = route && route.id === currentId ? localizeToolMeta(route) : currentId ? getToolMeta(currentId) : null;
  const media = meta ? getMediaInfo(meta.media) : null;
  const rawCategory = meta ? categories.find((c) => c.id === meta.category) : null;
  const category = rawCategory ? localizeCategory(rawCategory) : null;
  const ToolIcon = meta ? getToolIcon(meta) : null;
  const displayTitle = meta?.title ?? title;
  const displayDescription = meta?.description ?? description;

  return (
    <div className="tool-page">
      {media && (
        <nav className="breadcrumb" aria-label={t('Breadcrumb')}>
          <ol>
            <li>
              <Link to="/">{t('Home')}</Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight />
            </li>
            <li>
              <Link to={media.path}>{media.title}</Link>
            </li>
            {category && (
              <>
                <li aria-hidden="true">
                  <ChevronRight />
                </li>
                <li>
                  <Link to={`${media.path}#${category.id}`}>{category.title}</Link>
                </li>
              </>
            )}
          </ol>
        </nav>
      )}

      <header className="tool-header">
        {meta && ToolIcon && (
          <MediaTile media={meta.media} size="lg">
            <ToolIcon aria-hidden="true" />
          </MediaTile>
        )}
        <div className="tool-header-text">
          <h1 className="tool-title">{displayTitle}</h1>
          <p className="tool-desc">{displayDescription}</p>
        </div>
      </header>

      <div className="tool-content">{children}</div>

      {media && (
        <div className="tool-page-footer">
          <Link to={media.path} className="tool-page-more-link">
            {t('All {media} tools', { media: media.label.toLowerCase() })}
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  );
}
