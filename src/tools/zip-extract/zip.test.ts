import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { extractSelectedZipEntries, inspectZipBytes, ZIP_EXTRACT_LIMITS } from './zip';

interface TestEntry {
  name: string;
  bytes: Uint8Array;
  compression?: 'STORE' | 'DEFLATE';
}

async function createZip(entries: TestEntry[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.name, entry.bytes, { binary: true, compression: entry.compression });
  }
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

function bytesFromText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function findSignature(bytes: Uint8Array, signature: number, start = 0): number {
  for (let offset = start; offset + 4 <= bytes.length; offset++) {
    if (readU32(bytes, offset) === signature) return offset;
  }
  return -1;
}

function replaceAscii(bytes: Uint8Array, from: string, to: string): number {
  const oldBytes = bytesFromText(from);
  const newBytes = bytesFromText(to);
  if (oldBytes.length !== newBytes.length) throw new Error('Replacement names must have equal length.');
  let replacements = 0;
  for (let offset = 0; offset <= bytes.length - oldBytes.length; offset++) {
    if (!oldBytes.every((byte, index) => bytes[offset + index] === byte)) continue;
    bytes.set(newBytes, offset);
    replacements++;
    offset += oldBytes.length - 1;
  }
  return replacements;
}

function setUncompressedSize(bytes: Uint8Array, index: number, size: number): void {
  let offset = findSignature(bytes, 0x02014b50);
  for (let current = 0; current < index; current++) {
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  writeU32(bytes, offset + 24, size);
  writeU32(bytes, readU32(bytes, offset + 42) + 22, size);
}

describe('ZIP extractor helpers', () => {
  it('decodes legacy CP437 names without replacement characters', async () => {
    const bytes = await createZip([{ name: 'cafx.txt', bytes: bytesFromText('coffee') }]);
    const local = findSignature(bytes, 0x04034b50);
    const central = findSignature(bytes, 0x02014b50);
    bytes[local + 30 + 3] = 0x82;
    bytes[central + 46 + 3] = 0x82;
    expect(inspectZipBytes(bytes).entries[0].name).toBe('café.txt');
  });

  it('honors valid Unicode Path extra fields for legacy filenames', async () => {
    const zip = new JSZip();
    zip.file('文.txt', 'text');
    const bytes = await zip.generateAsync({
      type: 'uint8array',
      encodeFileName: (name) => Array.from(name, (char) => (char.charCodeAt(0) > 127 ? '?' : char)).join(''),
    });
    expect(inspectZipBytes(bytes).entries[0].name).toBe('文.txt');
  });

  it.each([false, true])('disambiguates files that conflict with parent directories (reverse=%s)', async (reverse) => {
    const entries = [
      { name: 'docs', bytes: bytesFromText('a file') },
      { name: 'docs/readme.txt', bytes: bytesFromText('nested file') },
    ];
    if (reverse) entries.reverse();
    const zip = new JSZip();
    for (const entry of entries) zip.file(entry.name, entry.bytes, { createFolders: false });
    const archive = inspectZipBytes(await zip.generateAsync({ type: 'uint8array' }));
    expect(archive.entries.map((entry) => entry.name)).toEqual(reverse ? ['docs/readme.txt', 'docs (2)'] : ['docs', 'docs (2)/readme.txt']);
    const extracted = await extractSelectedZipEntries(
      archive,
      archive.entries.map((entry) => entry.id),
    );
    expect(await Promise.all(extracted.map((entry) => entry.blob.text()))).toEqual(
      entries.map((entry) => new TextDecoder().decode(entry.bytes)),
    );
  });

  it('preserves selected file bytes and omits directory entries', async () => {
    const imageBytes = new Uint8Array([0, 1, 128, 255, 10]);
    const zipBytes = await createZip([
      { name: 'docs/readme.txt', bytes: bytesFromText('read me'), compression: 'STORE' },
      { name: 'images/pixel.bin', bytes: imageBytes, compression: 'DEFLATE' },
    ]);

    const archive = inspectZipBytes(zipBytes);
    expect(archive.entries.map((entry) => entry.name)).toEqual(['docs/readme.txt', 'images/pixel.bin']);
    const selected = await extractSelectedZipEntries(archive, [archive.entries[1].id]);

    expect(selected).toHaveLength(1);
    expect(selected[0].name).toBe('images/pixel.bin');
    expect(new Uint8Array(await selected[0].blob.arrayBuffer())).toEqual(imageBytes);
  });

  it('sanitizes traversal names and disambiguates duplicate names without losing bytes', async () => {
    const zipBytes = await createZip([
      { name: '../report.txt', bytes: bytesFromText('unsafe path') },
      { name: 'report.txt', bytes: bytesFromText('plain path') },
      { name: 'REPORT.TXT', bytes: bytesFromText('case collision') },
    ]);
    const archive = inspectZipBytes(zipBytes);

    expect(archive.entries.map((entry) => entry.name)).toEqual(['report.txt', 'report (2).txt', 'REPORT (3).TXT']);
    const extracted = await extractSelectedZipEntries(
      archive,
      archive.entries.map((entry) => entry.id),
    );
    expect(await Promise.all(extracted.map((entry) => entry.blob.text()))).toEqual(['unsafe path', 'plain path', 'case collision']);
  });

  it('preserves two entries with identical ZIP names', async () => {
    const zipBytes = await createZip([
      { name: 'first.txt', bytes: bytesFromText('first payload') },
      { name: 'other.txt', bytes: bytesFromText('second payload') },
    ]);
    expect(replaceAscii(zipBytes, 'other.txt', 'first.txt')).toBe(2);

    const archive = inspectZipBytes(zipBytes);
    expect(archive.entries.map((entry) => entry.name)).toEqual(['first.txt', 'first (2).txt']);
    const extracted = await extractSelectedZipEntries(
      archive,
      archive.entries.map((entry) => entry.id),
    );
    expect(await Promise.all(extracted.map((entry) => entry.blob.text()))).toEqual(['first payload', 'second payload']);
  });

  it('reports malformed archives clearly', () => {
    expect(() => inspectZipBytes(new Uint8Array([1, 2, 3]))).toThrow(/not a supported ZIP archive|truncated/i);
  });

  it('rejects encrypted entries', async () => {
    const zipBytes = await createZip([{ name: 'secret.txt', bytes: bytesFromText('secret') }]);
    const local = findSignature(zipBytes, 0x04034b50);
    const central = findSignature(zipBytes, 0x02014b50);
    writeU16(zipBytes, local + 6, readU16(zipBytes, local + 6) | 1);
    writeU16(zipBytes, central + 8, readU16(zipBytes, central + 8) | 1);

    expect(() => inspectZipBytes(zipBytes)).toThrow(/encrypted ZIP entries are not supported/i);
  });

  it('enforces the central-directory entry count limit', async () => {
    const zip = new JSZip();
    for (let index = 0; index <= ZIP_EXTRACT_LIMITS.entries; index++) {
      zip.file('file-' + index + '.txt', 'x');
    }
    const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }));

    expect(() => inspectZipBytes(bytes)).toThrow(/entry limit/i);
  });

  it('enforces per-file and total expanded size limits before extraction', async () => {
    const perFileBytes = await createZip([{ name: 'large.bin', bytes: bytesFromText('small') }]);
    setUncompressedSize(perFileBytes, 0, ZIP_EXTRACT_LIMITS.entryBytes + 1);
    expect(() => inspectZipBytes(perFileBytes)).toThrow(/per-file limit/i);

    const totalBytes = await createZip([
      { name: 'one.bin', bytes: bytesFromText('1') },
      { name: 'two.bin', bytes: bytesFromText('2') },
      { name: 'three.bin', bytes: bytesFromText('3') },
    ]);
    setUncompressedSize(totalBytes, 0, ZIP_EXTRACT_LIMITS.entryBytes);
    setUncompressedSize(totalBytes, 1, ZIP_EXTRACT_LIMITS.entryBytes);
    expect(() => inspectZipBytes(totalBytes)).toThrow(/total limit/i);
  });

  it('stops streaming when actual output exceeds its declared size', async () => {
    const bytes = await createZip([{ name: 'inflated.txt', bytes: bytesFromText('more than four bytes') }]);
    setUncompressedSize(bytes, 0, 4);

    const archive = inspectZipBytes(bytes);
    await expect(extractSelectedZipEntries(archive, [archive.entries[0].id])).rejects.toThrow(/expands beyond its declared size/i);
  });
});
