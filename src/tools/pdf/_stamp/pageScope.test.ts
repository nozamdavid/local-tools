import { describe, expect, it } from 'vitest';
import { getTargetPagesResult } from './pageScope';

describe('page range drafts', () => {
  it('returns an inline error for unfinished or invalid ranges', () => {
    for (const rangeStr of ['10-1', '20', '1-x']) {
      const result = getTargetPagesResult('range', 12, { rangeStr });
      expect(result.pages).toEqual([]);
      expect(result.error).toBeTruthy();
    }
  });

  it('recovers to the correct sorted targets when the range is completed', () => {
    expect(getTargetPagesResult('range', 12, { rangeStr: '10-12, 2, 10', excludeFirst: true })).toEqual({
      pages: [2, 10, 11, 12],
      error: null,
    });
  });
});
