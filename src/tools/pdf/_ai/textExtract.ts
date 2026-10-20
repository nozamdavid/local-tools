import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ExtractedPageText, ExtractionResult, TextChunk } from './types';

/**
 * Extracts structured text from a PDF document page-by-page.
 * Returns empty text information when no selectable text is found (e.g. scanned image PDFs).
 */
export async function extractPdfText(
  doc: PDFDocumentProxy,
  maxPages?: number,
  onProgress?: (current: number, total: number) => void
): Promise<ExtractionResult> {
  const totalPages = Math.min(doc.numPages, maxPages ?? doc.numPages);
  const pages: ExtractedPageText[] = [];
  let totalChars = 0;
  let totalWords = 0;

  for (let p = 1; p <= totalPages; p++) {
    onProgress?.(p, totalPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    page.cleanup();

    const paragraphs: string[] = [];
    let currentParagraphLines: string[] = [];
    let lastY: number | null = null;

    for (const item of content.items) {
      if (!('str' in item) || typeof item.str !== 'string') continue;
      const text = item.str.trim();
      if (!text) continue;

      const y = Array.isArray(item.transform) ? item.transform[5] : 0;
      if (lastY !== null && Math.abs(lastY - y) > 20) {
        // Significant vertical jump indicates a new paragraph / block
        if (currentParagraphLines.length > 0) {
          paragraphs.push(currentParagraphLines.join(' '));
          currentParagraphLines = [];
        }
      }
      currentParagraphLines.push(text);
      lastY = y;
    }

    if (currentParagraphLines.length > 0) {
      paragraphs.push(currentParagraphLines.join(' '));
    }

    const pageRawText = paragraphs.join('\n\n');
    const words = pageRawText.split(/\s+/).filter(Boolean).length;

    totalChars += pageRawText.length;
    totalWords += words;

    pages.push({
      pageNum: p,
      paragraphs,
      rawText: pageRawText,
    });
  }

  return {
    pages,
    totalChars,
    totalWords,
    hasText: totalChars > 0,
  };
}

/**
 * Chunks extracted page text into safe, bounded pieces that fit model token limits.
 * Preserves paragraph and sentence boundaries wherever feasible.
 */
export function chunkTextForInference(
  pages: ExtractedPageText[],
  options: {
    maxChunkChars?: number;
    includePageHeaders?: boolean;
    maxTotalChunks?: number;
  } = {}
): TextChunk[] {
  const { maxChunkChars = 1800, includePageHeaders = false, maxTotalChunks = 20 } = options;
  const chunks: TextChunk[] = [];
  let currentChunkText = '';
  let currentPageHeader: string | undefined;

  const flushChunk = () => {
    const trimmed = currentChunkText.trim();
    if (trimmed.length > 0) {
      chunks.push({
        index: chunks.length,
        text: trimmed,
        pageHeader: currentPageHeader,
        charCount: trimmed.length,
      });
    }
    currentChunkText = '';
  };

  for (const page of pages) {
    if (chunks.length >= maxTotalChunks) break;

    const pageMarker = includePageHeaders ? `--- Page ${page.pageNum} ---\n\n` : '';
    let pageStarted = false;

    for (const para of page.paragraphs) {
      if (chunks.length >= maxTotalChunks) break;

      const paraWithMarker = !pageStarted && pageMarker ? pageMarker + para : para;
      pageStarted = true;

      // If the paragraph alone exceeds maxChunkChars, split by sentences
      if (paraWithMarker.length > maxChunkChars) {
        const sentences = paraWithMarker.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [paraWithMarker];
        for (const sentence of sentences) {
          if (currentChunkText.length + sentence.length > maxChunkChars && currentChunkText.length > 0) {
            flushChunk();
          }
          currentChunkText += (currentChunkText ? ' ' : '') + sentence.trim();
        }
      } else {
        if (currentChunkText.length + paraWithMarker.length + 2 > maxChunkChars && currentChunkText.length > 0) {
          flushChunk();
        }
        currentChunkText += (currentChunkText ? '\n\n' : '') + paraWithMarker;
      }
    }
  }

  flushChunk();
  return chunks;
}
