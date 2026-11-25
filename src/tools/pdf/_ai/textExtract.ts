import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ExtractedPageText, ExtractionResult, TextChunk } from './types';

/**
 * Extracts structured text from a PDF document page-by-page.
 * Returns empty text information when no selectable text is found (e.g. scanned image PDFs).
 */
export async function extractPdfText(
  doc: PDFDocumentProxy,
  maxPages?: number,
  onProgress?: (current: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  const totalPages = Math.min(doc.numPages, maxPages ?? doc.numPages);
  const pages: ExtractedPageText[] = [];
  let totalChars = 0;
  let totalWords = 0;

  for (let p = 1; p <= totalPages; p++) {
    signal?.throwIfAborted();
    onProgress?.(p, totalPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent().finally(() => page.cleanup());

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
  } = {},
): TextChunk[] {
  const { includePageHeaders = false, maxTotalChunks = 20 } = options;
  const maxChunkChars = Math.max(2, Math.floor(options.maxChunkChars ?? 1800));
  const chunks: TextChunk[] = [];
  let currentChunkText = '';

  const flushChunk = () => {
    const trimmed = currentChunkText.trim();
    if (trimmed.length > 0) {
      if (chunks.length >= maxTotalChunks) {
        throw new Error('The selected pages contain too much text for one run. Select fewer pages.');
      }
      chunks.push({
        index: chunks.length,
        text: trimmed,
        charCount: trimmed.length,
      });
    }
    currentChunkText = '';
  };

  for (const page of pages) {
    const pageMarker = includePageHeaders ? `--- Page ${page.pageNum} ---\n\n` : '';
    for (const [index, paragraph] of page.paragraphs.entries()) {
      let remaining = index === 0 ? pageMarker + paragraph : paragraph;
      if (currentChunkText && currentChunkText.length + remaining.length + 2 > maxChunkChars) flushChunk();

      while (remaining.length > maxChunkChars) {
        const prefix = remaining.slice(0, maxChunkChars);
        const sentenceEnd = prefix.match(/.*[.!?](?=\s)/s)?.[0].length ?? 0;
        const wordBreak = prefix.search(/\s\S*$/);
        let end = sentenceEnd >= maxChunkChars / 2 ? sentenceEnd : wordBreak > 0 ? wordBreak : maxChunkChars;
        // Keep a surrogate pair together when splitting an unbroken word.
        if (end > 1 && /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(remaining.slice(end - 1, end + 1))) end--;
        currentChunkText = remaining.slice(0, end);
        flushChunk();
        remaining = remaining.slice(end).trimStart();
      }
      currentChunkText += (currentChunkText ? '\n\n' : '') + remaining;
    }
  }

  flushChunk();
  return chunks;
}
