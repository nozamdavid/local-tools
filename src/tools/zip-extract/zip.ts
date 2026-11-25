import JSZip from 'jszip';
import { translate } from '../../lib/i18n';

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_COUNT = 1000;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_EXPANDED_BYTES = 128 * 1024 * 1024;

export const ZIP_EXTRACT_LIMITS = {
  archiveBytes: MAX_ARCHIVE_BYTES,
  entries: MAX_ENTRY_COUNT,
  entryBytes: MAX_ENTRY_BYTES,
  totalExpandedBytes: MAX_TOTAL_EXPANDED_BYTES,
} as const;

export interface ZipEntry {
  id: number;
  name: string;
  size: number;
  compressedSize: number;
  crc32: number;
  method: number;
  flags: number;
  dosTime: number;
  dosDate: number;
  dataOffset: number;
}

export interface ZipArchive {
  sourceBytes: Uint8Array;
  entries: ZipEntry[];
}

export interface ExtractedZipEntry {
  id: number;
  name: string;
  blob: Blob;
}

interface ZipStream {
  on(event: 'data', callback: (chunk: Uint8Array) => void): this;
  on(event: 'error', callback: (error: Error) => void): this;
  on(event: 'end', callback: () => void): this;
  pause(): this;
  resume(): this;
}

interface StreamableZipFile {
  internalStream(type: 'uint8array'): ZipStream;
}

interface EntryRange {
  start: number;
  end: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ENCRYPTION_FLAGS = 0x2041;
const SUPPORTED_FLAGS = 0x080e;

function malformed(message = 'The ZIP archive is malformed or truncated.'): Error {
  return new Error(translate(message));
}

function readU16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw malformed();
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw malformed();
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

function hasSignature(bytes: Uint8Array, offset: number, signature: number): boolean {
  return offset >= 0 && offset + 4 <= bytes.length && readU32(bytes, offset) === signature;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minimum; offset--) {
    if (!hasSignature(bytes, offset, EOCD_SIGNATURE)) continue;
    const commentLength = readU16(bytes, offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw malformed('This file is not a supported ZIP archive or it is truncated.');
}

const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';

function decodeName(bytes: Uint8Array, flags: number, extra: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  if (flags & UTF8_FLAG) return utf8.decode(bytes);
  for (let offset = 0; offset + 4 <= extra.length;) {
    const id = readU16(extra, offset);
    const length = readU16(extra, offset + 2);
    offset += 4;
    if (offset + length > extra.length) throw malformed();
    // Info-ZIP Unicode Path field: version, CRC of original name, UTF-8 name.
    if (
      id === 0x7075 &&
      length >= 5 &&
      extra[offset] === 1 &&
      readU32(extra, offset + 1) === (updateCrc32(0xffffffff, bytes) ^ 0xffffffff) >>> 0
    ) {
      return utf8.decode(extra.subarray(offset + 5, offset + length));
    }
    offset += length;
  }
  return Array.from(bytes, (byte) => (byte < 128 ? String.fromCharCode(byte) : CP437_HIGH[byte - 128])).join('');
}

function hasZip64Extra(bytes: Uint8Array, offset: number, length: number): boolean {
  const end = offset + length;
  if (end > bytes.length) throw malformed();
  while (offset < end) {
    if (offset + 4 > end) throw malformed();
    const id = readU16(bytes, offset);
    const fieldLength = readU16(bytes, offset + 2);
    offset += 4;
    if (offset + fieldLength > end) throw malformed();
    if (id === 0x0001) return true;
    offset += fieldLength;
  }
  return false;
}

function isDirectory(name: string, externalAttributes: number): boolean {
  const unixMode = externalAttributes >>> 16;
  return name.endsWith('/') || (externalAttributes & 0x10) !== 0 || (unixMode & 0xf000) === 0x4000;
}

function sanitizePath(name: string, fallbackId: number): string {
  const parts = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .map((part) => {
      // Strip ASCII controls as well as platform-reserved filename characters.
      // eslint-disable-next-line no-control-regex
      let safe = part.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/[. ]+$/g, '');
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(safe)) safe = '_' + safe;
      return safe;
    })
    .filter(Boolean);

  return parts.length > 0 ? parts.join('/') : 'file-' + (fallbackId + 1);
}

function uniquePath(path: string, used: Set<string>): string {
  const keyFor = (name: string) => name.normalize('NFC').toLocaleLowerCase('en-US');
  const parts = path.split('/');
  let directory = '';
  for (let index = 0; index < parts.length; index++) {
    const isFile = index === parts.length - 1;
    const name = parts[index];
    const dot = isFile ? name.lastIndexOf('.') : -1;
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    let candidate = directory + name;
    for (let suffix = 2; used.has(keyFor(candidate)) || (isFile && used.has(keyFor(candidate) + '/')); suffix++) {
      candidate = directory + stem + ' (' + suffix + ')' + extension;
    }
    if (isFile) {
      used.add(keyFor(candidate));
      return candidate;
    }
    used.add(keyFor(candidate) + '/');
    directory = candidate + '/';
  }
  throw malformed('Empty file path.');
}

