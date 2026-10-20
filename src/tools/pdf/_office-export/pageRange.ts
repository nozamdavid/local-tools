/**
 * Parses user-supplied page ranges such as "1-3, 5, 8-10" or "all".
 * Returns an array of 1-based unique page numbers in ascending order.
 */
export function parsePageRange(spec: string, maxPages: number): number[] {
  const trimmed = spec.trim().toLowerCase();
  if (!trimmed || trimmed === 'all') {
    return Array.from({ length: maxPages }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  const parts = trimmed.split(',');

  for (const part of parts) {
    const item = part.trim();
    if (!item) continue;

    if (item.includes('-')) {
      const [startStr, endStr] = item.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!Number.isNaN(start) && !Number.isNaN(end)) {
        const min = Math.max(1, Math.min(start, end));
        const max = Math.min(maxPages, Math.max(start, end));
        for (let p = min; p <= max; p++) {
          pages.add(p);
        }
      }
    } else {
      const p = parseInt(item, 10);
      if (!Number.isNaN(p) && p >= 1 && p <= maxPages) {
        pages.add(p);
      }
    }
  }

  const result = Array.from(pages).sort((a, b) => a - b);
  return result.length > 0 ? result : Array.from({ length: maxPages }, (_, i) => i + 1);
}
