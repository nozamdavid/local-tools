import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { getRotationCrop } from '../../lib/rotationCrop';
import { exportVideoEdit, type VideoEdit } from './engine';
import { getRotatedFrame, getRotationSurround } from './timeline';

type Core = {
  FS: {
    readFile(name: string, options?: { encoding: string }): Uint8Array;
    writeFile(name: string, data: Uint8Array): void;
    unlink(name: string): void;
  };
  exec(...args: string[]): number;
  ffprobe(...args: string[]): number;
  reset(): void;
  setLogger(callback: (event: { message: string }) => void): void;
  setProgress(callback: (event: { time: number }) => void): void;
};

let core: Core;

vi.mock('@ffmpeg/util', () => ({ toBlobURL: async (url: string) => url }));
// Substitute the transport so Vitest can use the same WASM core in Node.
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    loaded = false;
    async load() {
      this.loaded = true;
    }
    terminate() {
      this.loaded = false;
    }
    on(event: 'log', callback: (event: { message: string }) => void): void;
    on(event: 'progress', callback: (event: { time: number }) => void): void;
    on(event: string, callback: never) {
      if (event === 'log') core.setLogger(callback);
      else if (event === 'progress') {
        // Preserve both the editor's timeline progress listener and the shared runner's listener.
        this.progressListeners.add(callback);
        core.setProgress((progress) => this.progressListeners.forEach((listener) => listener(progress)));
      }
    }
    private progressListeners = new Set<(event: { time: number }) => void>();
    off(event: string, callback: never) {
      if (event === 'log') core.setLogger(() => {});
      else this.progressListeners.delete(callback);
    }
    async writeFile(name: string, bytes: Uint8Array) {
      core.FS.writeFile(name, bytes);
    }
    async deleteFile(name: string) {
      core.FS.unlink(name);
    }
    async readFile(name: string, encoding?: string) {
      return core.FS.readFile(name, encoding ? { encoding } : undefined);
    }
    async ffprobe(args: string[]) {
      const messages: string[] = [];
      core.setLogger(({ message }) => messages.push(message));
      const code = core.ffprobe(...args);
      core.reset();
      core.setLogger(() => {});
      expect(code, messages.join('\n')).toBeLessThanOrEqual(0);
      return code;
    }
    async exec(args: string[]) {
      const code = core.exec(...args);
      core.reset();
      if (!this.loaded) throw new Error('terminated');
      return code;
    }
  },
}));

function execute(...args: string[]) {
  const messages: string[] = [];
  core.setLogger(({ message }) => messages.push(message));
  const code = core.exec('-hide_banner', ...args);
  core.reset();
  core.setLogger(() => {});
  expect(code, messages.slice(-12).join('\n')).toBe(0);
}

function localFile(name: string, type: string) {
  const data = new Uint8Array(core.FS.readFile(name));
  return new File([data], name, { type });
}

async function inspect(blob: Blob, extension: string) {
  const name = `inspected.${extension}`;
  core.FS.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
  const code = core.ffprobe('-v', 'error', '-show_streams', '-show_format', '-of', 'json', '-o', 'inspected.json', name);
  core.reset();
  expect(code).toBeLessThanOrEqual(0);
  return JSON.parse(new TextDecoder().decode(core.FS.readFile('inspected.json'))) as {
    format: { duration: string };
    streams: Array<{ codec_type: string; codec_name: string; pix_fmt: string; width: number; height: number }>;
  };
}

function rms(start: number, end: number) {
  const bytes = core.FS.readFile('output.pcm');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let energy = 0;
  const first = start * 48000;
  const last = end * 48000;
  for (let sample = first; sample < last; sample++) {
    energy += view.getInt16(sample * 2, true) ** 2;
  }
  return Math.sqrt(energy / (last - first));
}

const baseEdit: VideoEdit = {
  segments: [{ start: 0, end: 4 }],
  speed: 1,
  crop: null,
  rotation: 0,
  flipH: false,
  flipV: false,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  audioOffset: 0,
  audioVolume: 1,
};

