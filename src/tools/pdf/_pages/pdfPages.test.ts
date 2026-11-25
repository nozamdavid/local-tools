import { PDFArray, PDFDocument, PDFName, PDFPageLeaf } from 'pdf-lib';
import { expect, it } from 'vitest';
import { copyPagesToPdf } from './pdfPages';

it('omits excluded pages reached through a shared form and preserves links for later exports', async () => {
  const source = await PDFDocument.create();
  const first = source.addPage();
  const second = source.addPage();
  const field = source.getForm().createTextField('Shared field');
  field.addToPage(first);
  field.addToPage(second);

  const annots = first.node.lookup(PDFName.of('Annots'), PDFArray);
  const link = source.context.obj({ Subtype: 'Link', Dest: [second.ref, 'Fit'] });
  annots.push(source.context.register(link));

  const subset = await copyPagesToPdf(source, [1]);
  const reloaded = await PDFDocument.load(await subset.save());
  expect(reloaded.getPageCount()).toBe(1);
  expect(reloaded.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFPageLeaf)).toHaveLength(1);
  expect(reloaded.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).size()).toBe(1);

  const full = await copyPagesToPdf(source, [1, 2]);
  const fullAnnots = full.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  expect(fullAnnots.size()).toBe(2);
  const copiedLink = full.context.lookup(fullAnnots.get(1));
  expect(copiedLink?.toString()).toContain(`/Dest [ ${full.getPage(1).ref} /Fit ]`);
});
