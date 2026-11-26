let mediaQueue: Promise<unknown> = Promise.resolve();

/** Run one browser media job at a time across Mediabunny and FFmpeg. */
export function withMediaJobLock<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason);

  let start: () => void = () => {};
  const result = mediaQueue.then(() => {
    start();
    signal?.throwIfAborted();
    return task();
  });
  mediaQueue = result.then(
    () => undefined,
    () => undefined,
  );
  if (!signal) return result;

  // Reject while queued without interrupting the job that owns the lock.
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    start = () => signal.removeEventListener('abort', abort);
    result.then(resolve, reject);
  });
}