beforeAll(async () => {
  vi.stubGlobal('self', { location: { href: '' } });
  const require = createRequire(import.meta.url);
  const createCore = require('@ffmpeg/core') as (options: { wasmBinary: Uint8Array }) => Promise<Core>;
  core = await createCore({ wasmBinary: readFileSync(require.resolve('@ffmpeg/core/wasm')) });
  execute(
    '-f',
    'lavfi',
    '-i',
    'color=red:s=96x64:r=25:d=2',
    '-f',
    'lavfi',
    '-i',
    'color=blue:s=96x64:r=25:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=4',
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map',
    '[v]',
    '-map',
    '2:a',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    'source.mp4',
  );
  execute('-i', 'source.mp4', '-an', '-c:v', 'copy', 'silent.mp4');
  execute('-f', 'lavfi', '-i', 'color=green:s=40x80:r=20:d=1.2', '-c:v', 'libx264', 'portrait.mp4');
  execute(
    '-f',
    'lavfi',
    '-i',
    'color=magenta:s=96x64:r=10:d=0.4',
    '-vf',
    'drawbox=14:10:56:36:blue:t=fill,drawbox=26:18:10:10:red:t=fill,drawbox=46:28:10:10:lime:t=fill',
    '-c:v',
    'libx264',
    'rotation.mp4',
  );
  execute('-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=0.4', 'music.wav');
}, 15000);

afterAll(() => vi.unstubAllGlobals());

it('keeps exact cardinal dimensions and encloses the full rotation for editing', () => {
  const crop = { width: 51, height: 33 };
  for (const rotation of [0, 180]) expect(getRotationCrop(crop.width, crop.height, rotation)).toEqual(crop);
  for (const rotation of [-90, 90]) {
    expect(getRotationCrop(crop.width, crop.height, rotation)).toEqual({ width: 33, height: 51 });
    expect(getRotatedFrame(crop, rotation)).toMatchObject({ contentWidth: 33, contentHeight: 51, width: 34, height: 52 });
    expect(getRotationSurround(crop, rotation)).toEqual({ width: 33, height: 51 });
  }
  expect(getRotationSurround({ width: 56, height: 36 }, -30)).toEqual({ width: 67, height: 60 });
});

it.each([
  { rotation: 15, format: 'mp4', width: 50, height: 22, red: [15, 3], green: [32, 18] },
  { rotation: -30, format: 'webm', width: 36, height: 20, red: [5, 11], green: [28, 9] },
  { rotation: 270, format: 'mp4', width: 36, height: 56, red: [13, 39], green: [23, 19] },
] as const)('crops and rotates by $rotation degrees in $format', async ({ rotation, format, width, height, red, green }) => {
  const crop = { x: 14, y: 10, width: 56, height: 36 };
  expect(getRotatedFrame(crop, rotation)).toMatchObject({ width, height });
  const blob = await exportVideoEdit(
    localFile('rotation.mp4', 'video/mp4'),
    { ...baseEdit, segments: [{ start: 0, end: 0.4 }], crop, rotation },
    null,
    format,
    () => {},
    new AbortController().signal,
  );
  const probe = await inspect(blob, format);
  expect(probe.streams).toMatchObject([{ codec_type: 'video', pix_fmt: 'yuv420p', width, height }]);
  execute('-i', `inspected.${format}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'frame.rgb');
  const pixels = core.FS.readFile('frame.rgb');
  const pixel = (x: number, y: number) => pixels.slice((y * width + x) * 3, (y * width + x) * 3 + 3);
  for (const [point, channel] of [
    [red, 0],
    [green, 1],
    [[Math.floor(width / 2), Math.floor(height / 2)], 2],
  ] as const) {
    const color = pixel(point[0], point[1]);
    expect(color[channel]).toBeGreaterThan(200);
    expect(color[(channel + 1) % 3]).toBeLessThan(35);
    expect(color[(channel + 2) % 3]).toBeLessThan(35);
  }
  for (const x of [0, width - 1]) {
    for (const y of [0, height - 1]) expect(Math.max(...pixel(x, y))).toBeGreaterThan(200);
  }
});

it.each([
  { cropWidth: 35, cropHeight: 57, rotation: -31, format: 'webm', width: 20, height: 32, keptWidth: 20, keptHeight: 33 },
  { cropWidth: 1, cropHeight: 2, rotation: 43, format: 'mp4', width: 2, height: 2, keptWidth: 1, keptHeight: 1 },
] as const)('exports a $width × $height rotated portrait crop without black edges', async (test) => {
  const { cropWidth, cropHeight, rotation, format, width, height, keptWidth, keptHeight } = test;
  const crop = { x: 2, y: 4, width: cropWidth, height: cropHeight };
  expect(getRotationCrop(crop.width, crop.height, -rotation)).toEqual({ width: keptWidth, height: keptHeight });
  const blob = await exportVideoEdit(
    localFile('portrait.mp4', 'video/mp4'),
    { ...baseEdit, segments: [{ start: 0, end: 0.2 }], crop, rotation },
    null,
    format,
    () => {},
    new AbortController().signal,
  );
  const probe = await inspect(blob, format);
  expect(probe.streams).toMatchObject([{ codec_type: 'video', pix_fmt: 'yuv420p', width, height }]);
  execute('-i', `inspected.${format}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'frame.rgb');
  const frame = core.FS.readFile('frame.rgb');
  for (let channel = 1; channel < frame.length; channel += 3) expect(frame[channel]).toBeGreaterThan(100);
});

