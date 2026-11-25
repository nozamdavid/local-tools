import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  instances: [] as Array<{ terminated: boolean; finish?: () => void }>,
  executions: 0,
  failNextLoad: false,
}));

vi.mock('@ffmpeg/util', () => ({ toBlobURL: async (url: string) => url }));
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    loaded = false;
    terminated = false;
    finish?: () => void;
    reject?: (error: Error) => void;
    constructor() {
      state.instances.push(this);
    }
    async load() {
      if (state.failNextLoad) {
        state.failNextLoad = false;
        throw new Error('load failed');
      }
      this.loaded = true;
    }
    on() {}
    off() {}
    async writeFile() {}
    async deleteFile() {}
    async readFile() {
      return new Uint8Array([1, 2, 3]);
    }
    exec() {
      state.executions++;
      return new Promise<number>((resolve, reject) => {
        this.finish = () => resolve(0);
        this.reject = reject;
      });
    }
    terminate() {
      this.terminated = true;
      this.loaded = false;
      this.reject?.(new Error('terminated'));
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  state.instances = [];
  state.executions = 0;
  state.failNextLoad = false;
});

it('can load FFmpeg again after a worker fails to start', async () => {
  const { getFFmpeg } = await import('./ffmpeg');
  state.failNextLoad = true;

  await expect(getFFmpeg()).rejects.toThrow('load failed');
  expect(state.instances[0].terminated).toBe(true);
  await expect(getFFmpeg()).resolves.toMatchObject({ loaded: true });
  expect(state.instances).toHaveLength(2);
});

describe('FFmpeg cancellation', () => {
  it('terminates an active job and gives the next job a fresh worker', async () => {
    const { runFFmpeg } = await import('./ffmpeg');
    const controller = new AbortController();
    const first = runFFmpeg({ inputs: [], args: [], output: 'first.wav', signal: controller.signal });
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(state.executions).toBe(1));
    controller.abort();
    await rejected;
    expect(state.instances[0].terminated).toBe(true);

    const next = runFFmpeg({ inputs: [], args: [], output: 'next.wav' });
    await vi.waitFor(() => expect(state.executions).toBe(2));
    expect(state.instances).toHaveLength(2);
    state.instances[1].finish?.();
    expect(await (await next).arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
  });

  it('skips an aborted queued job without terminating the current job', async () => {
    const { runFFmpeg } = await import('./ffmpeg');
    const first = runFFmpeg({ inputs: [], args: [], output: 'first.wav' });
    await vi.waitFor(() => expect(state.executions).toBe(1));
    const controller = new AbortController();
    const queued = runFFmpeg({ inputs: [], args: [], output: 'queued.wav', signal: controller.signal });
    const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    expect(state.instances[0].terminated).toBe(false);
    state.instances[0].finish?.();
    await first;
    await rejected;
    expect(state.executions).toBe(1);
    expect(state.instances[0].terminated).toBe(false);
  });
});
