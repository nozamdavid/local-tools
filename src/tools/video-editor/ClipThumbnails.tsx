import { useEffect, useState } from 'react';

import styles from './ClipThumbnails.module.css';

type ThumbnailFrame = { time: number; src: string };
type ThumbnailListener = (frames: readonly ThumbnailFrame[]) => void;
type ThumbnailSource = {
  listeners: Set<ThumbnailListener>;
  controller?: AbortController;
  frames?: readonly ThumbnailFrame[];
};

const MAX_FRAMES = 8;
const MAX_FRAME_EDGE = 96;
const DECODE_TIMEOUT_MS = 8_000;
const NO_FRAMES: readonly ThumbnailFrame[] = [];
const thumbnailSources = new Map<string, ThumbnailSource>();
let decoding = false;

function waitForVideo(
  video: HTMLVideoElement,
  event: 'loadedmetadata' | 'seeked',
  signal: AbortSignal,
  start: () => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const finish = (ready: boolean) => {
      video.removeEventListener(event, onReady);
      video.removeEventListener('error', onFailure);
      signal.removeEventListener('abort', onFailure);
      resolve(ready);
    };
    const onReady = () => finish(true);
    const onFailure = () => finish(false);

    video.addEventListener(event, onReady);
    video.addEventListener('error', onFailure);
    signal.addEventListener('abort', onFailure);
    try {
      start();
    } catch {
      onFailure();
    }
  });
}

async function readFrames(video: HTMLVideoElement, sourceUrl: string, signal: AbortSignal): Promise<ThumbnailFrame[]> {
  const frames: ThumbnailFrame[] = [];
  const loaded = await waitForVideo(video, 'loadedmetadata', signal, () => {
    video.src = sourceUrl;
  });
  if (!loaded || !video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) {
    return frames;
  }

  const canvas = document.createElement('canvas');
  const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return frames;

  const duration = video.duration;
  for (let index = 0; index < MAX_FRAMES; index += 1) {
    const time = ((index + 0.5) / MAX_FRAMES) * duration;
    const seeked = await waitForVideo(video, 'seeked', signal, () => {
      video.currentTime = time;
    });
    if (!seeked || signal.aborted) break;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) continue;

    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push({ time, src: canvas.toDataURL('image/jpeg', 0.7) });
    } catch {
      break;
    }
  }
  return frames;
}

async function decodeThumbnails(sourceUrl: string, controller: AbortController): Promise<readonly ThumbnailFrame[]> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  const timeout = window.setTimeout(() => controller.abort(), DECODE_TIMEOUT_MS);
  try {
    return await readFrames(video, sourceUrl, controller.signal);
  } finally {
    window.clearTimeout(timeout);
    video.removeAttribute('src');
    video.load();
  }
}

function decodeNextSource() {
  if (decoding) return;

  for (const [url, source] of thumbnailSources) {
    if (source.frames || !source.listeners.size) continue;

    const controller = new AbortController();
    source.controller = controller;
    decoding = true;
    void decodeThumbnails(url, controller)
      .catch(() => NO_FRAMES)
      .then((frames) => {
        source.frames = frames;
        for (const listener of source.listeners) listener(frames);
      })
      .finally(() => {
        source.controller = undefined;
        decoding = false;
        decodeNextSource();
      });
    return;
  }
}

function subscribeToThumbnails(sourceUrl: string, listener: ThumbnailListener) {
  let source = thumbnailSources.get(sourceUrl);
  if (!source) {
    source = { listeners: new Set() };
    thumbnailSources.set(sourceUrl, source);
  }

  const entry = source;
  entry.listeners.add(listener);
  if (entry.frames) listener(entry.frames);
  else decodeNextSource();

  return () => {
    entry.listeners.delete(listener);
    // A split or reorder can replace subscribers within the same commit.
    queueMicrotask(() => {
      if (entry.listeners.size || thumbnailSources.get(sourceUrl) !== entry) return;
      thumbnailSources.delete(sourceUrl);
      entry.controller?.abort();
    });
  };
}

export function useClipThumbnails(sourceUrl: string | undefined | null, duration: number): readonly ThumbnailFrame[] {
  const [result, setResult] = useState<{ sourceUrl: string; frames: readonly ThumbnailFrame[] }>();
  const sourceReady = Number.isFinite(duration) && duration > 0;

  useEffect(() => {
    if (!sourceUrl?.startsWith('blob:') || !sourceReady) return;
    return subscribeToThumbnails(sourceUrl, (frames) => setResult({ sourceUrl, frames }));
  }, [sourceUrl, sourceReady]);

  return sourceReady && result && result.sourceUrl === sourceUrl ? result.frames : NO_FRAMES;
}

export function ClipThumbnails({ frames, start, end }: { frames: readonly ThumbnailFrame[]; start: number; end: number }) {
  const visibleFrames = frames.filter(({ time }) => time >= start && time < end);
  if (!visibleFrames.length) return null;

  return (
    <span className={styles.strip} aria-hidden="true">
      {visibleFrames.map(({ time, src }) => (
        <img key={time} src={src} alt="" draggable={false} />
      ))}
    </span>
  );
}

export function SourceClipThumbnails({
  sourceUrl,
  duration,
  start,
  end,
}: {
  sourceUrl: string | undefined;
  duration: number;
  start: number;
  end: number;
}) {
  const frames = useClipThumbnails(sourceUrl, duration);
  return <ClipThumbnails frames={frames} start={start} end={end} />;
}