it('reorders and speeds up ranges, rotates a crop, and fades the source under a delayed mix in MP4', async () => {
  const progress: number[] = [];
  const blob = await exportVideoEdit(
    localFile('source.mp4', 'video/mp4'),
    {
      ...baseEdit,
      segments: [
        { start: 2.4, end: 3.6 },
        { start: 0.4, end: 1.6 },
      ],
      speed: 1.5,
      crop: { x: 3, y: 5, width: 51, height: 33 },
      rotation: 90,
      flipH: true,
      volume: 0.5,
      fadeIn: 0.3,
      fadeOut: 0.3,
      audioOffset: 0.45,
      audioVolume: 0.75,
    },
    localFile('music.wav', 'audio/wav'),
    'mp4',
    (value) => progress.push(value),
    new AbortController().signal,
  );
  expect(blob.type).toBe('video/mp4');
  const probe = await inspect(blob, 'mp4');
  expect(probe.streams).toMatchObject([
    { codec_name: 'h264', codec_type: 'video', pix_fmt: 'yuv420p', width: 34, height: 52 },
    { codec_name: 'aac', codec_type: 'audio' },
  ]);
  expect(Number(probe.format.duration)).toBeCloseTo(1.6, 1);

  execute('-ss', '0.2', '-i', 'inspected.mp4', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'frame.rgb');
  const firstFrame = core.FS.readFile('frame.rgb');
  const [firstRed, , firstBlue] = firstFrame;
  expect(firstBlue).toBeGreaterThan(firstRed + 150);
  expect(firstFrame.at(-1)).toBeGreaterThan(150);
  execute('-ss', '1.2', '-i', 'inspected.mp4', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'frame.rgb');
  const [secondRed, , secondBlue] = core.FS.readFile('frame.rgb');
  expect(secondRed).toBeGreaterThan(secondBlue + 150);

  execute('-i', 'inspected.mp4', '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'output.pcm');
  const source = rms(0.35, 0.4);
  expect(source).toBeGreaterThan(600);
  expect(rms(0.02, 0.06)).toBeLessThan(source / 3);
  expect(rms(0.55, 0.7)).toBeGreaterThan(source * 1.4);
  expect(rms(1.1, 1.2)).toBeCloseTo(source, -2);
  expect(rms(1.54, 1.58)).toBeLessThan(source / 3);
  expect(progress[0]).toBe(0);
  expect(progress.at(-1)).toBe(1);
  expect(progress).toEqual([...progress].sort((a, b) => a - b));
});

it.each(['mp4', 'webm'] as const)('exports reordered ranges from mixed sources to %s', async (format) => {
  const blob = await exportVideoEdit(
    [localFile('source.mp4', 'video/mp4'), localFile('portrait.mp4', 'video/mp4')],
    {
      ...baseEdit,
      segments: [
        { sourceIndex: 1, start: 0, end: 0.8 },
        { sourceIndex: 0, start: 2.4, end: 3.2 },
        { sourceIndex: 1, start: 0.8, end: 2 },
        { start: 0.4, end: 1.2 },
      ],
      crop: { x: 16, y: 4, width: 64, height: 56 },
      rotation: 90,
    },
    null,
    format,
    () => {},
    new AbortController().signal,
    format === 'webm' ? { width: 96, height: 64 } : undefined,
  );
  const probe = await inspect(blob, format);
  expect(probe.streams).toMatchObject([{ codec_type: 'video', width: 56, height: 64 }, { codec_type: 'audio' }]);
  expect(Number(probe.format.duration)).toBeCloseTo(2.8, 1);

  for (const [time, channel] of [
    [0.4, 1],
    [1.2, 2],
    [1.8, 1],
    [2.4, 0],
  ]) {
    execute('-ss', String(time), '-i', `inspected.${format}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'frame.rgb');
    const frame = core.FS.readFile('frame.rgb');
    const center = frame.slice((32 * 56 + 28) * 3, (32 * 56 + 28) * 3 + 3);
    expect(center[channel]).toBeGreaterThan(100);
    expect(center[(channel + 1) % 3]).toBeLessThan(20);
    expect(center[(channel + 2) % 3]).toBeLessThan(20);
    const edge = (8 * 56 + 28) * 3;
    if (channel === 1) expect(Math.max(...frame.slice(edge, edge + 3))).toBeLessThan(12);
    else expect(frame[edge + channel]).toBeGreaterThan(150);
  }

  execute('-i', `inspected.${format}`, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'output.pcm');
  expect(rms(0.2, 0.7)).toBeLessThan(10);
  expect(rms(0.9, 1.5)).toBeGreaterThan(1000);
  expect(rms(1.65, 1.95)).toBeLessThan(10);
  expect(rms(2.1, 2.7)).toBeGreaterThan(1000);
});

it('uses the anchor dimensions when only the silent source is on the timeline', async () => {
  const anchor = localFile('source.mp4', 'video/mp4');
  const readAnchor = vi.spyOn(anchor, 'arrayBuffer');
  const blob = await exportVideoEdit(
    [anchor, localFile('portrait.mp4', 'video/mp4')],
    { ...baseEdit, segments: [{ sourceIndex: 1, start: 0, end: 0.8 }] },
    null,
    'mp4',
    () => {},
    new AbortController().signal,
  );
  const probe = await inspect(blob, 'mp4');
  expect(probe.streams).toMatchObject([{ codec_type: 'video', width: 96, height: 64 }]);
  expect(readAnchor).not.toHaveBeenCalled();
});

it.each([
  { offset: -0.2, audible: true },
  { offset: -0.6, audible: false },
])('keeps a silent WebM export the correct length with soundtrack offset $offset', async ({ offset, audible }) => {
  const blob = await exportVideoEdit(
    localFile('silent.mp4', 'video/mp4'),
    {
      ...baseEdit,
      segments: [{ start: 1, end: 2.5 }],
      speed: 0.75,
      rotation: 270,
      flipV: true,
      audioOffset: offset,
    },
    localFile('music.wav', 'audio/wav'),
    'webm',
    () => {},
    new AbortController().signal,
  );
  expect(blob.type).toBe('video/webm');
  const probe = await inspect(blob, 'webm');
  expect(probe.streams).toMatchObject([
    { codec_name: 'vp8', codec_type: 'video', width: 64, height: 96 },
    { codec_name: 'vorbis', codec_type: 'audio' },
  ]);
  expect(Number(probe.format.duration)).toBeCloseTo(2, 1);

  execute('-i', 'inspected.webm', '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', 'output.pcm');
  if (audible) expect(rms(0.05, 0.15)).toBeGreaterThan(1000);
  else expect(rms(0.05, 0.15)).toBeLessThan(10);
  expect(rms(0.3, 1.9)).toBeLessThan(10);
});

it('keeps a video-only export free of audio when there is no soundtrack', async () => {
  const blob = await exportVideoEdit(
    localFile('silent.mp4', 'video/mp4'),
    {
      ...baseEdit,
      segments: [
        { start: 0.4, end: 1.4 },
        { start: 2.3, end: 2.9 },
      ],
    },
    null,
    'mp4',
    () => {},
    new AbortController().signal,
  );
  const probe = await inspect(blob, 'mp4');
  expect(probe.streams).toMatchObject([{ codec_type: 'video', width: 96, height: 64 }]);
  expect(Number(probe.format.duration)).toBeCloseTo(1.6, 1);
});

it('rejects cancellation during rendering without reporting success', async () => {
  const controller = new AbortController();
  const progress: number[] = [];
  await expect(
    exportVideoEdit(
      localFile('source.mp4', 'video/mp4'),
      baseEdit,
      null,
      'mp4',
      (value) => {
        progress.push(value);
        if (value > 0) controller.abort();
      },
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(progress.at(-1)).toBeGreaterThan(0);
  expect(progress).not.toContain(1);
});
