import { parseRanges, expandRange } from '../_pages/pdfPages';

export type PageScopeMode = 'all' | 'range' | 'selected';

export function parsePageRange(rangeStr: string, totalPages: number): number[] {
  if (!rangeStr.trim()) return [];
  const ranges = parseRanges(rangeStr, totalPages);
  const pages = ranges.flatMap(expandRange);
  // Deduplicate and sort
  return Array.from(new Set(pages)).sort((a, b) => a - b);
}

export function getTargetPages(
  mode: PageScopeMode,
  totalPages: number,
  options?: {
    rangeStr?: string;
    selectedPages?: Set<number>; // 1-based or 0-based, let's standardize on 1-based
    excludeFirst?: boolean;
  },
): number[] {
  let list: number[] = [];
  if (mode === 'all') {
    list = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else if (mode === 'selected') {
    if (options?.selectedPages) {
      list = Array.from(options.selectedPages).sort((a, b) => a - b);
    }
  } else if (mode === 'range') {
    if (options?.rangeStr) {
      list = parsePageRange(options.rangeStr, totalPages);
    }
  }

  if (options?.excludeFirst) {
    list = list.filter((p) => p !== 1);
  }

  return list;
}
