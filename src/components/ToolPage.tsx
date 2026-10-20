import React from 'react';
import { ToolGrid } from './ToolGrid';
import { TOOL_METAS, getToolMeta } from '../tools/registry';

export interface ToolPageProps {
  title: string;
  description: string;
  currentId?: string;
  children: React.ReactNode;
}

const MORE_TOOLS_LIMIT = 12;

function moreTools(currentId?: string) {
  if (!currentId) return TOOL_METAS.slice(0, MORE_TOOLS_LIMIT);

  const current = getToolMeta(currentId);
  const sameMedia = TOOL_METAS.filter((t) => t.media === current.media && t.id !== currentId);
  const sameCategory = sameMedia.filter((t) => t.category === current.category);
  const rest = sameMedia.filter((t) => t.category !== current.category);

  return [...sameCategory, ...rest].slice(0, MORE_TOOLS_LIMIT);
}

export function ToolPage({ title, description, currentId, children }: ToolPageProps) {
  return (
    <div className="tool-page">
      <div className="tool-header">
        <h1 className="tool-title">{title}</h1>
        <p className="tool-desc">{description}</p>
      </div>

      <div className="tool-content">{children}</div>

      <div className="more-tools-section">
        <h2 className="more-tools-title">More tools</h2>
        <ToolGrid tools={moreTools(currentId)} currentId={currentId} />
      </div>
    </div>
  );
}
