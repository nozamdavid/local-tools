import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const DB_NAME = 'loconvert-recent-files';
const ENTRIES = 'entries';
const DRAFTS = 'drafts';
const MAX_ENTRIES = 10;
const MAX_FILES_PER_ENTRY = 24;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;
const PHOTO_EDITOR = '/image/photo-editor';
const VIDEO_EDITOR = '/video/video-editor';
const changes = new EventTarget();
const fileHashes = new WeakMap<File, Promise<string>>();
const draftProjects = new WeakMap<File, string>();
let channel: BroadcastChannel | undefined;

interface StoredFile {
  name: string;
  lastModified: number;
  relativePath: string;
  blob: Blob;
}

export interface RecentFilesEntry {
  id: string;
  toolPath: string;
  openedAt: number;
  size: number;
  files: StoredFile[];
  draftProjectId?: string;
  additionalVideoNames?: string[];
}

interface BufferedBlob {
  bytes: ArrayBuffer;
  type: string;
}

type PersistedFile = Omit<StoredFile, 'blob'> & { blob: Blob | BufferedBlob };

interface StoredEntry extends Omit<RecentFilesEntry, 'files'> {
  files: PersistedFile[];
  draftBytes: number;
}

interface DraftAsset {
  blob: Blob | BufferedBlob;
  file?: Omit<StoredFile, 'blob'>;
}

interface DraftRecord {
  recentFilesFormat: 'assets';
  value: unknown;
}

interface DraftProject {
  id: string;
  create: boolean;
}

function fileMetadata(file: File): Omit<StoredFile, 'blob'> {
  return { name: file.name, lastModified: file.lastModified, relativePath: file.webkitRelativePath || '' };
}

function restoreFile(blob: Blob | BufferedBlob, { name, lastModified, relativePath }: Omit<StoredFile, 'blob'>): File {
  const file = new File([blob instanceof Blob ? blob : blob.bytes], name, { type: blob.type, lastModified });
  // glTF resolves companions using the folder-relative names supplied by the picker.
  if (relativePath) Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

function restoreBlob(blob: Blob | BufferedBlob): Blob {
  return blob instanceof Blob ? blob : new Blob([blob.bytes], { type: blob.type });
}

// Only the binary fields in the two editor drafts need a portable representation.
function mapDraftAssets<T, U>(draft: unknown, toolPath: string, map: (value: T) => U): unknown {
  if (!draft || typeof draft !== 'object') return draft;
  if (toolPath === PHOTO_EDITOR && 'baseImage' in draft && 'layers' in draft && Array.isArray(draft.layers)) {
    const { baseImage, layers } = draft as { baseImage: T | null; layers: { type: string; image?: T }[] };
    return {
      ...draft,
      baseImage: baseImage ? map(baseImage) : baseImage,
      layers: layers.map((layer) => (layer.type === 'image' && layer.image ? { ...layer, image: map(layer.image) } : layer)),
    };
  }
  if (toolPath === VIDEO_EDITOR) {
    const { soundtrack, additionalSources } = draft as { soundtrack?: T | null; additionalSources?: { file: T }[] };
    return {
      ...draft,
      ...(soundtrack && { soundtrack: map(soundtrack) }),
      ...(additionalSources && { additionalSources: additionalSources.map((source) => ({ ...source, file: map(source.file) })) }),
    };
  }
  return draft;
}

function collectDraftAssets(draft: unknown, toolPath: string, extraBytes: number) {
  const assets: { blob: Blob; asset: DraftAsset }[] = [];
  const value = mapDraftAssets(draft, toolPath, (blob: Blob) => {
    const asset: DraftAsset = { blob };
    if (blob instanceof File) asset.file = fileMetadata(blob);
    assets.push({ blob, asset });
    return asset;
  });
  if (assets.reduce((total, { blob }) => total + blob.size, 0) > extraBytes) {
    throw new Error('Recent draft assets exceed the declared size.');
  }
  return { assets, record: { recentFilesFormat: 'assets', value } satisfies DraftRecord };
}

async function bufferBlob(blob: Blob): Promise<BufferedBlob> {
  return { bytes: await blob.arrayBuffer(), type: blob.type };
}

function restoreDraft(draft: unknown, toolPath: string): unknown {
  if (!draft || typeof draft !== 'object' || !('recentFilesFormat' in draft) || draft.recentFilesFormat !== 'assets') return draft;
  return mapDraftAssets((draft as DraftRecord).value, toolPath, ({ file, blob }: DraftAsset) =>
    file ? restoreFile(blob, file) : restoreBlob(blob),
  );
}

function isBlobStorageError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    error.name === 'UnknownError' &&
    error.message === 'Error preparing Blob/File data to be stored in object store'
  );
}

function getChannel() {
  if (!channel && typeof window !== 'undefined' && typeof BroadcastChannel === 'function') {
    try {
      channel = new BroadcastChannel(DB_NAME);
    } catch {
      // The list still refreshes locally and when the window regains focus.
    }
  }
  return channel;
}

