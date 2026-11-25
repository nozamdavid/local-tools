import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { extractPdfText } from './textExtract';
import type { ExtractionResult } from './types';

type PdfText = { doc: PDFDocumentProxy; result: ExtractionResult } | { doc: PDFDocumentProxy; error: string };

export function usePdfText(doc: PDFDocumentProxy | null) {
  const [text, setText] = useState<PdfText | null>(null);

  useEffect(() => {
    if (!doc) return;
    const controller = new AbortController();
    void extractPdfText(doc, undefined, undefined, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setText({ doc, result });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setText({ doc, error: error instanceof Error ? error.message : 'Failed to extract text from PDF.' });
        }
      },
    );
    return () => controller.abort();
  }, [doc]);

  const current = text?.doc === doc ? text : null;
  return {
    result: current && 'result' in current ? current.result : null,
    error: current && 'error' in current ? current.error : null,
    extracting: Boolean(doc && !current),
  };
}
