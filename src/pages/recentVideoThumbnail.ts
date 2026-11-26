const MAX_EDGE = 144;
const FRAME_TIMEOUT_MS = 4000;

let pending = Promise.resolve();

export function recentVideoThumbnail(blob: Blob, signal: AbortSignal): Promise<string | undefined> {
  // Decode one stored video at a time, including when Home mounts with a full list.
  const result = pending.then(() => {
    if (!signal.aborted) return captureFrame(blob, signal);
  });
  pending = result.then(
    () => {},
    () => {},
  );
  return result;
}

function captureFrame(blob: Blob, signal: AbortSignal): Promise<string | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const source = URL.createObjectURL(blob);
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const finish = (preview?: string) => {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', stop);
      video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(source);
      resolve(preview);
    };
    const stop = () => finish();
    const timeout = window.setTimeout(stop, FRAME_TIMEOUT_MS);

    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) {
        stop();
      } else if (Number.isFinite(video.duration) && video.duration > 0) {
        // Stay near the start while avoiding a potentially black opening frame.
        video.currentTime = Math.min(0.5, video.duration / 4);
      }
    };
    const draw = () => {
      if (video.seeking || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      try {
        const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return stop();
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.78));
      } catch {
        stop();
      }
    };
    video.onloadeddata = video.onseeked = draw;
    video.onerror = stop;
    signal.addEventListener('abort', stop, { once: true });
    video.src = source;
  });
}
