import { describe, it, expect } from 'vitest';
import { formatBytes, formatDuration, replaceExt, withSuffix } from './format';

describe('formatBytes', () => {
  it('handles 0', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('handles negative numbers', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(-1024)).toBe('0 B');
  });

  it('handles NaN and non-finite values', () => {
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(Infinity)).toBe('0 B');
    expect(formatBytes(-Infinity)).toBe('0 B');
  });

  it('handles decimals formatting', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1536, 0)).toBe('2 KB');
    expect(formatBytes(1500, 2)).toBe('1.46 KB');
    expect(formatBytes(1024, -1)).toBe('1 KB');
  });

  it('handles KB, MB, GB, TB and clamping beyond TB', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1 TB');
    // Clamping to TB for petabyte-scale inputs
    expect(formatBytes(1024 * 1024 * 1024 * 1024 * 1024)).toBe('1024 TB');
    expect(formatBytes(2.5 * 1024 * 1024 * 1024 * 1024 * 1024)).toBe('2560 TB');
  });
});

describe('formatDuration', () => {
  it('handles 0', () => {
    expect(formatDuration(0)).toBe('0:00.0');
  });

  it('handles durations under 1 second', () => {
    expect(formatDuration(0.5)).toBe('0:00.5');
    expect(formatDuration(0.04)).toBe('0:00.0');
  });

  it('handles seconds', () => {
    expect(formatDuration(5)).toBe('0:05.0');
    expect(formatDuration(42.3)).toBe('0:42.3');
    expect(formatDuration(59.9)).toBe('0:59.9');
  });

  it('handles minute boundaries', () => {
    expect(formatDuration(60)).toBe('1:00.0');
    expect(formatDuration(65.5)).toBe('1:05.5');
    expect(formatDuration(599.9)).toBe('9:59.9');
    expect(formatDuration(600)).toBe('10:00.0');
  });

  it('handles hour boundaries', () => {
    expect(formatDuration(3600)).toBe('1:00:00.0');
    expect(formatDuration(3665.2)).toBe('1:01:05.2');
    expect(formatDuration(7322.8)).toBe('2:02:02.8');
  });

  it('handles invalid and negative durations', () => {
    expect(formatDuration(-1)).toBe('0:00.0');
    expect(formatDuration(-3600)).toBe('0:00.0');
    expect(formatDuration(NaN)).toBe('0:00.0');
    expect(formatDuration(Infinity)).toBe('0:00.0');
  });
});

describe('replaceExt', () => {
  it('handles normal filenames with extension', () => {
    expect(replaceExt('photo.png', 'jpg')).toBe('photo.jpg');
    expect(replaceExt('my.file.backup.txt', 'md')).toBe('my.file.backup.md');
  });

  it('handles filenames with no extension', () => {
    expect(replaceExt('README', 'txt')).toBe('README.txt');
    expect(replaceExt('archive', 'zip')).toBe('archive.zip');
  });

  it('handles dotfiles', () => {
    expect(replaceExt('.gitignore', 'bak')).toBe('.gitignore.bak');
    expect(replaceExt('.env', 'local')).toBe('.env.local');
  });

  it('handles leading dot in ext parameter', () => {
    expect(replaceExt('document.docx', '.pdf')).toBe('document.pdf');
    expect(replaceExt('file', '.tar.gz')).toBe('file.tar.gz');
  });
});

describe('withSuffix', () => {
  it('handles same extension preservation', () => {
    expect(withSuffix('image.jpg', '-thumb')).toBe('image-thumb.jpg');
    expect(withSuffix('data.backup.csv', '_processed')).toBe('data.backup_processed.csv');
  });

  it('handles overriding the extension', () => {
    expect(withSuffix('image.jpg', '-thumb', 'png')).toBe('image-thumb.png');
    expect(withSuffix('document.pdf', '_preview', '.webp')).toBe('document_preview.webp');
  });

  it('handles filenames with no extension', () => {
    expect(withSuffix('dockerfile', '-prod')).toBe('dockerfile-prod');
    expect(withSuffix('manifest', '-v2', 'json')).toBe('manifest-v2.json');
  });

  it('handles dotfiles', () => {
    expect(withSuffix('.gitignore', '-backup')).toBe('.gitignore-backup');
    expect(withSuffix('.env', '-test', 'example')).toBe('.env-test.example');
  });
});
