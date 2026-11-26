import { useEffect, useState } from 'react';
import type { PDFDocument } from 'pdf-lib';
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

    const request = new AbortController();
    const { signal } = request;
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
              if (signal.aborted) return;
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
      while (!signal.aborted) {
        try {
          const { doc, pageCount, bytes } = await openPdf(file, currentPw);
          if (signal.aborted) return;

          setState({ loading: false, error: null, doc, pageCount, thumbs: {}, password: null });
          if (!withThumbs) return;

          try {
            const viewDoc = await loadPdfDocument(new Blob([bytes as BlobPart], { type: 'application/pdf' }), { signal });
            try {
              for (let p = 1; p <= pageCount && !signal.aborted; p++) {
                try {
                  const url = await renderPdfThumbnail(viewDoc, p, 160, signal);
                  if (!signal.aborted) setState((prev) => ({ ...prev, thumbs: { ...prev.thumbs, [p]: url } }));
                } catch {
                  // A page that fails to render keeps its placeholder.
                }
              }
            } finally {
              if (!viewDoc.loadingTask.destroyed) await viewDoc.loadingTask.destroy();
            }
          } catch {
            // A PDF that opened for editing can still be exported without thumbnails.
          }
          return;
        } catch (err) {
          if (signal.aborted) return;
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
      request.abort();
      dismissPassword?.();
    };
  }, [file, withThumbs]);

  return state;
}
