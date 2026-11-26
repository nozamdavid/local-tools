import { useEffect, useRef, useState } from 'react';
import { createRecentDraftProjectId, readVideoDraft, videoDraftProject, writeVideoDraft, type VideoDraftSave } from '../../lib/recentFiles';
import type { Segment, VideoEdit } from './engine';
import type { VideoSource } from './videoSources';

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
  kind: 'sample' | 'promoted-sample' | 'project';
  project: ReturnType<typeof videoDraftProject> | null;
  draft: Draft | null;
  revision: number;
  saved: number;
  pending: Promise<boolean>;
}

export function useDraft() {
  const active = useRef<Save | null>(null);
  const timeout = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<Exclude<VideoDraftSave, 'saved'> | null>(null);

  function begin(file: File, kind: Save['kind'], projectId?: string) {
    window.clearTimeout(timeout.current);
    setStatus(null);
    active.current = {
      file,
      kind,
      project: kind === 'sample' ? null : videoDraftProject(file, projectId),
      draft: null,
      revision: 0,
      saved: 0,
      pending: Promise.resolve(true),
    };
    return active.current;
  }

  async function restore(file: File, sample: boolean) {
    const current = begin(file, sample ? 'sample' : 'project');
    if (!current.project) return;
    try {
      const project = await current.project;
      const draft = await readVideoDraft<Draft>(file, project);
      if (active.current === current && project.revision === null) {
        current.revision++;
        void flush();
      }
      return draft;
    } catch {
      if (active.current === current) {
        current.revision++;
        setStatus('storage');
      }
      return null;
    }
  }

  function startProject(anchor: File) {
    begin(anchor, 'project', createRecentDraftProjectId());
  }

  async function promoteSample(anchor: File): Promise<void> {
    const current = active.current;
    if (current?.file !== anchor || current.kind !== 'sample') return;
    current.project = videoDraftProject(anchor, createRecentDraftProjectId());
    current.kind = 'promoted-sample';
  }

  function flush() {
    window.clearTimeout(timeout.current);
    const current = active.current;
    if (!current) return Promise.resolve(true);
    current.pending = current.pending.then(async () => {
      const { revision, draft } = current;
      if (!current.project || current.saved === revision) return true;
      if (current.kind === 'promoted-sample' && !draft?.additionalSources?.length) {
        current.saved = revision;
        if (active.current === current) setStatus(null);
        return true;
      }
      let result: VideoDraftSave;
      try {
        result = await writeVideoDraft(current.file, await current.project, draft);
      } catch {
        result = 'storage';
      }
      if (result === 'saved') {
        current.saved = revision;
        current.kind = 'project';
      }
      if (active.current === current && revision === current.revision) setStatus(result === 'saved' ? null : result);
      return result === 'saved' || !draft;
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
      if (!current?.draft || current.revision === current.saved) return;
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

  return { restore, startProject, promoteSample, schedule, flush, status };
}
