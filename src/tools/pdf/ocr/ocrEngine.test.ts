import { createWorker } from 'tesseract.js';
import { afterEach, expect, it, vi } from 'vitest';
import { createOcrWorker } from './ocrEngine';

vi.mock('tesseract.js', () => ({ createWorker: vi.fn(), OEM: { LSTM_ONLY: 1 } }));

afterEach(() => vi.unstubAllGlobals());

it('cancels recognition even while Tesseract is still processing the current page', async () => {
  vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
  const recognize = vi.fn(() => new Promise(() => {}));
  const terminate = vi.fn().mockResolvedValue(undefined);
  vi.mocked(createWorker).mockResolvedValue({ recognize, terminate } as unknown as Awaited<ReturnType<typeof createWorker>>);
  const worker = await createOcrWorker('eng', () => {});
  const request = new AbortController();
  const recognition = worker.recognizePage(new Blob(), () => {}, request.signal).finally(() => worker.terminate());

  request.abort();

  await expect(recognition).rejects.toMatchObject({ name: 'AbortError' });
  expect(recognize).toHaveBeenCalledOnce();
  expect(terminate).toHaveBeenCalledOnce();
});
