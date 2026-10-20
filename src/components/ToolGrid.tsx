import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { TOOL_METAS, type ToolMeta } from '../tools/registry';
import { MediaTile } from './Controls';

export interface ToolGridProps {
  tools?: ToolMeta[];
  currentId?: string;
  /** compact: single-line rows without descriptions */
  variant?: 'default' | 'compact';
  /** Called when a card is chosen, before navigation */
  onSelect?: (tool: ToolMeta) => void;
}

export function ToolCard({ tool, variant = 'default', onSelect }: { tool: ToolMeta; variant?: ToolGridProps['variant']; onSelect?: ToolGridProps['onSelect'] }) {
  return (
    <Link to={tool.path} className={`tool-card tool-card-${variant}`} onClick={() => onSelect?.(tool)}>
      <MediaTile media={tool.media} size={variant === 'compact' ? 'sm' : 'md'}>
        {tool.icon}
      </MediaTile>
      <span className="tool-card-body">
        <span className="tool-card-title">{tool.title}</span>
        {variant === 'default' && <span className="tool-card-desc">{tool.description}</span>}
      </span>
      <ArrowUpRight className="tool-card-arrow" aria-hidden="true" />
    </Link>
  );
}

export function ToolGrid({ tools = TOOL_METAS, currentId, variant = 'default', onSelect }: ToolGridProps) {
  const displayTools = currentId ? tools.filter((t) => t.id !== currentId) : tools;

  return (
    <div className={`tool-grid tool-grid-${variant}`}>
      {displayTools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} variant={variant} onSelect={onSelect} />
      ))}
    </div>
  );
}
