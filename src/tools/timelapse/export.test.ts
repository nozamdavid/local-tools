import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { canvasToBlob, decodeImage } from '../../lib/image';
import { exportTimelapse } from './export';

type Core = {
  FS: {
    readFile(name: string): Uint8Array;
    writeFile(name: string, bytes: Uint8Array): void;
    unlink(name: string): void;
  };
  exec(...args: string[]): number;
  ffprobe(...args: string[]): number;
  reset(): void;
  setLogger(callback: (event: { message: string }) => void): void;
};

let core: Core;

vi.mock('@ffmpeg/util', () => ({ toBlobURL: async (url: string) => url }));
// Use the bundled core directly in Vitest, where the browser worker transport is unavailable.
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    loaded = false;
    async load() {
      this.loaded = true;
    }
    terminate() {
      this.loaded = false;
    }
    on(event: string, callback: (event: { message: string }) => void) {
      if (event === 'log') core.setLogger(callback);
    }
    off(event: string) {
      if (event === 'log') core.setLogger(() => {});
    }
    async writeFile(name: string, bytes: Uint8Array) {
      core.FS.writeFile(name, bytes);
    }
    async readFile(name: string) {
      return core.FS.readFile(name);
    }
    async deleteFile(name: string) {
      core.FS.unlink(name);
    }
    async exec(args: string[]) {
      const code = core.exec(...args);
      core.reset();
      return code;
    }
  },
}));

vi.mock('../../lib/image', () => ({ canvasToBlob: vi.fn(), decodeImage: vi.fn() }));

let color: string;
const ctx = {
  save() {},
  resetTransform() {},
  fillRect() {},
  scale() {},
  translate() {},
  transform() {},
  restore() {},
  drawImage(image: { color: string }) {
    color = image.color;
  },
};
const settings = { angle: 90, crop: { x: 0, y: 0, width: 0.5, height: 1 } };
const files = [new File([], 'z-red.jpg'), new File([], 'a-blue.jpg')];

function execute(...args: string[]) {
  const messages: string[] = [];
  core.setLogger(({ message }) => messages.push(message));
  const code = core.exec('-hide_banner', ...args);
  core.reset();
  core.setLogger(() => {});
  expect(code, messages.join('\n')).toBe(0);
}

beforeAll(async () => {
  vi.stubGlobal('self', { location: { href: '' } });
  vi.stubGlobal('VideoEncoder', undefined);
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
  const require = createRequire(import.meta.url);
  const createCore = require('@ffmpeg/core') as (options: { wasmBinary: Uint8Array }) => Promise<Core>;
  core = await createCore({ wasmBinary: readFileSync(require.resolve('@ffmpeg/core/wasm')) });
  vi.mocked(decodeImage).mockImplementation(async (file) => {
    const red = file.name.startsWith('z');
    return { naturalWidth: 96, naturalHeight: red ? 64 : 32, color: red ? 'red' : 'blue' } as unknown as HTMLImageElement;
  });
  vi.mocked(canvasToBlob).mockImplementation(async (canvas) => {
    execute('-f', 'lavfi', '-i', `color=${color}:s=${canvas.width}x${canvas.height}`, '-frames:v', '1', 'fixture.jpg');
    return new Blob([new Uint8Array(core.FS.readFile('fixture.jpg'))], { type: 'image/jpeg' });
  });
}, 15000);

afterAll(() => vi.unstubAllGlobals());

it.each([24, 29.97])('encodes ordered repeated photos as H.264 at %s fps', async (fps) => {
  const progress = vi.fn();
  const output = await exportTimelapse(files, settings, fps, 3, new AbortController().signal, progress);
  expect(output.type).toBe('video/mp4');
  expect(progress).toHaveBeenLastCalledWith(1);

  core.FS.writeFile('result.mp4', new Uint8Array(await output.arrayBuffer()));
  expect(core.ffprobe('-v', 'error', '-show_streams', '-of', 'json', '-o', 'probe.json', 'result.mp4')).toBeLessThanOrEqual(0);
  core.reset();
  const { streams } = JSON.parse(new TextDecoder().decode(core.FS.readFile('probe.json')));
  core.FS.unlink('probe.json');
  expect(streams).toMatchObject([{ codec_name: 'h264', width: 32, height: 96, nb_frames: '6' }]);
  expect(Number(streams[0].duration)).toBeCloseTo(6 / fps, 5);

  execute('-i', 'result.mp4', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'colors.rgb');
  const pixels = core.FS.readFile('colors.rgb');
  for (let frame = 0; frame < 6; frame++) {
    const offset = (frame * 32 * 96 + 48 * 32 + 16) * 3;
    const [red, green, blue] = pixels.subarray(offset, offset + 3);
    expect(frame < 3 ? red : blue).toBeGreaterThan(200);
    expect(frame < 3 ? blue : red).toBeLessThan(30);
    expect(green).toBeLessThan(30);
  }
});

it('stops preparing frames on cancellation', async () => {
  const controller = new AbortController();
  vi.mocked(decodeImage).mockClear();
  await expect(exportTimelapse(files, settings, 24, 1, controller.signal, () => controller.abort())).rejects.toHaveProperty(
    'name',
    'AbortError',
  );
  expect(decodeImage).toHaveBeenCalledExactlyOnceWith(files[0]);
});
