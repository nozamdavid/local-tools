export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  hasAudio?: boolean;
}

export async function getVideoMeta(file: File | Blob): Promise<VideoMeta> {
  let probedHasAudio: boolean | undefined;
  try {
    const { probeMedia } = await import('./mediabunny');
    const summary = await probeMedia(file);
    probedHasAudio = summary?.tracks.some((track) => track.type === 'audio');
    const video =
      summary?.tracks.find((track) => track.type === 'video' && track.primary) ?? summary?.tracks.find((track) => track.type === 'video');
    if (summary && summary.duration !== null && Number.isFinite(summary.duration) && video?.width && video.height) {
      return {
        duration: summary.duration,
        width: Math.round(video.width),
        height: Math.round(video.height),
        hasAudio: probedHasAudio,
      };
    }
  } catch {
    // Unsupported formats continue through the browser metadata fallback.
  }

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const url = URL.createObjectURL(file);

    const cleanup = () => {
      clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;

      let hasAudio = probedHasAudio;
      const anyVideo = video as unknown as {
        mozHasAudio?: boolean;
        webkitAudioDecodedByteCount?: number;
        audioTracks?: { length: number };
      };
      if (hasAudio === undefined) {
        if (anyVideo.audioTracks) {
          hasAudio = anyVideo.audioTracks.length > 0;
        } else if (typeof anyVideo.mozHasAudio === 'boolean') {
          hasAudio = anyVideo.mozHasAudio;
        } else if ((anyVideo.webkitAudioDecodedByteCount ?? 0) > 0) {
          // At loadedmetadata a zero count does not tell us whether an audio track exists.
          hasAudio = true;
        }
      }

      cleanup();
      resolve({ duration, width, height, hasAudio });
    };

    const fail = () => {
      cleanup();
      reject(new Error('Failed to load video metadata'));
    };
    const timeout = setTimeout(fail, 10000);
    video.onerror = fail;

    video.src = url;
  });
}

export async function detectVideoAudio(file: File, meta?: VideoMeta): Promise<boolean> {
  if (meta?.hasAudio !== undefined) return meta.hasAudio;
  try {
    const header = await file.slice(0, 2 * 1024 * 1024).arrayBuffer();
    const text = new TextDecoder('latin1').decode(header);
    return /soun|mp4a|A_VORBIS|A_OPUS|A_AAC/.test(text);
  } catch {
    return false;
  }
}
