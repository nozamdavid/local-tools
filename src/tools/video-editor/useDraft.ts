import { useEffect, useRef, useState } from 'react';
import { createRecentDraftProjectId, readRecentDraft, rememberRecentFiles, writeRecentDraft } from '../../lib/recentFiles';
import type { Segment, VideoEdit } from './engine';
import type { VideoSource } from './videoSources';

export const EDITOR_PATH = '/video/video-editor';

export interface Draft {
  edit: VideoEdit;
  trimBounds: Segment[];
  soundtrack: File | null;
  soundtrackDuration: number;
  format: 'mp4' | 'webm';
  additionalSources?: VideoSource[];
}

interface Save {
  file: File;
  kind: 'sample' | 'promoted-sample' | 'new-project' | 'project';
  projectId?: string;
  opened: Promise<void> | null;
  draft: Draft | null;
  revision: number;
  saved: number;
  pending: Promise<boolean>;
}

export function useDraft() {
  const active = useRef<Save | null>(null);
  const timeout = useRef<number | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  function begin(file: File, kind: Save['kind'], projectId?: string) {
    window.clearTimeout(timeout.current);
    setFailed(false);
    active.current = {
      file,
      kind,
      projectId,
      opened: kind === 'project' ? rememberRecentFiles([file], EDITOR_PATH) : null,
      draft: null,
      revision: 0,
      saved: 0,
      pending: Promise.resolve(true),
    };
    return active.current;
  }

  async function restore(file: File, sample: boolean) {
    const current = begin(file, sample ? 'sample' : 'project');
    if (sample) return;
    await current.opened;
    return readRecentDraft<Draft>(file, EDITOR_PATH);
  }

  function startProject(anchor: File) {
    begin(anchor, 'new-project', createRecentDraftProjectId());
  }

  async function promoteSample(anchor: File): Promise<void> {
    const current = active.current;
    if (current?.file !== anchor || current.kind !== 'sample') return;
    current.projectId = createRecentDraftProjectId();
    current.kind = 'promoted-sample';
  }

  function flush() {
    window.clearTimeout(timeout.current);
    const current = active.current;
    if (!current) return Promise.resolve(true);
    current.pending = current.pending.then(async () => {
      const { revision, draft } = current;
      if (!draft || current.saved === revision) return true;
      const createProject = current.kind === 'new-project' || current.kind === 'promoted-sample';
      let saved = true;
      if (current.kind !== 'promoted-sample' || draft.additionalSources?.length) {
        try {
          await current.opened;
          const sourceBytes = draft.additionalSources?.reduce((total, { file }) => total + file.size, 0) ?? 0;
          const bytes = sourceBytes + (draft.soundtrack?.size ?? 0) + JSON.stringify(draft).length * 2;
          const project = current.projectId ? { id: current.projectId, create: createProject } : undefined;
          saved = await writeRecentDraft(current.file, EDITOR_PATH, draft, bytes, project);
          if (saved) current.kind = 'project';
        } catch {
          saved = false;
        }
      }
      if (saved) current.saved = revision;
      if (active.current === current && revision === current.revision) setFailed(!saved);
      return saved;
    });
    return current.pending;
  }

  function schedule(draft: Draft) {
    const current = active.current;
    if (!current || current.kind === 'sample') return;
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

  return { restore, startProject, promoteSample, schedule, flush, failed };
}
