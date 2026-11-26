import { categories, localizeCategory, localizeToolMeta, TOOL_METAS, type ToolMeta } from '../tools/registry';
import { getMediaInfo, MEDIA_INFO } from '../design/media';
import { getLocale, type Locale } from './i18n';

const SYNONYMS: Record<string, string> = {
  jpeg: 'jpg',
  photo: 'image',
  picture: 'image',
  pic: 'image',
  img: 'image',
  movie: 'video',
  clip: 'video',
  shrink: 'compress',
  reduce: 'compress',
  smaller: 'compress',
  small: 'compress',
  join: 'merge',
  combine: 'merge',
  cut: 'trim',
  scale: 'resize',
  turn: 'convert',
  sound: 'audio',
  doc: 'word',
  docx: 'word',
  xls: 'excel',
  xlsx: 'excel',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  lock: 'protect',
  into: 'to',
  x: 'twitter',
};

const FILLER_WORDS = new Set([
  'a',
  'an',
  'the',
  'please',
  'can',
  'could',
  'i',
  'me',
  'my',
  'want',
  'need',
  'some',
  'file',
  'files',
  'tool',
  'tools',
  'make',
]);

const MAX_QUERY_LENGTH = 120;
const MAX_QUERY_TOKENS = 10;
const MAX_TOKEN_LENGTH = 32;
const MIN_PREFIX_LENGTH = 3;
const MIN_FUZZY_LENGTH = 4;

const TITLE_ALIASES: Record<string, string[]> = {
  'video-editor': ['Edit video'],
  'img-photo-editor': ['Edit image'],
  'remove-audio': ['Remove audio from video'],
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[↔→]/g, ' to ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => SYNONYMS[token] ?? token);
}

interface Indexed {
  tool: ToolMeta;
  titleVariants: string[][];
  body: string[];
}

const MEDIA_WORDS: Record<ToolMeta['media'], string> = {
  file: 'file files data',
  video: 'video videos audio',
  image: 'image images',
  pdf: 'pdf document',
  '3d': '3d model mesh cad geometry stl obj ply 3mf step iges brep',
};

const indexes = new Map<Locale, Indexed[]>();

function indexForLocale(locale: Locale): Indexed[] {
  const cached = indexes.get(locale);
  if (cached) return cached;

  const index = TOOL_METAS.map((tool) => {
    const category = categories.find((item) => item.id === tool.category);
    const localizedTool = localizeToolMeta(tool);
    const localizedCategory = category ? localizeCategory(category) : null;
    const media = MEDIA_INFO[tool.media];
    const localizedMedia = getMediaInfo(tool.media);
    const titleVariants = [tokens(tool.title), tokens(localizedTool.title), ...(TITLE_ALIASES[tool.id] ?? []).map(tokens)];
    const body = tokens(
      [
        tool.description,
        localizedTool.description,
        tool.tags.join(' '),
        category?.title ?? '',
        localizedCategory?.title ?? '',
        category?.description ?? '',
        localizedCategory?.description ?? '',
        media.label,
        media.title,
        localizedMedia.label,
        localizedMedia.title,
        MEDIA_WORDS[tool.media],
        tool.slug.replace(/-/g, ' '),
      ].join(' '),
    );
    return { tool, titleVariants, body };
  });

  indexes.set(locale, index);
  return index;
}

const FILE_FORMATS = new Set([
  'pdf',
  'word',
  'excel',
  'powerpoint',
  'jpg',
  'png',
  'webp',
  'heic',
  'svg',
  'gif',
  'bmp',
  'avif',
  'jxl',
  'ico',
  'mp3',
  'aac',
  'wav',
  'ogg',
  'flac',
  'mp4',
  'webm',
  'mov',
  'mkv',
  'avi',
  'csv',
  'json',
  'txt',
  'html',
  'markdown',
  'image',
  'stl',
  'obj',
  'ply',
  '3mf',
  'step',
  'iges',
  'brep',
]);

interface Direction {
  source: string;
  target: string;
}

function queryDirection(queryTokens: string[]): Direction | null {
  for (let i = 1; i < queryTokens.length - 1; i += 1) {
    const connector = queryTokens[i];
    if (connector !== 'to' && connector !== 'from') continue;

    const left = queryTokens[i - 1];
    const right = queryTokens[i + 1];
    if (!FILE_FORMATS.has(left) || !FILE_FORMATS.has(right)) continue;

    return connector === 'from' ? { source: right, target: left } : { source: left, target: right };
  }
  return null;
}

