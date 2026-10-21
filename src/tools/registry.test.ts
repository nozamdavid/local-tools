import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_METAS, categories, type Media, type CategoryId } from './registry';

const MEDIA_VALUES = new Set<Media>(['video', 'image', 'pdf', 'file', '3d']);
const CATEGORY_IDS = new Set<CategoryId>(categories.map((c) => c.id));
const TAG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('Tool Registry', () => {
  it('resolves every TOOL_METAS entry to an existing Tool.tsx on disk using fs', () => {
    for (const tool of TOOL_METAS) {
      const toolFile =
        tool.media === 'file' || tool.media === 'video'
          ? path.resolve(__dirname, tool.slug, 'Tool.tsx')
          : path.resolve(__dirname, tool.media, tool.slug, 'Tool.tsx');

      expect(fs.existsSync(toolFile), `Expected Tool.tsx for "${tool.id}" at ${toolFile} to exist on disk`).toBe(true);
    }
  });

  it('ensures ids and paths are unique', () => {
    const ids = TOOL_METAS.map((t) => t.id);
    const paths = TOOL_METAS.map((t) => t.path);

    expect(new Set(ids).size, 'Expected all tool ids to be unique').toBe(TOOL_METAS.length);
    expect(new Set(paths).size, 'Expected all tool paths to be unique').toBe(TOOL_METAS.length);
  });

  it('ensures every tool has between 3 and 8 tags', () => {
    for (const tool of TOOL_METAS) {
      expect(tool.tags.length, `Tool "${tool.id}" has ${tool.tags.length} tags, expected between 3 and 8`).toBeGreaterThanOrEqual(3);
      expect(tool.tags.length, `Tool "${tool.id}" has ${tool.tags.length} tags, expected between 3 and 8`).toBeLessThanOrEqual(8);
    }
  });

  it('ensures every tag matches /^[a-z0-9]+(-[a-z0-9]+)*$/', () => {
    for (const tool of TOOL_METAS) {
      for (const tag of tool.tags) {
        expect(TAG_REGEX.test(tag), `Tool "${tool.id}" has invalid tag format "${tag}"`).toBe(true);
      }
    }
  });

  it('ensures no tag equals a Media value or a CategoryId', () => {
    for (const tool of TOOL_METAS) {
      for (const tag of tool.tags) {
        expect(MEDIA_VALUES.has(tag as Media), `Tool "${tool.id}" has tag "${tag}" which equals a Media value`).toBe(false);
        expect(CATEGORY_IDS.has(tag as CategoryId), `Tool "${tool.id}" has tag "${tag}" which equals a CategoryId`).toBe(false);
      }
    }
  });

  it('ensures tool category exists in categories and its media matches', () => {
    const catMap = new Map(categories.map((c) => [c.id, c]));

    for (const tool of TOOL_METAS) {
      const cat = catMap.get(tool.category);
      expect(cat, `Category "${tool.category}" for tool "${tool.id}" must exist`).toBeDefined();
      expect(
        cat?.media,
        `Category "${tool.category}" media "${cat?.media}" must match tool media "${tool.media}" for tool "${tool.id}"`,
      ).toBe(tool.media);
    }
  });

  it('ensures non-empty title, description, icon, and path', () => {
    for (const tool of TOOL_METAS) {
      expect(tool.title.trim().length, `Tool "${tool.id}" has empty title`).toBeGreaterThan(0);
      expect(tool.description.trim().length, `Tool "${tool.id}" has empty description`).toBeGreaterThan(0);
      expect(tool.icon.trim().length, `Tool "${tool.id}" has empty icon`).toBeGreaterThan(0);
      expect(tool.path.trim().length, `Tool "${tool.id}" has empty path`).toBeGreaterThan(0);
    }
  });
});
