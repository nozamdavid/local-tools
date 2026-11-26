import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const DB_NAME = 'loconvert-recent-files';
const ENTRIES = 'entries';
const DRAFTS = 'drafts';
const VIDEO_ASSETS = 'video-assets';
const MAX_ENTRIES = 10;
const MAX_FILES_PER_ENTRY = 24;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_VIDEO_PROJECT_BYTES = 512 * 1024 * 1024;
const MAX_VIDEO_TOTAL_BYTES = 1024 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;
const PHOTO_EDITOR = '/image/photo-editor';
const VIDEO_EDITOR = '/video/video-editor';
const changes = new EventTarget();
const fileHashes = new WeakMap<File, Promise<string>>();
const recentVideoEntries = new WeakMap<File, string>();
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
  video?: { revision: string; assets: string[] };
}

interface DraftAsset {
  blob: Blob | BufferedBlob;
  file?: Omit<StoredFile, 'blob'>;
}

interface DraftRecord {
  recentFilesFormat: 'assets';
  value: unknown;
}

interface VideoDraftProject {
  id: string;
  reopened: boolean;
  revision: string | null | undefined;
  assetIds: WeakMap<Blob, string>;
}

export type VideoDraftSave = 'saved' | 'session' | 'storage' | 'conflict';

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
    const request = indexedDB.open(DB_NAME, 2);
    let blocked = false;
    request.onupgradeneeded = ({ oldVersion }) => {
      if (oldVersion === 0) {
        request.result.createObjectStore(ENTRIES, { keyPath: 'id' });
        request.result.createObjectStore(DRAFTS);
      }
      request.result.createObjectStore(VIDEO_ASSETS);
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
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  } finally {
    database.close();
  }
}

