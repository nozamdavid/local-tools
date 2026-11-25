import { categories, localizeCategory, toolsByCategory, type Media, type ToolMeta } from '../tools/registry';
import { ToolGrid } from './ToolGrid';
import { useI18n } from '../lib/i18n';

export interface CategorySectionsProps {
  media: Media;
  /** When set, only these tools are shown and empty categories are hidden */
  filter?: (tool: ToolMeta) => boolean;
}

export function CategorySections({ media, filter }: CategorySectionsProps) {
  useI18n();
  return (
    <>
      {categories
        .filter((c) => c.media === media)
        .map((rawCategory) => {
          const category = localizeCategory(rawCategory);
          const list = toolsByCategory(category.id).filter((t) => !filter || filter(t));
          if (list.length === 0) return null;
          return (
            <section key={category.id} className="category-section" id={category.id} aria-labelledby={`${category.id}-title`}>
              <div className="category-head">
                <h2 className="category-title" id={`${category.id}-title`}>
                  {category.title}
                  <span className="category-count">{list.length}</span>
                </h2>
              </div>
              <ToolGrid tools={list} />
            </section>
          );
        })}
    </>
  );
}
