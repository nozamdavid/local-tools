import { categories, toolsByCategory, type Media, type ToolMeta } from '../tools/registry';
import { ToolGrid } from './ToolGrid';

export interface CategorySectionsProps {
  media: Media;
  /** When set, only these tools are shown and empty categories are hidden */
  filter?: (tool: ToolMeta) => boolean;
}

export function CategorySections({ media, filter }: CategorySectionsProps) {
  return (
    <>
      {categories
        .filter((c) => c.media === media)
        .map((category) => {
          const list = toolsByCategory(category.id).filter((t) => !filter || filter(t));
          if (list.length === 0) return null;
          return (
            <section key={category.id} className="category-section" id={category.id} aria-labelledby={`${category.id}-title`}>
              <div className="category-head">
                <h2 className="category-title" id={`${category.id}-title`}>
                  {category.title}
                  <span className="category-count">{list.length}</span>
                </h2>
                <p className="category-desc">{category.description}</p>
              </div>
              <ToolGrid tools={list} />
            </section>
          );
        })}
    </>
  );
}