async function updateEntries(
  update: (entries: IDBObjectStore, drafts: IDBObjectStore, videoAssets: IDBObjectStore) => void,
  notify = () => true,
): Promise<void> {
  await runTransaction([ENTRIES, DRAFTS, VIDEO_ASSETS], 'readwrite', (transaction) =>
    update(transaction.objectStore(ENTRIES), transaction.objectStore(DRAFTS), transaction.objectStore(VIDEO_ASSETS)),
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
  const recentId = toolPath === VIDEO_EDITOR ? recentVideoEntries.get(file) : undefined;
  if (recentId) return recentId;
  // An editor draft must match the source bytes even when metadata is identical.
  let contentHash = fileHashes.get(file);
  if (!contentHash) {
    contentHash = hashFile(file);
    fileHashes.set(file, contentHash);
  }
  return JSON.stringify([toolPath, metadata, await contentHash]);
}

function deleteEntry(entries: IDBObjectStore, drafts: IDBObjectStore, videoAssets: IDBObjectStore, id: string, entry?: StoredEntry) {
  entries.delete(id);
  drafts.delete(id);
  for (const asset of entry?.video?.assets ?? []) videoAssets.delete([id, asset]);
}

async function saveEntry(
  id: string,
  build: (
    previous: StoredEntry | undefined,
    newestAt: number,
    drafts: IDBObjectStore,
    videoAssets: IDBObjectStore,
  ) => StoredEntry | undefined,
  notifyOnSave = () => true,
): Promise<boolean> {
  let saved = false;
  let evicted = false;
  let writeError: unknown;
  await updateEntries(
    (entries, drafts, videoAssets) => {
      const request = entries.getAll();
      request.onsuccess = () => {
        try {
          // Read, evict and write in one transaction, including across tabs.
          const existing = (request.result as StoredEntry[]).sort(newestFirst);
          const entry = build(
            existing.find((item) => item.id === id),
            existing[0]?.openedAt ?? 0,
            drafts,
            videoAssets,
          );
          if (!entry) return;
          const others = existing.filter((item) => item.id !== id);
          let count = 1 + others.length;
          const bytesByGroup = { recent: 0, video: 0 };
          for (const item of [entry, ...others]) {
            bytesByGroup[item.video ? 'video' : 'recent'] += item.size + item.draftBytes;
          }
          for (const item of others.reverse()) {
            const group = item.video ? 'video' : 'recent';
            if (count <= MAX_ENTRIES && bytesByGroup[group] <= (item.video ? MAX_VIDEO_TOTAL_BYTES : MAX_TOTAL_BYTES)) continue;
            deleteEntry(entries, drafts, videoAssets, item.id, item);
            count--;
            bytesByGroup[group] -= item.size + item.draftBytes;
            evicted = true;
          }
          entries.put(entry);
          saved = true;
        } catch (error) {
          writeError = error;
          entries.transaction.abort();
        }
      };
    },
    () => saved && (notifyOnSave() || evicted),
  ).catch((error: unknown) => {
    throw writeError ?? error;
  });
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
    const save = (storedFiles: PersistedFile[]) =>
      saveEntry(id, (previous, newestAt) => {
        // A stale recent entry can still be clicked while a removal is propagating.
        if (previous?.video || (toolPath === VIDEO_EDITOR && files.length === 1 && recentVideoEntries.has(files[0]))) return;
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
    await runTransaction([ENTRIES, VIDEO_ASSETS], 'readonly', (transaction) => {
      const request = transaction.objectStore(ENTRIES).getAll();
      request.onsuccess = () => {
        entries = request.result as StoredEntry[];
        const videoAssets = transaction.objectStore(VIDEO_ASSETS);
        for (const entry of entries) {
          if (!entry.video) continue;
          const source = videoAssets.get([entry.id, entry.video.assets[0]]);
          source.onsuccess = () => {
            if (source.result?.file) entry.files = [{ ...source.result.file, blob: source.result.blob }];
          };
        }
      };
    });
    return entries
      .filter((entry) => entry.files.length)
      .sort(newestFirst)
      .map((entry) => ({
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
    if (entry.toolPath === VIDEO_EDITOR) recentVideoEntries.set(file, entry.id);
    return file;
  });
}

export function removeRecentFiles(id: string): Promise<boolean> {
  return updateEntries((entries, drafts, videoAssets) => {
    const request = entries.get(id);
    request.onsuccess = () => deleteEntry(entries, drafts, videoAssets, id, request.result as StoredEntry | undefined);
  }).then(
    () => true,
    () => false,
  );
}

export function clearRecentFiles(): Promise<boolean> {
  return updateEntries((entries, drafts, videoAssets) => {
    entries.clear();
    drafts.clear();
    videoAssets.clear();
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

export async function videoDraftProject(file: File, projectId?: string): Promise<VideoDraftProject> {
  if (file.size > MAX_VIDEO_PROJECT_BYTES) projectId ??= createRecentDraftProjectId();
  return {
    id: projectId ? projectEntryId(projectId) : await entryId([file], VIDEO_EDITOR),
    reopened: recentVideoEntries.has(file),
    revision: null,
    assetIds: new WeakMap(),
  };
}

export async function readVideoDraft<T>(file: File, project: VideoDraftProject): Promise<T | null> {
  if (file.size > MAX_VIDEO_PROJECT_BYTES) return null;
  let entry: StoredEntry | undefined;
  let draft: unknown;
  const assets = new Map<string, Blob>();
  // Read the draft and its media from one snapshot. Removing an entry deletes both.
  await updateEntries(
    (entries, drafts, videoAssets) => {
      const request = entries.get(project.id);
      request.onsuccess = () => {
        entry = request.result as StoredEntry | undefined;
        if (!entry) return;
        entries.put({ ...entry, openedAt: Math.max(entry.openedAt, Date.now()) });
        const savedDraft = drafts.get(project.id);
        savedDraft.onsuccess = () => {
          draft = savedDraft.result;
        };
        for (const id of entry.video?.assets.slice(1) ?? []) {
          const savedAsset = videoAssets.get([project.id, id]);
          savedAsset.onsuccess = () => {
            const asset = savedAsset.result as DraftAsset | undefined;
            if (!asset) {
              drafts.transaction.abort();
              return;
            }
            const blob = asset.file ? restoreFile(asset.blob, asset.file) : restoreBlob(asset.blob);
            assets.set(id, blob);
            project.assetIds.set(blob, id);
          };
        }
      };
    },
    () => !!entry,
  );
  if (!entry) return null;
  if (entry.video) {
    project.assetIds.set(file, entry.video.assets[0]);
    draft = mapDraftAssets(draft, VIDEO_EDITOR, (id: string) => {
      const blob = assets.get(id);
      if (!blob) throw new Error('Stored video project is missing media.');
      return blob;
    });
  } else {
    draft = restoreDraft(draft, VIDEO_EDITOR);
  }
  project.revision = entry.video?.revision;
  return (draft as T | undefined) ?? null;
}

export async function writeVideoDraft(file: File, project: VideoDraftProject, draft: unknown): Promise<VideoDraftSave> {
  try {
    const media = new Map<string, Blob>();
    const reference = (blob: Blob) => {
      let id = project.assetIds.get(blob);
      if (!id) {
        id = createRecentDraftProjectId();
        project.assetIds.set(blob, id);
      }
      media.set(id, blob);
      return id;
    };
    // The first asset is the anchor used by Recent files to reopen the project.
    reference(file);
    const value = mapDraftAssets(draft, VIDEO_EDITOR, reference);
    const extraBytes = new Blob([JSON.stringify(value)]).size + [...media.values()].reduce((total, blob) => total + blob.size, -file.size);
    if (file.size + extraBytes > MAX_VIDEO_PROJECT_BYTES) return 'session';

    const names = (draft as { additionalSources?: { file: File }[] } | null)?.additionalSources?.map(({ file }) => file.name) ?? [];
    const revision = createRecentDraftProjectId();
    let added: [string, Blob][] = [];
    let listChanged = false;
    const save = (buffered?: Map<string, BufferedBlob>) =>
      saveEntry(
        project.id,
        (previous, newestAt, drafts, videoAssets) => {
          // Compare within the write transaction so a stale tab cannot overwrite
          // a newer draft or recreate a project that was removed or evicted.
          if ((previous ? previous.video?.revision : null) !== project.revision || (!previous && project.reopened)) return;
          const previousAssets = new Set(previous?.video?.assets);
          added = [...media].filter(([id]) => !previousAssets.has(id));
          for (const [id, blob] of added) {
            const asset: DraftAsset = { blob: buffered?.get(id) ?? blob.slice(0, blob.size, blob.type) };
            if (blob instanceof File) asset.file = fileMetadata(blob);
            videoAssets.put(asset, [project.id, id]);
          }
          for (const id of previousAssets) {
            if (!media.has(id)) videoAssets.delete([project.id, id]);
          }
          drafts.put(value, project.id);
          const oldNames = previous?.additionalVideoNames ?? [];
          listChanged = !previous || oldNames.length !== names.length || oldNames.some((name, index) => name !== names[index]);
          return {
            id: project.id,
            toolPath: VIDEO_EDITOR,
            openedAt: previous?.openedAt ?? Math.max(Date.now(), newestAt + 1),
            size: file.size,
            files: [],
            draftBytes: extraBytes,
            additionalVideoNames: names.length ? names : undefined,
            video: { revision, assets: [...media.keys()] },
          };
        },
        () => listChanged,
      );
    let saved: boolean;
    try {
      saved = await save();
    } catch (error) {
      if (!isBlobStorageError(error)) throw error;
      // Private WebKit can reject Blob storage. Preserve the small-project
      // ArrayBuffer fallback and cap the memory it can use on one write.
      if (added.reduce((total, [, blob]) => total + blob.size, 0) > MAX_FILE_BYTES) return 'session';
      const buffered = new Map<string, BufferedBlob>();
      for (const [id, blob] of added) buffered.set(id, await bufferBlob(blob));
      saved = await save(buffered);
    }
    if (!saved) return 'conflict';
    project.revision = revision;
    return 'saved';
  } catch {
    return 'storage';
  }
}

/** extraBytes includes the draft's assets and metadata separately from the stored source file. */
export async function writeRecentDraft(file: File, toolPath: string, draft: unknown, extraBytes: number): Promise<boolean> {
  try {
    if (!Number.isSafeInteger(extraBytes) || extraBytes < 0 || file.size + extraBytes > MAX_FILE_BYTES) return false;
    const { assets, record } = collectDraftAssets(draft, toolPath, extraBytes);
    const id = await entryId([file], toolPath);
    const save = (value: unknown) =>
      saveEntry(
        id,
        (previous, _newestAt, drafts) => {
          if (!previous) return;
          drafts.put(value, id);
          return { ...previous, draftBytes: extraBytes };
        },
        () => false,
      );
    try {
      return await save(draft);
    } catch (error) {
      if (!isBlobStorageError(error)) throw error;
      for (const { blob, asset } of assets) asset.blob = await bufferBlob(blob);
      return await save(record);
    }
  } catch {
    return false;
  }
}
