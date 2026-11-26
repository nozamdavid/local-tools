import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { VideoEdit } from './engine';
import { buildTimeline, drawFrame, locateTime } from './timeline';

export function usePreview(edit: VideoEdit, ready: boolean, reportError: (error: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const soundtrackRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceIndex = useRef(0);
  const audioGraph = useRef<{ context: AudioContext; source: GainNode; soundtrack: GainNode } | null>(null);
  const audioFailed = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [time, setTime] = useState(0);
  const { clips, duration } = buildTimeline(edit);

  function renderFrame() {
    if (ready && canvasRef.current && videoRef.current) drawFrame(canvasRef.current, videoRef.current, edit, 1280);
  }

  function pause() {
    videoRef.current?.pause();
    soundtrackRef.current?.pause();
    setPlaying(false);
  }

  function seek(outputTime: number, nextEdit = edit, clipIndex?: number) {
    const video = videoRef.current;
    if (!video || nextEdit.segments.length === 0) return;
    pause();
    const timeline = buildTimeline(nextEdit);
    const nextTime = Math.max(0, Math.min(timeline.duration, outputTime));
    const target =
      clipIndex === undefined
        ? locateTime(timeline.clips, nextTime, nextEdit.speed)
        : { index: clipIndex, source: timeline.clips[clipIndex].start };
    sourceIndex.current = target.index;
    video.currentTime = target.source;
    setTime(nextTime);
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

  async function togglePlayback() {
    const video = videoRef.current;
    const soundtrack = soundtrackRef.current;
    if (!ready || !video || !soundtrack) return;
    if (!video.paused) {
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
    if (time >= duration) seek(0);
    video.playbackRate = edit.speed;
    updateAudio(video, time >= duration ? 0 : time, true);
    try {
      await video.play();
      setPlaying(!video.paused);
    } catch (error) {
      pause();
      if (!(error instanceof DOMException && error.name === 'AbortError')) reportError('Could not play this video in your browser.');
    }
  }

  function tick() {
    const video = videoRef.current;
    let clip = clips[sourceIndex.current];
    if (!video || !clip) return;
    if (video.seeking) {
      soundtrackRef.current?.pause();
      return;
    }
    while (video.currentTime >= clip.end || video.ended) {
      const next = clips[sourceIndex.current + 1];
      if (!next) {
        setTime(duration);
        pause();
        renderFrame();
        return;
      }
      sourceIndex.current++;
      if (next.start !== clip.end || video.ended) {
        setTime(next.at);
        video.currentTime = next.start;
        soundtrackRef.current?.pause();
        if (video.paused) void video.play().catch(pause);
        return;
      }
      clip = next;
    }
    const output = clip.at + Math.max(0, video.currentTime - clip.start) / edit.speed;
    updateAudio(video, output, true);
    setTime(output);
    renderFrame();
  }

  const onTick = useEffectEvent(tick);
  const onRedraw = useEffectEvent(() => {
    renderFrame();
    const video = videoRef.current;
    if (ready && video) updateAudio(video, time, playing);
  });

  useEffect(() => {
    onRedraw();
  }, [edit, ready]);

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
    if (!video || video.seeking || !drawFrame(canvas, video, edit)) throw new Error('Frame unavailable');
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
    seeking,
    seek,
    pause,
    togglePlayback,
    copyFrame,
    mediaEvents: {
      onLoadedData: renderFrame,
      onSeeking: () => setSeeking(true),
      onSeeked: () => {
        setSeeking(false);
        renderFrame();
      },
    },
  };
}
