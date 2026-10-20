import { Link } from 'react-router-dom';
import { TOOL_METAS, type ToolMeta } from '../tools/registry';

export interface ToolGridProps {
  tools?: ToolMeta[];
  currentId?: string;
}

export function ToolGrid({ tools = TOOL_METAS, currentId }: ToolGridProps) {
  const displayTools = currentId ? tools.filter((t) => t.id !== currentId) : tools;

  return (
    <div className="tool-grid">
      {displayTools.map((tool) => (
        <Link key={tool.id} to={tool.path} className="tool-card">
          <div className="tool-card-icon">{tool.icon}</div>
          <div className="tool-card-title">{tool.title}</div>
          <div className="tool-card-desc">{tool.description}</div>
        </Link>
      ))}
    </div>
  );
}
