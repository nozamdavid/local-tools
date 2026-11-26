import { expect, it } from 'vitest';
import { computeBatchRename, sanitizeFileName } from './rename';

it('applies literal replacements and preserves a name already reserved for another file', () => {
  const items = ['photo.JPG', 'photo.jpg', '$&_2.jpg'].map((name, id) => ({ id: String(id), name, size: 1 }));
  const results = computeBatchRename(items, {
    mode: 'original',
    baseName: '',
    enableNumbering: false,
    numberStart: 1,
    numberPadding: 1,
    numberPosition: 'suffix',
    separator: '_',
    preserveExtension: true,
    caseTransform: 'none',
    findText: 'photo',
    replaceText: '$&',
    autoResolveCollisions: true,
  });
  expect(results.map(({ newName }) => newName)).toEqual(['$&.JPG', '$&_3.jpg', '$&_2.jpg']);
});

it('removes alternating trailing spaces and dots', () => {
  expect(sanitizeFileName('notes . .')).toEqual({ name: 'notes', changed: true });
});