function formatLimit(bytes: number): string {
  return Math.round(bytes / (1024 * 1024)) + ' MB';
}

function parseEntries(sourceBytes: Uint8Array): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(sourceBytes);
  if (eocdOffset >= 20 && readU32(sourceBytes, eocdOffset - 20) === ZIP64_LOCATOR_SIGNATURE) {
    throw new Error(translate('ZIP64 archives are not supported.'));
  }

  const diskNumber = readU16(sourceBytes, eocdOffset + 4);
  const centralDisk = readU16(sourceBytes, eocdOffset + 6);
  const entriesOnDisk = readU16(sourceBytes, eocdOffset + 8);
  const entryCount = readU16(sourceBytes, eocdOffset + 10);
  const centralSize = readU32(sourceBytes, eocdOffset + 12);
  const centralOffset = readU32(sourceBytes, eocdOffset + 16);

  if (
    diskNumber === 0xffff ||
    centralDisk === 0xffff ||
    entriesOnDisk === 0xffff ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error(translate('ZIP64 archives are not supported.'));
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error(translate('Split or multi-volume ZIP archives are not supported.'));
  }
  if (entryCount > MAX_ENTRY_COUNT) {
    throw new Error(translate('This archive exceeds the {count} entry limit.', { count: MAX_ENTRY_COUNT.toLocaleString() }));
  }

  const centralEnd = centralOffset + centralSize;
  if (centralEnd !== eocdOffset || centralEnd > sourceBytes.length) throw malformed();

  const entries: ZipEntry[] = [];
  const ranges: EntryRange[] = [];
  const usedNames = new Set<string>();
  let totalExpandedBytes = 0;
  let cursor = centralOffset;

  for (let id = 0; id < entryCount; id++) {
    if (!hasSignature(sourceBytes, cursor, CENTRAL_SIGNATURE)) throw malformed();
    if (cursor + 46 > centralEnd) throw malformed();

    const versionNeeded = readU16(sourceBytes, cursor + 6);
    const flags = readU16(sourceBytes, cursor + 8);
    const method = readU16(sourceBytes, cursor + 10);
    const dosTime = readU16(sourceBytes, cursor + 12);
    const dosDate = readU16(sourceBytes, cursor + 14);
    const crc32 = readU32(sourceBytes, cursor + 16);
    const compressedSize = readU32(sourceBytes, cursor + 20);
    const size = readU32(sourceBytes, cursor + 24);
    const nameLength = readU16(sourceBytes, cursor + 28);
    const extraLength = readU16(sourceBytes, cursor + 30);
    const commentLength = readU16(sourceBytes, cursor + 32);
    const startDisk = readU16(sourceBytes, cursor + 34);
    const externalAttributes = readU32(sourceBytes, cursor + 38);
    const localOffset = readU32(sourceBytes, cursor + 42);
    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;

    if (recordEnd > centralEnd) throw malformed();
    if (startDisk === 0xffff || localOffset === 0xffffffff || compressedSize === 0xffffffff || size === 0xffffffff) {
      throw new Error(translate('ZIP64 archives are not supported.'));
    }
    if (startDisk !== 0) throw new Error(translate('Split or multi-volume ZIP archives are not supported.'));
    if (hasZip64Extra(sourceBytes, cursor + 46 + nameLength, extraLength)) {
      throw new Error(translate('ZIP64 archives are not supported.'));
    }
    if ((flags & ENCRYPTION_FLAGS) !== 0) {
      throw new Error(translate('Encrypted ZIP entries are not supported.'));
    }
    if ((flags & ~SUPPORTED_FLAGS) !== 0 || (method === 0 && (flags & 0x0006) !== 0)) {
      throw new Error(translate('This ZIP uses unsupported entry options.'));
    }
    if (method !== 0 && method !== 8) {
      throw new Error(translate('This ZIP uses an unsupported compression method. Use STORE or DEFLATE entries.'));
    }
    if (versionNeeded > 45) throw new Error(translate('This ZIP uses unsupported archive features.'));

    const rawName = decodeName(
      sourceBytes.subarray(cursor + 46, cursor + 46 + nameLength),
      flags,
      sourceBytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength),
    );
    const directory = isDirectory(rawName, externalAttributes);
    if (!directory && size > MAX_ENTRY_BYTES) {
      throw new Error(translate('An entry expands beyond the {size} per-file limit.', { size: formatLimit(MAX_ENTRY_BYTES) }));
    }
    if (!directory) {
      if (size > MAX_TOTAL_EXPANDED_BYTES - totalExpandedBytes) {
        throw new Error(translate('The archive expands beyond the {size} total limit.', { size: formatLimit(MAX_TOTAL_EXPANDED_BYTES) }));
      }
      totalExpandedBytes += size;
    } else if (size !== 0 || compressedSize !== 0) {
      throw malformed('A directory entry contains unexpected file data.');
    }

    const localHeaderEnd = localOffset + 30;
    if (localHeaderEnd > centralOffset || !hasSignature(sourceBytes, localOffset, LOCAL_SIGNATURE)) throw malformed();
    const localFlags = readU16(sourceBytes, localOffset + 6);
    const localMethod = readU16(sourceBytes, localOffset + 8);
    const localCrc32 = readU32(sourceBytes, localOffset + 14);
    const localCompressedSize = readU32(sourceBytes, localOffset + 18);
    const localSize = readU32(sourceBytes, localOffset + 22);
    const localNameLength = readU16(sourceBytes, localOffset + 26);
    const localExtraLength = readU16(sourceBytes, localOffset + 28);
    const dataOffset = localHeaderEnd + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;

    if (dataOffset > centralOffset || dataEnd > centralOffset || dataEnd < dataOffset) throw malformed();
    if ((localFlags & ENCRYPTION_FLAGS) !== 0) {
      throw new Error(translate('Encrypted ZIP entries are not supported.'));
    }
    if (localMethod !== method || localFlags !== flags) throw malformed('ZIP entry headers do not match.');
    if (localNameLength !== nameLength) throw malformed('ZIP entry names do not match.');
    for (let i = 0; i < nameLength; i++) {
      if (sourceBytes[localHeaderEnd + i] !== sourceBytes[cursor + 46 + i]) throw malformed('ZIP entry names do not match.');
    }
    if (hasZip64Extra(sourceBytes, localHeaderEnd + localNameLength, localExtraLength)) {
      throw new Error(translate('ZIP64 archives are not supported.'));
    }
    if (localFlags & DATA_DESCRIPTOR_FLAG) {
      if (
        (localCrc32 !== 0 && localCrc32 !== crc32) ||
        (localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
        (localSize !== 0 && localSize !== size)
      ) {
        throw malformed('ZIP entry headers do not match.');
      }
    } else if (localCrc32 !== crc32 || localCompressedSize !== compressedSize || localSize !== size) {
      throw malformed('ZIP entry headers do not match.');
    }

    if (ranges.some((range) => localOffset < range.end && dataEnd > range.start)) throw malformed('ZIP entries overlap.');
    ranges.push({ start: localOffset, end: dataEnd });

    if (!directory) {
      const safeName = sanitizePath(rawName, id);
      if (new TextEncoder().encode(safeName).byteLength > 0xffff)
        throw new Error(translate('A ZIP entry name is too long to export safely.'));
      entries.push({
        id,
        name: uniquePath(safeName, usedNames),
        size,
        compressedSize,
        crc32,
        method,
        flags,
        dosTime,
        dosDate,
        dataOffset,
      });
    }

    cursor = recordEnd;
  }

  if (cursor !== centralEnd) throw malformed();
  if (entries.length === 0) throw new Error(translate('This ZIP archive contains no files to extract.'));
  return entries;
}

