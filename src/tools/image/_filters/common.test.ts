import { expect, it } from 'vitest';
import { getFilterExportScale } from './common';

it('keeps border and filter sizes proportional to the bounded preview in either orientation', () => {
  expect(getFilterExportScale({ width: 600, height: 800 }, false)).toBe(1);
  expect(getFilterExportScale({ width: 1200, height: 3000 }, false)).toBe(2.5);
  expect(getFilterExportScale({ width: 3000, height: 1200 }, false)).toBe(2.5);
  expect(getFilterExportScale({ width: 480, height: 1200 }, true)).toBe(1);
});
