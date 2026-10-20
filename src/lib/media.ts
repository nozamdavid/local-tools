export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  hasAudio?: boolean;
}

export function getVideoMeta(file: File | Blob): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const url = URL.createObjectURL(file);

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;

      let hasAudio: boolean | undefined = undefined;
      const anyVideo = video as unknown as {
        mozHasAudio?: boolean;
        webkitAudioDecodedByteCount?: number;
        audioTracks?: { length: number };
      };
      if (anyVideo.audioTracks && typeof anyVideo.audioTracks.length === 'number') {
        hasAudio = anyVideo.audioTracks.length > 0;
      } else if (typeof anyVideo.mozHasAudio !== 'undefined') {
        hasAudio = anyVideo.mozHasAudio;
      } else if (typeof anyVideo.webkitAudioDecodedByteCount !== 'undefined') {
        hasAudio = anyVideo.webkitAudioDecodedByteCount > 0;
      }

      cleanup();
      resolve({ duration, width, height, hasAudio });
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to load video metadata'));
    };

    video.src = url;
  });
}