export function subscribeToRecentFiles(listener: () => void) {
  const crossTab = getChannel();
  changes.addEventListener('change', listener);
  crossTab?.addEventListener('message', listener);
  window.addEventListener('focus', listener);
  return () => {
    changes.removeEventListener('change', listener);
    crossTab?.removeEventListener('message', listener);
    window.removeEventListener('focus', listener);
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ENTRIES, { keyPath: 'id' });
      request.result.createObjectStore(DRAFTS);
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Recent files storage is blocked.'));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) database.close();
      else {
        database.onversionchange = () => database.close();
        resolve(database);
      }
    };
  });
}

async function runTransaction(names: string[], mode: IDBTransactionMode, run: (transaction: IDBTransaction) => void): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(names, mode);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      try {
        run(transaction);
      } catch {
        transaction.abort();
      }
    });
  } finally {
    database.close();
  }
}

async function updateEntries(update: (entries: IDBObjectStore, drafts: IDBObjectStore) => void, notify = () => true): Promise<void> {
  await runTransaction([ENTRIES, DRAFTS], 'readwrite', (transaction) =>
    update(transaction.objectStore(ENTRIES), transaction.objectStore(DRAFTS)),
  );
  if (!notify()) return;
  changes.dispatchEvent(new Event('change'));
  try {
    getChannel()?.postMessage(null);
  } catch {
    // The transaction has already committed.
  }
}

function newestFirst(a: { openedAt: number }, b: { openedAt: number }) {
  return b.openedAt - a.openedAt;
}

export function isRecentEditorPath(toolPath: string) {
  return toolPath === PHOTO_EDITOR || toolPath === VIDEO_EDITOR;
}

async function hashFile(file: File) {
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += HASH_CHUNK_BYTES) {
    const chunk = await file.slice(offset, offset + HASH_CHUNK_BYTES).arrayBuffer();
    hash.update(new Uint8Array(chunk));
  }
  return bytesToHex(hash.digest());
}

export function createRecentDraftProjectId() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

function projectEntryId(id: string) {
  return JSON.stringify([VIDEO_EDITOR, id]);
}

async function entryId(files: File[], toolPath: string) {
  const metadata = files.map((file) => [file.name, file.size, file.lastModified, file.type, file.webkitRelativePath || '']);
  if (!isRecentEditorPath(toolPath) || files.length !== 1) return JSON.stringify([toolPath, metadata]);
  const [file] = files;
  const projectId = toolPath === VIDEO_EDITOR ? draftProjects.get(file) : undefined;
  if (projectId) return projectEntryId(projectId);
  // An editor draft must match the source bytes even when metadata is identical.
  let contentHash = fileHashes.get(file);
  if (!contentHash) {
    contentHash = hashFile(file);
    fileHashes.set(file, contentHash);
  }
  return JSON.stringify([toolPath, metadata, await contentHash]);
}

async function saveEntry(
  id: string,
  build: (previous: StoredEntry | undefined, newestAt: number, drafts: IDBObjectStore) => StoredEntry | undefined,
  notifyOnSave = () => true,
): Promise<boolean> {
  let saved = false;
  let evicted = false;
  await updateEntries(
    (entries, drafts) => {
      const request = entries.getAll();
      request.onsuccess = () => {
        try {
          // Read, evict and write in one transaction, including across tabs.
          const existing = (request.result as StoredEntry[]).sort(newestFirst);
          const entry = build(
            existing.find((item) => item.id === id),
            existing[0]?.openedAt ?? 0,
            drafts,
          );
          if (!entry) return;
          const others = existing.filter((item) => item.id !== id);
          let count = 1 + others.length;
          let bytes = others.reduce((total, item) => total + item.size + item.draftBytes, entry.size + entry.draftBytes);
          for (const item of others.reverse()) {
            if (count <= MAX_ENTRIES && bytes <= MAX_TOTAL_BYTES) break;
            entries.delete(item.id);
            drafts.delete(item.id);
            count--;
            bytes -= item.size + item.draftBytes;
            evicted = true;
          }
          entries.put(entry);
          saved = true;
        } catch {
          entries.transaction.abort();
        }
      };
    },
    () => saved && (notifyOnSave() || evicted),
  );
  return saved;
}

