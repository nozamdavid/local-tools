import { useEffect, useRef, useState } from 'react';

import { readFrameRate } from './timeline';

export interface VideoSource {
  file: File;
  width: number;
  height: number;
  duration: number;
  frameRate: number;
}

const PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_FRAME_RATE = 30;
const NO_URLS: readonly string[] = [];

export function probeVideoSource(file: File, signal: AbortSignal): Promise<VideoSource> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let source: Omit<VideoSource, 'frameRate'> | undefined;
    let released = false;
    const timeout = window.setTimeout(() => {
      if (source) finish(source, DEFAULT_FRAME_RATE);
      else fail();
    }, PROBE_TIMEOUT_MS);

    function releaseVideo() {
      if (released) return;
      released = true;
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }

    function cleanup() {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', fail);
      releaseVideo();
    }

    function fail() {
      cleanup();
      reject(signal.aborted ? signal.reason : new Error('Could not decode the first video frame.'));
    }

    function finish(metadata: Omit<VideoSource, 'frameRate'>, rate: number) {
      cleanup();
      const frameRate = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_FRAME_RATE;
      resolve({ ...metadata, frameRate });
    }

    signal.addEventListener('abort', fail, { once: true });
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onerror = fail;
    video.onloadeddata = () => {
      const { videoWidth: width, videoHeight: height, duration } = video;
      if (![width, height, duration].every((value) => Number.isFinite(value) && value > 0)) {
        fail();
        return;
      }

      const metadata = { file, width, height, duration };
      source = metadata;
      releaseVideo();
      void readFrameRate(file).then(
        (rate) => finish(metadata, rate),
        () => finish(metadata, DEFAULT_FRAME_RATE),
      );
    };
    try {
      video.src = url;
    } catch {
      fail();
    }
  });
}

export function useSourceUrls(files: readonly File[]): readonly string[] {
  const urlsByFile = useRef(new Map<File, string>());
  const [snapshot, setSnapshot] = useState<{ files: readonly File[]; urls: readonly string[] }>();

  useEffect(() => {
    const urls = urlsByFile.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useEffect(() => {
    const urls = urlsByFile.current;
    const currentFiles = new Set(files);
    for (const [file, url] of urls) {
      if (currentFiles.has(file)) continue;
      URL.revokeObjectURL(url);
      urls.delete(file);
    }

    const orderedUrls = files.map((file) => {
      const existing = urls.get(file);
      if (existing) return existing;
      const url = URL.createObjectURL(file);
      urls.set(file, url);
      return url;
    });
    setSnapshot((previous) =>
      previous?.urls.length === orderedUrls.length && orderedUrls.every((url, index) => url === previous.urls[index])
        ? previous
        : { files: [...files], urls: orderedUrls },
    );
  }, [files]);

  if (!snapshot || files.length !== snapshot.files.length || !files.every((file, index) => file === snapshot.files[index])) {
    return NO_URLS;
  }
  return snapshot.urls;
}
