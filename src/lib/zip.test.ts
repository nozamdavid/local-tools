import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { zipFiles } from './zip';

describe('zipFiles', () => {
  it('handles duplicate filenames by appending (2), (3)', async () => {
    const files = [
      { name: 'a.png', blob: new Blob(['first']) },
      { name: 'a.png', blob: new Blob(['second']) },
      { name: 'a.png', blob: new Blob(['third']) },
    ];

    const zipBlob = await zipFiles(files);
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());

    const entryNames = Object.keys(zip.files);
    expect(entryNames).toEqual(['a.png', 'a (2).png', 'a (3).png']);
    expect(entryNames.length).toBe(3);

    expect(await zip.file('a.png')?.async('text')).toBe('first');
    expect(await zip.file('a (2).png')?.async('text')).toBe('second');
    expect(await zip.file('a (3).png')?.async('text')).toBe('third');
  });

  it('handles extensionless duplicate filenames', async () => {
    const files = [
      { name: 'README', blob: new Blob(['doc 1']) },
      { name: 'README', blob: new Blob(['doc 2']) },
      { name: 'README', blob: new Blob(['doc 3']) },
    ];

    const zipBlob = await zipFiles(files);
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());

    const entryNames = Object.keys(zip.files);
    expect(entryNames).toEqual(['README', 'README (2)', 'README (3)']);
    expect(entryNames.length).toBe(3);

    expect(await zip.file('README')?.async('text')).toBe('doc 1');
    expect(await zip.file('README (2)')?.async('text')).toBe('doc 2');
    expect(await zip.file('README (3)')?.async('text')).toBe('doc 3');
  });

  it('preserves case-sensitive distinct names without deduplicating', async () => {
    const files = [
      { name: 'File.txt', blob: new Blob(['uppercase']) },
      { name: 'file.txt', blob: new Blob(['lowercase']) },
    ];

    const zipBlob = await zipFiles(files);
    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());

    const entryNames = Object.keys(zip.files);
    expect(entryNames).toContain('File.txt');
    expect(entryNames).toContain('file.txt');
    expect(entryNames.length).toBe(2);

    expect(await zip.file('File.txt')?.async('text')).toBe('uppercase');
    expect(await zip.file('file.txt')?.async('text')).toBe('lowercase');
  });

  it('adds duplicate suffixes to basenames inside dotted folders', async () => {
    const blob = await zipFiles([
      { name: 'release.1/README', blob: new Blob(['first']) },
      { name: 'release.1/README', blob: new Blob(['second']) },
      { name: 'release.1/.config', blob: new Blob(['third']) },
      { name: 'release.1/.config', blob: new Blob(['fourth']) },
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual([
      'release.1/',
      'release.1/README',
      'release.1/README (2)',
      'release.1/.config',
      'release.1/.config (2)',
    ]);
    await expect(zip.file('release.1/README (2)')?.async('text')).resolves.toBe('second');
    await expect(zip.file('release.1/.config (2)')?.async('text')).resolves.toBe('fourth');
  });
});
