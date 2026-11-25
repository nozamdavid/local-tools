import { neutralizeOfficeRels } from '../../lib/inertMarkup';

export const DOCX_PREPARATION_ERROR =
  'Could not prepare this DOCX document. Open it in Word or LibreOffice, save a fresh .docx copy, and try again.';

/** Neutralizes external relationship targets before the DOCX reaches the renderer. */
export async function prepareDocxBuffer(input: Blob | ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    for (const [filename, file] of Object.entries(zip.files)) {
      if (filename.endsWith('.rels')) {
        const relsXml = await file.async('text');
        zip.file(filename, neutralizeOfficeRels(relsXml));
      }
    }
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch (cause) {
    throw new Error(DOCX_PREPARATION_ERROR, { cause });
  }
}
