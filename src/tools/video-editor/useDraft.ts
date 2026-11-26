import { useEffect, useRef, useState } from 'react';
import { readRecentDraft, rememberRecentFiles, writeRecentDraft } from '../../lib/recentFiles';
import type { Segment, VideoEdit } from './engine';

export const EDITOR_PATH = '/video/video-editor';

export interface Draft {
  edit: VideoEdit;
  trimBounds: Segment[];
  soundtrack: File | null;
  soundtrackDuration: number;
  format: 'mp4' | 'webm';
}

interface Save {
  file: File;
  opened: Promise<void>;
  draft: Draft | null;
  revision: number;
  saved: number;
  pending: Promise<boolean>;
}

export function useDraft() {
  const active = useRef<Save | null>(null);
  const timeout = useRef<number | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  async function restore(file: File, sample: boolean) {
    window.clearTimeout(timeout.current);
    active.current = null;
    setFailed(false);
    if (sample) return;
    const opened = rememberRecentFiles([file], EDITOR_PATH);
    active.current = { file, opened, draft: null, revision: 0, saved: 0, pending: Promise.resolve(true) };
    await opened;
    return readRecentDraft<Draft>(file, EDITOR_PATH);
  }

  function flush() {
    window.clearTimeout(timeout.current);
    const current = active.current;
    if (!current) return Promise.resolve(true);
    current.pending = current.pending.then(async () => {
      const { revision, draft } = current;
      if (!draft || current.saved === revision) return true;
      let saved = false;
      try {
        await current.opened;
        const bytes = (draft.soundtrack?.size ?? 0) + JSON.stringify(draft).length * 2;
        saved = await writeRecentDraft(current.file, EDITOR_PATH, draft, bytes);
      } catch {
        // Storage limits and denied browser storage can leave the live editor usable.
      }
      if (saved) current.saved = revision;
      if (active.current === current && revision === current.revision) setFailed(!saved);
      return saved;
    });
    return current.pending;
  }

  function schedule(draft: Draft) {
    const current = active.current;
    if (!current) return;
    current.draft = draft;
    current.revision++;
    window.clearTimeout(timeout.current);
    timeout.current = window.setTimeout(() => void flush(), 350);
  }

  useEffect(() => {
    function guard(event: BeforeUnloadEvent) {
      const current = active.current;
      if (!current || current.revision === current.saved) return;
      void flush();
      event.preventDefault();
    }

    function onHide() {
      if (document.visibilityState === 'hidden') void flush();
    }
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', guard);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', guard);
      void flush();
    };
  }, []);

  return { restore, schedule, flush, failed };
}
