import { categories, TOOL_METAS, type ToolMeta } from '../tools/registry';

const SYNONYMS: Record<string, string> = {
  jpeg: 'jpg',
  '→': 'to',
  '↔': 'to',
  photo: 'image',
  picture: 'image',
  pic: 'image',
  img: 'image',
  movie: 'video',
  clip: 'video',
  shrink: 'compress',
  reduce: 'compress',
  smaller: 'compress',
  join: 'merge',
  combine: 'merge',
  cut: 'trim',
  scale: 'resize',
  doc: 'word',
  docx: 'word',
  xls: 'excel',
  xlsx: 'excel',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  password: 'protect',
  x: 'twitter',
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[↔→/&,+()]/g, ' ');
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => SYNONYMS[t] ?? t);
}

interface Indexed {
  tool: ToolMeta;
  title: string[];
  body: string;
}

const MEDIA_WORDS: Record<ToolMeta['media'], string> = {
  file: 'file files data',
  video: 'video videos audio',
  image: 'image images',
  pdf: 'pdf document',
  '3d': '3d model mesh cad geometry stl obj ply 3mf step iges brep',
};

const INDEX: Indexed[] = TOOL_METAS.map((tool) => {
  const category = categories.find((c) => c.id === tool.category);
  return {
    tool,
    title: tokens(tool.title),
    body: tokens(
      [tool.description, tool.tags.join(' '), category?.title ?? '', MEDIA_WORDS[tool.media], tool.slug.replace(/-/g, ' ')].join(' '),
    ).join(' '),
  };
});

function scoreToken(entry: Indexed, token: string): number {
  let best = 0;
  for (const word of entry.title) {
    if (word === token) best = Math.max(best, 10);
    else if (word.startsWith(token)) best = Math.max(best, 7);
    else if (token.length > 2 && word.includes(token)) best = Math.max(best, 4);
  }
  if (best) return best;
  if (new RegExp(`(^|\\s)${escapeRegExp(token)}`).test(entry.body)) return 3;
  if (token.length > 2 && entry.body.includes(token)) return 1;
  return 0;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Ranks tools for a free-text query. Every query word has to match somewhere. */
export function searchTools(query: string, limit = 40): ToolMeta[] {
  const phrase = tokens(query).join(' ');
  const words = tokens(query).filter((w) => w !== 'to');
  if (words.length === 0) return [];

  const results: { tool: ToolMeta; score: number }[] = [];
  for (const entry of INDEX) {
    let score = 0;
    let matchedAll = true;
    for (const word of words) {
      const s = scoreToken(entry, word);
      if (s === 0) {
        matchedAll = false;
        break;
      }
      score += s;
    }
    if (!matchedAll) continue;
    // Word order matters for converters: "word to pdf" should beat "pdf to word".
    if (entry.title.join(' ').includes(phrase)) score += 8;
    if (entry.tool.popular) score += 1.5;
    results.push({ tool: entry.tool, score });
  }

  return results
    .sort((a, b) => b.score - a.score || a.tool.title.length - b.tool.title.length)
    .slice(0, limit)
    .map((r) => r.tool);
}
