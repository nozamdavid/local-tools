import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { localizeToolMeta, TOOL_METAS, type ToolMeta } from '../tools/registry';
import { MediaTile } from './Controls';
import { getToolIcon } from '../design/tool-icons';
import { useI18n } from '../lib/i18n';

export interface ToolGridProps {
  tools?: ToolMeta[];
  currentId?: string;
  /** compact: single-line rows without descriptions */
  variant?: 'default' | 'compact';
  /** Called when a card is chosen, before navigation */
  onSelect?: (tool: ToolMeta) => void;
}

export function ToolCard({
  tool,
  variant = 'default',
  onSelect,
}: {
  tool: ToolMeta;
  variant?: ToolGridProps['variant'];
  onSelect?: ToolGridProps['onSelect'];
}) {
  useI18n();
  const localizedTool = localizeToolMeta(tool);
  const Icon = getToolIcon(tool);

  return (
    <Link to={tool.path} className={`tool-card tool-card-${variant}`} onClick={() => onSelect?.(localizedTool)}>
      <MediaTile media={tool.media} size={variant === 'compact' ? 'sm' : 'md'}>
        <Icon aria-hidden="true" />
      </MediaTile>
      <span className="tool-card-body">
        <span className="tool-card-title">{localizedTool.title}</span>
        {variant === 'default' && <span className="tool-card-desc">{localizedTool.description}</span>}
      </span>
      <ChevronRight className="tool-card-arrow" aria-hidden="true" />
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
