import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useJob } from './useJob';

const hooks = vi.hoisted(() => ({
  setters: [] as ReturnType<typeof vi.fn>[],
  cleanup: undefined as (() => void) | undefined,
}));

vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const setter = vi.fn();
    hooks.setters.push(setter);
    return [initial, setter];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => () => void) => {
    hooks.cleanup = effect();
  },
}));

beforeEach(() => {
  hooks.setters = [];
  hooks.cleanup = undefined;
});

function deferredBlob() {
  let resolve!: (blob: Blob) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Blob>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useJob asynchronous results', () => {
  it('ignores progress and completion from a reset job', async () => {
    const job = useJob();
    const pending = deferredBlob();
    let reportProgress!: (ratio: number) => void;
    const running = job.run((progress) => {
      reportProgress = progress;
      return pending.promise;
    });
    job.reset();
    hooks.setters.forEach((setter) => setter.mockClear());
    reportProgress(0.8);
    pending.resolve(new Blob(['old pages']));
    await running;
    hooks.setters.forEach((setter) => expect(setter).not.toHaveBeenCalled());
  });

  it('keeps a newer result when the previous run fails later', async () => {
    const job = useJob();
    const old = deferredBlob();
    const running = job.run(() => old.promise);
    const current = new Blob(['current pages']);
    await job.run(async () => current);
    expect(hooks.setters[3]).toHaveBeenLastCalledWith(current);
    hooks.setters.forEach((setter) => setter.mockClear());
    old.reject(new Error('Old job failed'));
    await running;
    hooks.setters.forEach((setter) => expect(setter).not.toHaveBeenCalled());
  });

  it('ignores completion after unmount', async () => {
    const job = useJob();
    const pending = deferredBlob();
    const running = job.run(() => pending.promise);
    hooks.cleanup?.();
    hooks.setters.forEach((setter) => setter.mockClear());
    pending.resolve(new Blob());
    await running;
    hooks.setters.forEach((setter) => expect(setter).not.toHaveBeenCalled());
  });
});
