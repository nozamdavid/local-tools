import { expect, it, vi } from 'vitest';
import { computeFileDigests } from './hash';

it('computes all five file digests when Web Crypto subtle is unavailable', async () => {
  vi.stubGlobal('crypto', {});
  try {
    const file = new Blob([new Uint8Array(1024 * 1024).fill(97), 'abc']);

    await expect(computeFileDigests(file)).resolves.toEqual({
      md5: 'fd6b25cab94cae0093fc53306c9c700c',
      sha1: '35f967f905ea3577b36ba113dd2a01b831a9aa31',
      sha256: '4e40ea6aac7cd20a55f6e0f18a26b83f2b9ea361b0b6c893e0f69f42e7b11da8',
      sha384: '3733867ce4639263eac7e2e04e5e8d8b1c0c88e982df6987aee4327f5735dc9d8ec4e31d1eafe6e5d231c5a14b520b83',
      sha512:
        'b96787acc8cb77d64c61201f6d53c055851722d749a9a6a04ad4d48e1e814725137f5b999d229680eadb24f93baf25d0089717a0f005e66de3ad1ab810de8f18',
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
