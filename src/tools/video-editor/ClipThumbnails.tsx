import { useEffect, useState } from 'react';

import styles from './ClipThumbnails.module.css';

type ThumbnailFrame = { time: number; src: string };

const MAX_FRAMES = 8;
const MAX_FRAME_EDGE = 96;
const DECODE_TIMEOUT_MS = 8_000;
const NO_FRAMES: readonly ThumbnailFrame[] = [];

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

export function useClipThumbnails(sourceUrl: string | undefined | null, duration: number): readonly ThumbnailFrame[] {
  const [result, setResult] = useState<{ sourceUrl: string; frames: readonly ThumbnailFrame[] }>();
  const sourceReady = Number.isFinite(duration) && duration > 0;

  useEffect(() => {
    if (!sourceUrl?.startsWith('blob:') || !sourceReady) return;

    const video = document.createElement('video');
    const controller = new AbortController();
    let active = true;

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const timeout = window.setTimeout(() => controller.abort(), DECODE_TIMEOUT_MS);
    const releaseVideo = () => {
      window.clearTimeout(timeout);
      if (video.hasAttribute('src')) {
        video.removeAttribute('src');
        video.load();
      }
    };

    void readFrames(video, sourceUrl, controller.signal)
      .catch(() => NO_FRAMES)
      .then((frames) => {
        if (active) setResult({ sourceUrl, frames });
      })
      .finally(releaseVideo);

    return () => {
      active = false;
      controller.abort();
      releaseVideo();
    };
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