export function inspectZipBytes(bytes: Uint8Array): ZipArchive {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(translate('ZIP files must be {size} or smaller.', { size: formatLimit(MAX_ARCHIVE_BYTES) }));
  }
  const sourceBytes = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
  return { sourceBytes, entries: parseEntries(sourceBytes) };
}

export async function inspectZipFile(file: File): Promise<ZipArchive> {
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new Error(translate('ZIP files must be {size} or smaller.', { size: formatLimit(MAX_ARCHIVE_BYTES) }));
  }
  return inspectZipBytes(new Uint8Array(await file.arrayBuffer()));
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function singleEntryArchive(sourceBytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const name = new TextEncoder().encode(entry.name);
  const compressed = sourceBytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  const flags = UTF8_FLAG | (entry.method === 8 ? entry.flags & 0x0006 : 0);
  const local = new Uint8Array(30 + name.byteLength);

  writeU32(local, 0, LOCAL_SIGNATURE);
  writeU16(local, 4, 20);
  writeU16(local, 6, flags);
  writeU16(local, 8, entry.method);
  writeU16(local, 10, entry.dosTime);
  writeU16(local, 12, entry.dosDate);
  writeU32(local, 14, entry.crc32);
  writeU32(local, 18, entry.compressedSize);
  writeU32(local, 22, entry.size);
  writeU16(local, 26, name.byteLength);
  local.set(name, 30);

  const central = new Uint8Array(46 + name.byteLength);
  writeU32(central, 0, CENTRAL_SIGNATURE);
  writeU16(central, 4, 20);
  writeU16(central, 6, 20);
  writeU16(central, 8, flags);
  writeU16(central, 10, entry.method);
  writeU16(central, 12, entry.dosTime);
  writeU16(central, 14, entry.dosDate);
  writeU32(central, 16, entry.crc32);
  writeU32(central, 20, entry.compressedSize);
  writeU32(central, 24, entry.size);
  writeU16(central, 28, name.byteLength);
  central.set(name, 46);

  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, EOCD_SIGNATURE);
  writeU16(eocd, 8, 1);
  writeU16(eocd, 10, 1);
  writeU32(eocd, 12, central.byteLength);
  writeU32(eocd, 16, local.byteLength + compressed.byteLength);

  return concatenate([local, compressed, central, eocd]);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < table.length; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let value = crc;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function collectEntry(stream: ZipStream, entry: ZipEntry, remainingTotalBytes: number, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let actualBytes = 0;
    let crc32 = 0xffffffff;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      stream.pause();
      reject(error);
    };

    stream
      .on('data', (chunk) => {
        if (settled) return;
        const nextSize = actualBytes + chunk.byteLength;
        if (nextSize > MAX_ENTRY_BYTES) {
          fail(new Error(translate('An entry expands beyond the {size} per-file limit.', { size: formatLimit(MAX_ENTRY_BYTES) })));
          return;
        }
        if (nextSize > remainingTotalBytes) {
          fail(
            new Error(
              translate('The selected files expand beyond the {size} total limit.', { size: formatLimit(MAX_TOTAL_EXPANDED_BYTES) }),
            ),
          );
          return;
        }
        if (nextSize > entry.size) {
          fail(new Error(translate('"{name}" expands beyond its declared size. The archive may be damaged.', { name: entry.name })));
          return;
        }
        actualBytes = nextSize;
        crc32 = updateCrc32(crc32, chunk);
        chunks.push(chunk);
      })
      .on('error', (error) =>
        fail(new Error(translate('Could not decompress "{name}": {message}', { name: entry.name, message: error.message }))),
      )
      .on('end', () => {
        if (settled) return;
        if (actualBytes !== entry.size) {
          fail(new Error(translate('"{name}" does not match its declared size. The archive may be damaged.', { name: entry.name })));
          return;
        }
        if ((crc32 ^ 0xffffffff) >>> 0 !== entry.crc32) {
          fail(new Error(translate('"{name}" failed its checksum. The archive may be damaged.', { name: entry.name })));
          return;
        }
        try {
          const blob = new Blob(chunks as unknown as BlobPart[], { type: mimeType });
          chunks.length = 0;
          settled = true;
          resolve(blob);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(translate('Could not save "{name}" in memory.', { name: entry.name })));
        }
      })
      .resume();
  });
}

