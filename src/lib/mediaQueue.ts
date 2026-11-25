let mediaQueue: Promise<unknown> = Promise.resolve();

/** Run one browser media job at a time across Mediabunny and FFmpeg. */
export function withMediaJobLock<T>(task: () => Promise<T>): Promise<T> {
  const result = mediaQueue.then(task, task);
  mediaQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
