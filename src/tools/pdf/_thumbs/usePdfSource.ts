import { useCallback, useEffect, useRef, useState } from 'react';
import { PDFDocument, EncryptedPDFError } from 'pdf-lib';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfjs } from '../../../lib/pdf';
import { renderPdfThumbnail } from '../../image/_pdf/pdfRenderer';
import { decryptPdf } from './decrypt';

/** Visual page size in points (pdf.js viewport at scale 1: rotation and CropBox applied). */
export interface PageInfo {
  width: number;
  height: number;
}

export interface PasswordRequest {
  reason: number;
  submit: (password: string) => void;
}

export interface PdfSource {
  file: File | null;
  doc: PDFDocumentProxy | null;
  pages: PageInfo[];
  /** Thumbnail data URLs keyed by 0-based page index. */
  thumbs: Record<number, string>;
  loading: boolean;
  error: string | null;
  password: PasswordRequest | null;
  open: (file: File) => Promise<void>;
  reset: () => void;
  /** Loads the file into pdf-lib, decrypting it first when it is password protected. */
  loadForEditing: () => Promise<PDFDocument>;
}

/**
 * Opens a PDF with pdf.js for previews and thumbnails, and exposes a pdf-lib loader for the
 * lossless edit. Everything stays in the browser.
 */
export function usePdfSource(thumbSize = 200): PdfSource {
  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<PasswordRequest | null>(null);

  const openRequest = useRef<AbortController | null>(null);
  const loadingTask = useRef<PDFDocumentLoadingTask | null>(null);
  const passwordRef = useRef('');
  const mounted = useRef(false);

  const close = useCallback(() => {
    openRequest.current?.abort();
    openRequest.current = null;
    void loadingTask.current?.destroy().catch(() => undefined);
    loadingTask.current = null;
    passwordRef.current = '';
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // A file handoff can open a PDF during the initial effects replay in Strict Mode.
      queueMicrotask(() => {
        if (!mounted.current) close();
      });
    };
  }, [close]);

  const reset = useCallback(() => {
    close();
    setFile(null);
    setDoc(null);
    setPages([]);
    setThumbs({});
    setLoading(false);
    setError(null);
    setPassword(null);
  }, [close]);

  const open = useCallback(
    async (selected: File) => {
      close();
      const request = new AbortController();
      openRequest.current = request;
      setFile(selected);
      setDoc(null);
      setPages([]);
      setThumbs({});
      setError(null);
      setPassword(null);
      setLoading(true);

      try {
        const [pdfjs, buffer] = await Promise.all([loadPdfjs(), selected.arrayBuffer()]);
        if (request.signal.aborted) return;
        const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
        loadingTask.current = task;
        task.onPassword = (verify: (password: string) => void, reason: number) => {
          if (request.signal.aborted) return;
          setPassword({
            reason,
            submit: (pw) => {
              if (request.signal.aborted) return;
              passwordRef.current = pw;
              verify(pw);
            },
          });
        };
        const loaded = await task.promise;

        const infos: PageInfo[] = [];
        for (let p = 1; p <= loaded.numPages; p++) {
          if (request.signal.aborted) return;
          const page = await loaded.getPage(p);
          const viewport = page.getViewport({ scale: 1 });
          infos.push({ width: viewport.width, height: viewport.height });
          page.cleanup();
        }
        if (request.signal.aborted) return;

        setPages(infos);
        setDoc(loaded);
        setPassword(null);
      } catch (err) {
        if (!request.signal.aborted) {
          close();
          setError(err instanceof Error ? err.message : 'Failed to load PDF document.');
          setPassword(null);
          setLoading(false);
        }
      } finally {
        if (!request.signal.aborted) setLoading(false);
      }
    },
    [close],
  );

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;

    (async () => {
      for (let p = 1; p <= doc.numPages; p++) {
        if (cancelled) return;
        try {
          const url = await renderPdfThumbnail(doc, p, thumbSize);
          if (cancelled) return;
          setThumbs((prev) => ({ ...prev, [p - 1]: url }));
        } catch {
          // a page that fails to render keeps its placeholder
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, thumbSize]);

  const loadForEditing = useCallback(async () => {
    if (!file) throw new Error('No PDF is open.');
    const password = passwordRef.current;
    const bytes = new Uint8Array(await file.arrayBuffer());

    try {
      return await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) {
      // pdf-lib is compiled to ES5, so `instanceof` can miss its Error subclasses; match the message too.
      const encrypted = err instanceof EncryptedPDFError || (err instanceof Error && /is encrypted/i.test(err.message));
      if (!encrypted) throw err;
    }

    const decrypted = await decryptPdf(bytes, password);
    return PDFDocument.load(decrypted, { updateMetadata: false });
  }, [file]);

  return { file, doc, pages, thumbs, loading, error, password, open, reset, loadForEditing };
}
