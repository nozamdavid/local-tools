import { expect, it, vi } from 'vitest';
import { renderDocxToImages } from '../image/_pdf/docxRenderer';
import { DEFAULT_PAGE_SETUP } from '../pdf/_render/render';
import { powerpointToPdf } from '../pdf/powerpoint-to-pdf/convert';
import { wordToPdf } from '../pdf/word-to-pdf/convert';

const conversions = [
  { label: 'Word to PDF', extension: 'docx', run: (file: File) => wordToPdf(file, DEFAULT_PAGE_SETUP, () => {}) },
  { label: 'PowerPoint to PDF', extension: 'pptx', run: (file: File) => powerpointToPdf(file, DEFAULT_PAGE_SETUP, () => {}) },
  { label: 'DOCX to PNG', extension: 'docx', run: (file: File) => renderDocxToImages(file, 'sample', { format: 'image/png' }) },
];

it.each(conversions)('$label rejects failed archive preparation before rendering', async ({ extension, run }) => {
  const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], `sample.${extension}`);
  await expect(run(file)).rejects.toThrow(`save a fresh .${extension} copy`);

  const readError = new Error('File read failed');
  vi.spyOn(file, 'arrayBuffer').mockRejectedValue(readError);
  await expect(run(file)).rejects.toMatchObject({ cause: readError });
});
