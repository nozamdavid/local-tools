import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { VideoEdit } from './engine';
import { buildTimeline, drawFrame, hasVideoFrame, locateTime, type Clip, type FrameSize } from './timeline';

type PendingSeek = { url: string | undefined; sourceTime: number; outputTime: number; applied: boolean };

export function usePreview(
  edit: VideoEdit,
  ready: boolean,
  reportError: (error: string) => void,
  sourceUrls: readonly string[],
  projectSize: FrameSize | null,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const soundtrackRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clipIndex = useRef(0);
  const pendingSeek = useRef<PendingSeek | null>(null);
  const playbackRequested = useRef(false);
  const playAttempt = useRef(0);
  const audioGraph = useRef<{ context: AudioContext; source: GainNode; soundtrack: GainNode } | null>(null);
  const audioFailed = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [time, setTime] = useState(0);
  const [activeSourceIndex, setActiveSourceIndex] = useState(0);
  const { clips, duration } = buildTimeline(edit);
  const waitingForSources = ready && sourceUrls.length === 0;

  function renderFrame() {
    if (ready && !waitingForSources && !pendingSeek.current && canvasRef.current && videoRef.current) {
      drawFrame(canvasRef.current, videoRef.current, edit, 1280, projectSize);
    }
  }

  function clearFrame() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: false });
    context?.resetTransform();
    context?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function pause() {
    playbackRequested.current = false;
    playAttempt.current++;
    videoRef.current?.pause();
    soundtrackRef.current?.pause();
    setPlaying(false);
  }

  function advanceSeek() {
    const video = videoRef.current;
    const request = pendingSeek.current;
    if (
      !video ||
      !request?.url ||
      video.getAttribute('src') !== request.url ||
      video.currentSrc !== video.src ||
      video.readyState < HTMLMediaElement.HAVE_METADATA
    ) {
      return;
    }
    if (!request.applied) {
      request.applied = true;
      const target = Math.min(request.sourceTime, video.duration);
      if (video.currentTime !== target) {
        video.currentTime = target;
        return;
      }
    }
    if (!hasVideoFrame(video)) return;
    pendingSeek.current = null;
    setSeeking(false);
    renderFrame();
    if (playbackRequested.current) playMedia(video, request.outputTime);
  }

  function loadSource(video: HTMLVideoElement, url: string | undefined) {
    if (!url) return;
    if (video.getAttribute('src') !== url || video.error) {
      playAttempt.current++;
      video.pause();
      clearFrame();
      video.src = url;
    }
    advanceSeek();
  }

  function requestSeek(clips: Clip[], index: number, sourceTime: number, outputTime: number, urls: readonly string[]) {
    const video = videoRef.current;
    if (!video) return;
    const sourceIndex = clips[index].sourceIndex ?? 0;
    const url = urls[sourceIndex];
    clipIndex.current = index;
    pendingSeek.current = { url, sourceTime, outputTime, applied: false };
    setActiveSourceIndex(sourceIndex);
    setSeeking(true);
    setTime(outputTime);
    soundtrackRef.current?.pause();
    loadSource(video, url);
  }

  function seek(outputTime: number, nextEdit = edit, index?: number, nextSourceUrls = sourceUrls) {
    if (nextEdit.segments.length === 0) return;
    pause();
    const timeline = buildTimeline(nextEdit);
    const nextTime = Math.max(0, Math.min(timeline.duration, outputTime));
    const target =
      index === undefined ? locateTime(timeline.clips, nextTime, nextEdit.speed) : { index, source: timeline.clips[index].start };
    requestSeek(timeline.clips, target.index, target.source, nextTime, nextSourceUrls);
  }

  function updateAudio(video: HTMLVideoElement, outputTime: number, keepPlaying: boolean) {
    const fadeIn = edit.fadeIn ? Math.min(1, outputTime / Math.min(edit.fadeIn, duration)) : 1;
    const fadeOut = edit.fadeOut ? Math.max(0, Math.min(1, (duration - outputTime) / Math.min(edit.fadeOut, duration))) : 1;
    const gain = edit.volume * fadeIn * fadeOut;
    const soundtrack = soundtrackRef.current;
    const graph = audioGraph.current;
    if (graph) {
      graph.source.gain.value = gain;
      graph.soundtrack.gain.value = edit.audioVolume;
    } else {
      video.volume = gain;
      if (soundtrack) soundtrack.volume = edit.audioVolume;
    }
    if (!soundtrack?.currentSrc || soundtrack.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const soundtrackTime = outputTime - edit.audioOffset;
    if (!keepPlaying || video.seeking || soundtrackTime < 0 || soundtrackTime >= soundtrack.duration) {
      soundtrack.pause();
      return;
    }
    if (Math.abs(soundtrack.currentTime - soundtrackTime) > (soundtrack.paused ? 0.01 : 0.12)) soundtrack.currentTime = soundtrackTime;
    if (soundtrack.paused && !audioFailed.current) {
      void soundtrack.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        audioFailed.current = true;
        reportError('Could not play the soundtrack in this browser.');
      });
    }
  }

  function playMedia(video: HTMLVideoElement, outputTime: number) {
    video.playbackRate = edit.speed;
    updateAudio(video, outputTime, true);
    if (!video.paused && !video.ended) return;
    const attempt = ++playAttempt.current;
    void video.play().catch((error: unknown) => {
      if (attempt !== playAttempt.current) return;
      pause();
      if (!(error instanceof DOMException && error.name === 'AbortError')) reportError('Could not play this video in your browser.');
    });
  }

  function togglePlayback() {
    const video = videoRef.current;
    const soundtrack = soundtrackRef.current;
    if (!ready || waitingForSources || !video || !soundtrack) return;
    if (playbackRequested.current) {
      pause();
      return;
    }

    if (!audioGraph.current && typeof AudioContext !== 'undefined') {
      try {
        const context = new AudioContext();
        const source = context.createGain();
        const music = context.createGain();
        context.createMediaElementSource(video).connect(source).connect(context.destination);
        context.createMediaElementSource(soundtrack).connect(music).connect(context.destination);
        audioGraph.current = { context, source, soundtrack: music };
        video.volume = 1;
        soundtrack.volume = 1;
      } catch {
        // Keep the native element volume controls when Web Audio is unavailable.
      }
    }
    void audioGraph.current?.context.resume().catch(() => undefined);
    audioFailed.current = false;
    playbackRequested.current = true;
    setPlaying(true);
    if (time >= duration && clips.length) {
      requestSeek(clips, 0, clips[0].start, 0, sourceUrls);
    } else if (!pendingSeek.current) {
      playMedia(video, time);
    }
  }

  function tick() {
    const video = videoRef.current;
    let clip = clips[clipIndex.current];
    if (!ready || waitingForSources || !playbackRequested.current || !video || !clip || pendingSeek.current) return;
    if (!hasVideoFrame(video)) {
      soundtrackRef.current?.pause();
      return;
    }
    while (video.currentTime >= clip.end || video.ended) {
      const nextIndex = clipIndex.current + 1;
      const next = clips[nextIndex];
      if (!next) {
        setTime(duration);
        pause();
        renderFrame();
        return;
      }
      if ((next.sourceIndex ?? 0) !== (clip.sourceIndex ?? 0) || next.start !== clip.end || video.ended) {
        requestSeek(clips, nextIndex, next.start, next.at, sourceUrls);
        return;
      }
      clipIndex.current = nextIndex;
      clip = next;
    }
    const output = clip.at + Math.max(0, video.currentTime - clip.start) / edit.speed;
    updateAudio(video, output, true);
    setTime(output);
    renderFrame();
  }

  const onTick = useEffectEvent(tick);
  const syncPreview = useEffectEvent(() => {
    const video = videoRef.current;
    if (!video) return;
    if (waitingForSources) {
      if (playbackRequested.current) pause();
      clearFrame();
      return;
    }
    if (!ready || clips.length === 0) {
      if (sourceUrls.length || (!pendingSeek.current && !video.hasAttribute('src'))) return;
      pause();
      pendingSeek.current = null;
      clipIndex.current = 0;
      setActiveSourceIndex(0);
      setSeeking(false);
      setTime(0);
      video.removeAttribute('src');
      video.load();
      clearFrame();
      return;
    }
    const request = pendingSeek.current;
    if (request && !request.url) {
      request.url = sourceUrls[activeSourceIndex];
      loadSource(video, request.url);
    } else if (!request && video.getAttribute('src') !== sourceUrls[activeSourceIndex]) {
      const target = locateTime(clips, time, edit.speed);
      const url = sourceUrls[clips[target.index].sourceIndex ?? 0];
      if (url) requestSeek(clips, target.index, target.source, time, sourceUrls);
    }
    renderFrame();
    updateAudio(video, time, playbackRequested.current && !pendingSeek.current);
  });

  useLayoutEffect(() => {
    syncPreview();
  }, [edit, projectSize, ready, sourceUrls]);

  useEffect(() => {
    if (!playing) return;
    let frame: number;
    function loop() {
      onTick();
      frame = requestAnimationFrame(loop);
    }
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(
    () => () => {
      void audioGraph.current?.context.close();
      audioGraph.current = null;
    },
    [],
  );

  async function copyFrame() {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    if (!ready || waitingForSources || !video || pendingSeek.current || !drawFrame(canvas, video, edit, Infinity, projectSize)) {
      throw new Error('Frame unavailable');
    }
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the frame'))), 'image/png'),
    );
  }

  return {
    videoRef,
    soundtrackRef,
    canvasRef,
    time,
    playing,
    seeking: waitingForSources || seeking,
    activeSourceIndex,
    seek,
    pause,
    togglePlayback,
    copyFrame,
    mediaEvents: {
      onLoadedMetadata: advanceSeek,
      onLoadedData: advanceSeek,
      onCanPlay: advanceSeek,
      onSeeked: advanceSeek,
      onEnded: tick,
      onError: () => {
        if (!videoRef.current?.error) return;
        pause();
        pendingSeek.current = null;
        setSeeking(false);
        reportError('This video could not be opened. Try an MP4 with H.264 video or a WebM file.');
      },
    },
  };
}
