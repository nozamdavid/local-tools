import { useEffect, useState } from 'react';
import type { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfDocument, renderPdfThumbnail } from '../../image/_pdf/pdfRenderer';
import { openPdf, PasswordRequiredError, IncorrectPasswordError } from './pdfPages';

export interface PasswordRequest {
  reason: number;
  submit: (password: string) => void;
}

export interface PdfPagesState {
  loading: boolean;
  error: string | null;
  doc: PDFDocument | null;
  pageCount: number;
  thumbs: Record<number, string>;
  password: PasswordRequest | null;
}

const EMPTY: PdfPagesState = {
  loading: false,
  error: null,
  doc: null,
  pageCount: 0,
  thumbs: {},
  password: null,
};

/** Opens a PDF for page-level editing and (optionally) renders a thumbnail for each page. */
export function usePdfPages(file: File | null, withThumbs: boolean): PdfPagesState {
  const [state, setState] = useState<PdfPagesState>(EMPTY);
  useEffect(() => {
    if (!file) {
      setState(EMPTY);
      return;
    }

    let cancelled = false;
    let pdfjsDoc: PDFDocumentProxy | null = null;
    let dismissPassword: (() => void) | undefined;
    setState({ ...EMPTY, loading: true });

    const requestPassword = (reason: number): Promise<string | undefined> => {
      return new Promise((resolve) => {
        dismissPassword = () => resolve(undefined);
        setState((prev) => ({
          ...prev,
          loading: false,
          password: {
            reason,
            submit: (pw: string) => {
              if (cancelled) return;
              dismissPassword = undefined;
              setState((s) => ({ ...s, password: null, loading: true }));
              resolve(pw);
            },
          },
        }));
      });
    };

    (async () => {
      let currentPw: string | undefined;
      while (!cancelled) {
        try {
          const { doc, pageCount, bytes } = await openPdf(file, currentPw);
          if (cancelled) return;

          setState({ loading: false, error: null, doc, pageCount, thumbs: {}, password: null });
          if (!withThumbs) return;

          const viewDoc = await loadPdfDocument(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
          if (cancelled) {
            void viewDoc.loadingTask.destroy();
            return;
          }
          pdfjsDoc = viewDoc;

          for (let p = 1; p <= pageCount; p++) {
            if (cancelled) break;
            try {
              const url = await renderPdfThumbnail(viewDoc, p, 160);
              if (cancelled) break;
              setState((prev) => ({ ...prev, thumbs: { ...prev.thumbs, [p]: url } }));
            } catch {
              // placeholder fallback
            }
          }
          return;
        } catch (err) {
          if (cancelled) return;
          if (err instanceof PasswordRequiredError) {
            currentPw = await requestPassword(1);
          } else if (err instanceof IncorrectPasswordError) {
            currentPw = await requestPassword(2);
          } else {
            setState({
              ...EMPTY,
              error: err instanceof Error ? err.message : 'Failed to open the PDF.',
            });
            return;
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      dismissPassword?.();
      void pdfjsDoc?.loadingTask.destroy();
    };
  }, [file, withThumbs]);

  return state;
}