/** Best-effort history for a complete, user-selected set of inputs. */
export async function rememberRecentFiles(files: File[], toolPath: string): Promise<void> {
  try {
    if (!files.length || files.length > MAX_FILES_PER_ENTRY || files.some((file) => file.size > MAX_FILE_BYTES)) return;
    const size = files.reduce((sum, file) => sum + file.size, 0);
    if (size > MAX_TOTAL_BYTES) return;

    // A repeat replaces the stored bytes and moves the selection to the top.
    const id = await entryId(files, toolPath);
    const isDraftProject = toolPath === VIDEO_EDITOR && files.length === 1 && draftProjects.has(files[0]);
    const save = (storedFiles: PersistedFile[]) =>
      saveEntry(id, (previous, newestAt) => {
        // A stale recent entry can still be clicked while a removal is propagating.
        if (isDraftProject && !previous) return;
        return {
          id,
          toolPath,
          openedAt: Math.max(Date.now(), newestAt + 1),
          size,
          files: storedFiles,
          draftBytes: previous?.draftBytes ?? 0,
          draftProjectId: previous?.draftProjectId,
          additionalVideoNames: previous?.additionalVideoNames,
        };
      });
    try {
      await save(files.map((file) => ({ ...fileMetadata(file), blob: file.slice(0, file.size, file.type) })));
    } catch (error) {
      if (!isBlobStorageError(error)) throw error;
      // Some WebKit contexts store ArrayBuffers but abort transactions containing Blobs.
      const buffered: PersistedFile[] = [];
      for (const file of files) {
        buffered.push({ ...fileMetadata(file), blob: await bufferBlob(file) });
      }
      await save(buffered);
    }
  } catch {
    // File opening must still work if keeping a local copy fails.
  }
}

export async function listRecentFiles(): Promise<RecentFilesEntry[]> {
  let entries: StoredEntry[] = [];
  try {
    await runTransaction([ENTRIES], 'readonly', (transaction) => {
      const request = transaction.objectStore(ENTRIES).getAll();
      request.onsuccess = () => {
        entries = request.result as StoredEntry[];
      };
    });
    return entries.sort(newestFirst).map((entry) => ({
      ...entry,
      files: entry.files.map((file) => ({ ...file, blob: restoreBlob(file.blob) })),
    }));
  } catch {
    return [];
  }
}

export function restoreRecentFiles(entry: RecentFilesEntry): File[] {
  return entry.files.map(({ blob, ...metadata }) => {
    const file = restoreFile(blob, metadata);
    if (entry.draftProjectId) draftProjects.set(file, entry.draftProjectId);
    return file;
  });
}

export function removeRecentFiles(id: string): Promise<boolean> {
  return updateEntries((entries, drafts) => {
    entries.delete(id);
    drafts.delete(id);
  }).then(
    () => true,
    () => false,
  );
}

export function clearRecentFiles(): Promise<boolean> {
  return updateEntries((entries, drafts) => {
    entries.clear();
    drafts.clear();
  }).then(
    () => true,
    () => false,
  );
}

export async function readRecentDraft<T>(file: File, toolPath: string): Promise<T | null> {
  let draft: unknown;
  try {
    if (file.size > MAX_FILE_BYTES) return null;
    const id = await entryId([file], toolPath);
    await runTransaction([DRAFTS], 'readonly', (transaction) => {
      const request = transaction.objectStore(DRAFTS).get(id);
      request.onsuccess = () => {
        draft = request.result;
      };
    });
    return (restoreDraft(draft, toolPath) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

/** extraBytes includes the draft's assets and metadata separately from the stored source file. */
export async function writeRecentDraft(
  file: File,
  toolPath: string,
  draft: unknown,
  extraBytes: number,
  project?: DraftProject,
): Promise<boolean> {
  try {
    if (!Number.isSafeInteger(extraBytes) || extraBytes < 0 || file.size + extraBytes > MAX_FILE_BYTES) return false;
    const { assets, record } = collectDraftAssets(draft, toolPath, extraBytes);
    const id = project ? projectEntryId(project.id) : await entryId([file], toolPath);
    const names =
      toolPath === VIDEO_EDITOR &&
      draft &&
      typeof draft === 'object' &&
      'additionalSources' in draft &&
      Array.isArray(draft.additionalSources)
        ? draft.additionalSources.map(({ file }: { file: File }) => file.name)
        : [];
    let namesChanged = false;
    const save = (value: unknown, source?: PersistedFile) =>
      saveEntry(
        id,
        (previous, newestAt, drafts) => {
          const entry: Omit<StoredEntry, 'draftBytes'> | undefined =
            previous ??
            (source && {
              id,
              toolPath,
              openedAt: Math.max(Date.now(), newestAt + 1),
              size: file.size,
              files: [source],
              draftProjectId: project?.id,
            });
          if (!entry) return;
          drafts.put(value, id);
          if (toolPath !== VIDEO_EDITOR) return { ...entry, draftBytes: extraBytes };
          const previousNames = entry.additionalVideoNames ?? [];
          namesChanged = previousNames.length !== names.length || previousNames.some((name, index) => name !== names[index]);
          return { ...entry, draftBytes: extraBytes, additionalVideoNames: names.length ? names : undefined };
        },
        () => !!project?.create || namesChanged,
      );
    const metadata = project?.create ? fileMetadata(file) : undefined;
    try {
      // IndexedDB's native File clone omits the folder path.
      return await save(
        toolPath === VIDEO_EDITOR && assets.length ? record : draft,
        metadata && { ...metadata, blob: file.slice(0, file.size, file.type) },
      );
    } catch (error) {
      if (!isBlobStorageError(error)) throw error;
      for (const { blob, asset } of assets) asset.blob = await bufferBlob(blob);
      return await save(record, metadata && { ...metadata, blob: await bufferBlob(file) });
    }
  } catch {
    return false;
  }
}
