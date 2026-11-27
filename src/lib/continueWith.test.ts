import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResultFiles, getContinueWithTools } from './continueWith';
import { clearPendingFiles, setPendingFiles, takePendingFiles } from './handoff';
import { IMAGE_ACCEPT } from './image';

function createFile(name: string, type: string): File {
  const blob = new Blob(['sample data'], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob as File;
}

afterEach(() => {
  clearPendingFiles();
  vi.useRealTimers();
});

describe('Continue with result workflows', () => {
  it('keeps output bytes, filename, and MIME type in the in-memory handoff', async () => {
    const results = [{ name: 'edited & final.png', blob: new Blob(['exact output bytes'], { type: 'image/png' }) }];
    const [file] = createResultFiles(results);

    expect(file.name).toBe('edited & final.png');
    expect(file.type).toBe('image/png');

    setPendingFiles([file], '/image/compress');
    const pending = takePendingFiles('/image/compress', 'image/*');

    expect(pending?.accepted[0].name).toBe('edited & final.png');
    expect(await pending?.accepted[0].text()).toBe('exact output bytes');
    expect(takePendingFiles('/image/compress', 'image/*')).toBeNull();
  });

  it('expires pending files after five minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
    setPendingFiles([createFile('output.png', 'image/png')], '/image/compress');

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    // Moving the clock back must not make the expired selection available again.
    vi.setSystemTime(new Date('2026-10-29T12:00:01Z'));

    expect(takePendingFiles('/image/compress', 'image/*')).toBeNull();
  });

  it('hands off both outputs with the same name and their distinct bytes', async () => {
    const files = createResultFiles(
      ['first frame', 'second frame'].map((bytes) => ({ name: 'frame.png', blob: new Blob([bytes], { type: 'image/png' }) })),
    );
    const [target] = getContinueWithTools('/image/bulk-resize', files);
    expect(target.path).toBe('/image/compare');

    setPendingFiles(files, target.path);
    const handoff = takePendingFiles(target.path, 'image/png,.png', true);
    expect(handoff?.accepted.map(({ name }) => name)).toEqual(['frame.png', 'frame.png']);
    expect(await Promise.all(handoff!.accepted.map((file) => file.text()))).toEqual(['first frame', 'second frame']);
  });

  it('ranks a same-format contextual next step first', () => {
    expect(getContinueWithTools('/pdf/scan-to-pdf', [createFile('scan.pdf', 'application/pdf')])[0].id).toBe('pdf-ocr');
    expect(getContinueWithTools('/image/resize', [createFile('resized.webp', 'image/webp')])[0].id).toBe('img-compress');
    expect(getContinueWithTools('/image/convert', [createFile('converted.png', 'image/png')])[0].id).toBe('img-compress');
    expect(getContinueWithTools('/video/audio-extract', [createFile('audio.wav', 'audio/wav')])[0].id).toBe('audio-trim');
  });

  it('excludes the current route and filters a context target that cannot accept the output', () => {
    const sameTool = getContinueWithTools('/image/compress', [createFile('compressed.png', 'image/png')]);
    const incompatible = getContinueWithTools('/pdf/scan-to-pdf', [createFile('page.png', 'image/png')]);
    const unsupported = getContinueWithTools('/video/trim', [createFile('result.bin', 'application/octet-stream')]);

    expect(sameTool.map((tool) => tool.id)).not.toContain('img-compress');
    expect(incompatible.map((tool) => tool.id)).not.toContain('pdf-ocr');
    expect(unsupported).toEqual([]);
  });

  it('offers applicable editors among the visible next tools', () => {
    const photo = createFile('resized.webp', 'image/webp');
    const video = createFile('trimmed.mp4', 'video/mp4');

    expect(
      getContinueWithTools('/image/resize', [photo])
        .slice(0, 4)
        .map(({ id }) => id),
    ).toContain('img-photo-editor');
    expect(getContinueWithTools('/video/trim', [video])[0].id).toBe('video-editor');
    expect(getContinueWithTools('/video/video-editor', [video]).map(({ id }) => id)).not.toContain('video-editor');
  });

  it('offers Timelapse once for image batches and keeps handoffs on the chosen route', () => {
    const files = [createFile('frame.png', 'image/png'), createFile('next.jpg', 'image/jpeg')];
    const targets = getContinueWithTools('/image/bulk-resize', files);
    expect(targets[0].id).toBe('img-compare');
    expect(
      targets
        .slice(0, 4)
        .filter((tool) => tool.id === 'timelapse')
        .map((tool) => tool.path),
    ).toEqual(['/video/timelapse']);

    for (const path of ['/video/timelapse', '/image/timelapse']) {
      expect(getContinueWithTools(path, files).some((tool) => tool.id === 'timelapse')).toBe(false);
    }
    setPendingFiles(files, '/image/timelapse');
    expect(takePendingFiles('/video/timelapse', IMAGE_ACCEPT, true)).toBeNull();
    expect(takePendingFiles('/image/timelapse', IMAGE_ACCEPT, true)).toEqual({ accepted: files, rejected: [] });
  });

  it('offers image comparison only when the complete output batch is exactly two images', () => {
    const twoImages = [createFile('one.png', 'image/png'), createFile('two.webp', 'image/webp')];
    const threeImages = [...twoImages, createFile('three.jpg', 'image/jpeg')];
    const mixedFiles = [twoImages[0], createFile('archive.zip', 'application/zip')];
    const svgPair = [twoImages[0], createFile('vector.svg', 'image/svg+xml')];

    expect(getContinueWithTools('/image/resize', twoImages)[0].id).toBe('img-compare');
    expect(getContinueWithTools('/image/resize', threeImages).map((tool) => tool.id)).not.toContain('img-compare');
    expect(getContinueWithTools('/image/resize', mixedFiles).map((tool) => tool.id)).not.toContain('img-compare');
    expect(getContinueWithTools('/image/resize', svgPair).map((tool) => tool.id)).not.toContain('img-compare');

    setPendingFiles(twoImages, '/image/compare');
    expect(takePendingFiles('/image/compare', 'image/*', true)?.accepted).toHaveLength(2);
  });

  it('offers the 3D Viewer first for a single model result', () => {
    const model = createFile('part.stl', 'model/stl');
    const batch = [model, createFile('other.obj', 'model/obj')];

    expect(getContinueWithTools('/3d/convert', [model])[0].path).toBe('/3d/viewer');
    expect(getContinueWithTools('/3d/split', batch).map(({ id }) => id)).toEqual(['three-merge']);
    expect(getContinueWithTools('/3d/viewer', [model])[0].path).toBe('/3d/convert');
    expect(getContinueWithTools('/3d/viewer', [createFile('scene.glb', 'model/gltf-binary')])).toEqual([]);
  });
});
