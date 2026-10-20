import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { ToolGrid } from './ToolGrid';
import { Badge, MediaTile } from './Controls';
import { categories, TOOL_METAS, getToolMeta } from '../tools/registry';
import { MEDIA_INFO } from '../design/media';

export interface ToolPageProps {
  title: string;
  description: string;
  currentId?: string;
  children: React.ReactNode;
}

const MORE_TOOLS_LIMIT = 8;

function moreTools(currentId?: string) {
  if (!currentId) return TOOL_METAS.filter((t) => t.popular).slice(0, MORE_TOOLS_LIMIT);

  const current = getToolMeta(currentId);
  const sameMedia = TOOL_METAS.filter((t) => t.media === current.media && t.id !== currentId);
  const sameCategory = sameMedia.filter((t) => t.category === current.category);
  const popular = sameMedia.filter((t) => t.category !== current.category && t.popular);
  const rest = sameMedia.filter((t) => t.category !== current.category && !t.popular);

  return [...sameCategory, ...popular, ...rest].slice(0, MORE_TOOLS_LIMIT);
}

export function ToolPage({ title, description, currentId, children }: ToolPageProps) {
  const meta = currentId ? getToolMeta(currentId) : null;
  const media = meta ? MEDIA_INFO[meta.media] : null;
  const category = meta ? categories.find((c) => c.id === meta.category) : null;

  return (
    <div className="tool-page">
      {media && (
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li>
              <Link to="/">Home</Link>
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
        {meta && (
          <MediaTile media={meta.media} size="lg">
            {meta.icon}
          </MediaTile>
        )}
        <div className="tool-header-text">
          <h1 className="tool-title">{title}</h1>
          <p className="tool-desc">{description}</p>
        </div>
        <div className="tool-header-badge">
          <Badge tone="success" icon={<ShieldCheck />}>
            Runs on this device
          </Badge>
        </div>
      </header>

      <div className="tool-content">{children}</div>

      <section className="more-tools-section" aria-labelledby="more-tools-title">
        <div className="section-head">
          <h2 className="section-title" id="more-tools-title">
            {category ? `More ${media?.label.toLowerCase()} tools` : 'More tools'}
          </h2>
          {media && (
            <Link to={media.path} className="section-link">
              All {media.title.toLowerCase()}
              <ChevronRight aria-hidden="true" />
            </Link>
          )}
        </div>
        <ToolGrid tools={moreTools(currentId)} currentId={currentId} />
      </section>
    </div>
  );
}
