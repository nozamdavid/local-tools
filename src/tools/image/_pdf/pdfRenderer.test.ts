import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPdfThumbnail } from './pdfRenderer';

afterEach(() => vi.unstubAllGlobals());

function fixture(render: () => { promise: Promise<void>; cancel: () => void }) {
  const canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: vi.fn() }), toDataURL: () => 'data:image/jpeg,test' };
  const page = { getViewport: () => ({ width: 100, height: 200 }), render: vi.fn(render), cleanup: vi.fn() };
  const doc = { getPage: async () => page } as unknown as PDFDocumentProxy;
  vi.stubGlobal('document', { createElement: () => canvas });
  return { canvas, page, doc };
}

describe('PDF preview resource cleanup', () => {
  it('releases the page and canvas after rendering fails', async () => {
    const { canvas, page, doc } = fixture(() => ({ promise: Promise.reject(new Error('render failed')), cancel: vi.fn() }));
    await expect(renderPdfThumbnail(doc, 1)).rejects.toThrow('render failed');
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('cancels stale rasterization and releases its resources', async () => {
    let reject!: (reason: Error) => void;
    const promise = new Promise<void>((_resolve, rej) => {
      reject = rej;
    });
    const cancel = vi.fn(() => reject(new Error('cancelled')));
    const { canvas, page, doc } = fixture(() => ({ promise, cancel }));
    const controller = new AbortController();
    const rendering = renderPdfThumbnail(doc, 1, 900, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(rendering).rejects.toThrow('cancelled');
    expect(cancel).toHaveBeenCalledOnce();
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });
});