export function mimeTypeForZipName(name: string): string {
  const extension =
    name
      .slice(name.lastIndexOf('/') + 1)
      .split('.')
      .pop()
      ?.toLowerCase() ?? '';
  const known: Record<string, string> = {
    avif: 'image/avif',
    bmp: 'image/bmp',
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    gif: 'image/gif',
    heic: 'image/heic',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    json: 'application/json',
    md: 'text/markdown',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    odt: 'application/vnd.oasis.opendocument.text',
    pdf: 'application/pdf',
    png: 'image/png',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    txt: 'text/plain',
    wav: 'audio/wav',
    webm: 'video/webm',
    webp: 'image/webp',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return known[extension] ?? 'application/octet-stream';
}

export async function extractSelectedZipEntries(archive: ZipArchive, selectedIds: number[]): Promise<ExtractedZipEntry[]> {
  const selected = new Set(selectedIds);
  const entries = archive.entries.filter((entry) => selected.has(entry.id));
  if (entries.length === 0) return [];

  const result: ExtractedZipEntry[] = [];
  let actualTotalBytes = 0;
  for (const entry of entries) {
    const singleZip = singleEntryArchive(archive.sourceBytes, entry);
    const zip = await JSZip.loadAsync(singleZip, { checkCRC32: false, createFolders: false });
    const zipFile = zip.file(entry.name);
    if (!zipFile) throw new Error(translate('Could not open "{name}" from the archive.', { name: entry.name }));
    const blob = await collectEntry(
      (zipFile as unknown as StreamableZipFile).internalStream('uint8array'),
      entry,
      MAX_TOTAL_EXPANDED_BYTES - actualTotalBytes,
      mimeTypeForZipName(entry.name),
    );
    actualTotalBytes += blob.size;
    result.push({ id: entry.id, name: entry.name, blob });
  }
  return result;
}
