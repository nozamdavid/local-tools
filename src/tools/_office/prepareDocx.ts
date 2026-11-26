import { prepareOfficeBuffer } from './prepareOffice';

export const DOCX_PREPARATION_ERROR =
  'Could not prepare this DOCX document. Open it in Word or LibreOffice, save a fresh .docx copy, and try again.';

/** Neutralizes external relationship targets before the DOCX reaches the renderer. */
export function prepareDocxBuffer(input: Blob | ArrayBuffer): Promise<ArrayBuffer> {
  return prepareOfficeBuffer(input, DOCX_PREPARATION_ERROR);
}