function hasSequence(tokensToCheck: string[], sequence: string[]): boolean {
  return tokensToCheck.some((_, index) => sequence.every((token, offset) => tokensToCheck[index + offset] === token));
}

function directionScore(entry: Indexed, direction: Direction | null): number | null {
  if (!direction) return 0;
  const direct = [direction.source, 'to', direction.target];
  const reverse = [direction.target, 'to', direction.source];
  const hasDirect = entry.titleVariants.some((title) => hasSequence(title, direct));
  const hasReverse = entry.titleVariants.some((title) => hasSequence(title, reverse));
  if (hasReverse && !hasDirect) return null;
  return hasDirect ? 36 : 0;
}

function isOneEditAway(query: string, word: string): boolean {
  if (query === word || Math.min(query.length, word.length) < MIN_FUZZY_LENGTH || Math.abs(query.length - word.length) > 1) return false;

  if (query.length === word.length) {
    const mismatches: number[] = [];
    for (let i = 0; i < query.length; i += 1) {
      if (query[i] !== word[i]) mismatches.push(i);
      if (mismatches.length > 2) return false;
    }
    if (mismatches.length === 1) return true;
    if (mismatches.length !== 2) return false;
    const [first, second] = mismatches;
    return second === first + 1 && query[first] === word[second] && query[second] === word[first];
  }

  const shorter = query.length < word.length ? query : word;
  const longer = query.length < word.length ? word : query;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      longIndex += 1;
    }
  }
  return true;
}

function scoreToken(entry: Indexed, token: string): number {
  if (entry.titleVariants.some((title) => title.includes(token))) return 12;
  if (entry.body.includes(token)) return 10;
  if (token.length >= MIN_PREFIX_LENGTH && entry.titleVariants.some((title) => title.some((word) => word.startsWith(token)))) return 8;
  if (token.length >= MIN_PREFIX_LENGTH && entry.body.some((word) => word.startsWith(token))) return 5;
  if (entry.titleVariants.some((title) => title.some((word) => isOneEditAway(token, word)))) return 4;
  if (entry.body.some((word) => isOneEditAway(token, word))) return 1;
  return 0;
}

function queryTokens(query: string): string[] | null {
  if (query.length > MAX_QUERY_LENGTH) return null;
  const words = tokens(query);
  if (words.length > MAX_QUERY_TOKENS || words.some((word) => word.length > MAX_TOKEN_LENGTH)) return null;

  if (words.includes('password') && (words.includes('add') || words.includes('set') || words.includes('create'))) {
    for (const action of ['add', 'set', 'create']) {
      const index = words.indexOf(action);
      if (index !== -1) words[index] = 'protect';
    }
  }
  return words;
}

/** Ranks tools for a free-text query using local metadata and the current interface locale. */
export function searchTools(query: string, limit = 40): ToolMeta[] {
  const normalizedQuery = queryTokens(query);
  if (!normalizedQuery || !Number.isFinite(limit) || limit <= 0) return [];

  const locale = getLocale();
  const index = indexForLocale(locale);
  const direction = queryDirection(normalizedQuery);
  const meaningfulWords = normalizedQuery.filter((word) => !FILLER_WORDS.has(word) && word !== 'to' && word !== 'from');
  const searchableWords = [...new Set([...meaningfulWords, ...(normalizedQuery.includes('from') && !direction ? ['from'] : [])])];
  if (searchableWords.length === 0) return [];

  const titleQuery = direction ? [direction.source, 'to', direction.target] : normalizedQuery.filter((word) => !FILLER_WORDS.has(word));
  const results: { tool: ToolMeta; score: number }[] = [];
  for (const entry of index) {
    const directionalScore = directionScore(entry, direction);
    if (directionalScore === null) continue;

    let score = 0;
    let matchedAll = true;
    for (const word of searchableWords) {
      const tokenScore = scoreToken(entry, word);
      if (tokenScore === 0) {
        matchedAll = false;
        break;
      }
      score += tokenScore;
    }
    if (!matchedAll) continue;

    if (entry.titleVariants.some((title) => title.length === titleQuery.length && title.every((word, i) => word === titleQuery[i]))) {
      score += 28;
    }
    score += directionalScore;
    if (entry.tool.popular) score += 0.25;
    results.push({ tool: entry.tool, score });
  }

  return results
    .sort((a, b) => b.score - a.score || a.tool.title.length - b.tool.title.length)
    .slice(0, Math.floor(limit))
    .map((result) => localizeToolMeta(result.tool));
}
