import type JSZip from 'jszip';
import { neutralizeOfficeRels } from '../../lib/inertMarkup';

/** Prepares an OOXML archive before a renderer sees any of its relationships. */
export async function prepareOfficeBuffer(
  input: Blob | ArrayBuffer,
  errorMessage: string,
  prepareParts?: (zip: JSZip) => Promise<void>,
): Promise<ArrayBuffer> {
  try {
    const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
    const { default: Zip } = await import('jszip');
    const zip = await Zip.loadAsync(buffer);
    await prepareParts?.(zip);
    for (const [filename, file] of Object.entries(zip.files)) {
      if (!file.dir && filename.endsWith('.rels')) {
        zip.file(filename, neutralizeOfficeRels(await file.async('text')));
      }
    }
    return await zip.generateAsync({ type: 'arraybuffer' });
  } catch (cause) {
    throw new Error(errorMessage, { cause });
  }
}
