import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVideoMeta } from './media';

vi.mock('./mediabunny', () => ({ probeMedia: vi.fn() }));

import { probeMedia } from './mediabunny';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('getVideoMeta', () => {
  it('uses browser metadata when the probe has no duration', async () => {
    vi.mocked(probeMedia).mockResolvedValue({
      duration: null,
      tracks: [{ type: 'video', primary: true, width: 640, height: 360 }],
    } as Awaited<ReturnType<typeof probeMedia>>);

    const video = {
      duration: 12,
      videoWidth: 640,
      videoHeight: 360,
      onloadedmetadata: () => {},
      removeAttribute: vi.fn(),
      load: vi.fn(),
      set src(_value: string) {
        queueMicrotask(() => this.onloadedmetadata());
      },
    };
    const createElement = vi.fn(() => video);
    vi.stubGlobal('document', { createElement });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await expect(getVideoMeta(new Blob(['video']))).resolves.toMatchObject({
      duration: 12,
      width: 640,
      height: 360,
    });
    expect(createElement).toHaveBeenCalledWith('video');
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
});
