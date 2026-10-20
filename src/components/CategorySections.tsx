import { categories, toolsByCategory, type Media } from '../tools/registry';
import { ToolGrid } from './ToolGrid';

export interface CategorySectionsProps {
  media: Media;
}

export function CategorySections({ media }: CategorySectionsProps) {
  return (
    <>
      {categories
        .filter((c) => c.media === media)
        .map((category) => (
          <section key={category.id} className="category-section" id={category.id}>
            <h3 className="category-title">{category.title}</h3>
            <p className="category-desc">{category.description}</p>
            <ToolGrid tools={toolsByCategory(category.id)} />
          </section>
        ))}
    </>
  );
}
