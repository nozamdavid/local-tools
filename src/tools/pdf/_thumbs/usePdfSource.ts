import { useCallback, useEffect, useRef, useState } from 'react';
import { PDFDocument, EncryptedPDFError } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfDocument, renderPdfThumbnail } from '../../image/_pdf/pdfRenderer';
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

  const activeFile = useRef<File | null>(null);
  const passwordRef = useRef('');

  const reset = useCallback(() => {
    activeFile.current = null;
    passwordRef.current = '';
    setFile(null);
    setDoc(null);
    setPages([]);
    setThumbs({});
    setLoading(false);
    setError(null);
    setPassword(null);
  }, []);

  const open = useCallback(async (selected: File) => {
    activeFile.current = selected;
    passwordRef.current = '';
    setFile(selected);
    setDoc(null);
    setPages([]);
    setThumbs({});
    setError(null);
    setPassword(null);
    setLoading(true);

    try {
      const loaded = await loadPdfDocument(selected, {
        onPassword: (verify, reason) => {
          setPassword({
            reason,
            submit: (pw) => {
              passwordRef.current = pw;
              verify(pw);
            },
          });
        },
      });
      if (activeFile.current !== selected) return;

      const infos: PageInfo[] = [];
      for (let p = 1; p <= loaded.numPages; p++) {
        const page = await loaded.getPage(p);
        const viewport = page.getViewport({ scale: 1 });
        infos.push({ width: viewport.width, height: viewport.height });
        page.cleanup();
      }
      if (activeFile.current !== selected) return;

      setPages(infos);
      setDoc(loaded);
      setPassword(null);
    } catch (err) {
      if (activeFile.current === selected) {
        setError(err instanceof Error ? err.message : 'Failed to load PDF document.');
        setPassword(null);
      }
    } finally {
      if (activeFile.current === selected) setLoading(false);
    }
  }, []);

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
    const bytes = new Uint8Array(await file.arrayBuffer());

    try {
      return await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) {
      // pdf-lib is compiled to ES5, so `instanceof` can miss its Error subclasses; match the message too.
      const encrypted = err instanceof EncryptedPDFError || (err instanceof Error && /is encrypted/i.test(err.message));
      if (!encrypted) throw err;
    }

    const decrypted = await decryptPdf(bytes, passwordRef.current);
    return PDFDocument.load(decrypted, { updateMetadata: false });
  }, [file]);

  return { file, doc, pages, thumbs, loading, error, password, open, reset, loadForEditing };
}
