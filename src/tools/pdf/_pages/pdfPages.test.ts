import { PDFArray, PDFDict, PDFDocument, PDFName, PDFPageLeaf } from 'pdf-lib';
import { expect, it } from 'vitest';
import { copyPagesToPdf, parseRanges } from './pdfPages';

it('accepts spaces around range dashes without losing the selected page groups', () => {
  expect(parseRanges('2 - 4, 6; 8 – 9, 11 -', 12)).toEqual([
    [2, 4],
    [6, 6],
    [8, 9],
    [11, 12],
  ]);
  expect(() => parseRanges('1- 3-4', 12)).toThrow();
  expect(parseRanges('7-\n9', 12)).toEqual([
    [7, 12],
    [9, 9],
  ]);
});

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
  const copiedField = reloaded.getForm().getTextField('Shared field');
  expect(copiedField.acroField.getWidgets()).toHaveLength(1);
  expect(copiedField.acroField.getWidgets()[0].P()).toBe(reloaded.getPage(0).ref);

  const full = await copyPagesToPdf(source, [1, 2]);
  const fullAnnots = full.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  expect(fullAnnots.size()).toBe(2);
  const copiedLink = full.context.lookup(fullAnnots.get(1));
  expect(copiedLink?.toString()).toContain(`/Dest [ ${full.getPage(1).ref} /Fit ]`);
  expect(full.getForm().getTextField('Shared field').acroField.getWidgets()).toHaveLength(2);
});

it('merges filled copies of a form with independently editable fields and their own page annotations', async () => {
  const makeSource = async (value: string, extraField = false) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const form = doc.getForm();
    for (const name of ['Applicant.Name', 'Applicant_2.Note', ...(extraField ? ['Applicant_3.Reference'] : [])]) {
      const field = form.createTextField(name);
      field.setText(value);
      field.addToPage(page);
    }
    const link = doc.context.obj({ Subtype: 'Link', Dest: [page.ref, 'Fit'] });
    page.node.addAnnot(doc.context.register(link));
    return PDFDocument.load(await doc.save(), { updateMetadata: false });
  };

  const first = await makeSource('Ada');
  const second = await makeSource('Grace', true);
  const firstBefore = await first.save();
  const secondBefore = await second.save();
  const output = await copyPagesToPdf(first, [1]);
  await copyPagesToPdf(second, [1], output);
  const merged = await PDFDocument.load(await output.save());
  const form = merged.getForm();
  const namesByPage = [
    ['Applicant.Name', 'Applicant_2.Note'],
    ['Applicant_4.Name', 'Applicant_2_2.Note', 'Applicant_3.Reference'],
  ];
  expect(form.getFields().map((field) => field.getName())).toEqual(namesByPage.flat());
  for (const [index, page] of merged.getPages().entries()) {
    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
    const names = namesByPage[index];
    expect(annots.size()).toBe(names.length + 1);
    for (const [position, name] of names.entries()) {
      const field = form.getTextField(name);
      expect(field.getText()).toBe(index === 0 ? 'Ada' : 'Grace');
      const [widget] = field.acroField.getWidgets();
      expect(widget.P()).toBe(page.ref);
      expect(annots.lookup(position, PDFDict)).toBe(widget.dict);
    }
    const link = annots.lookup(names.length, PDFDict);
    expect(link.get(PDFName.of('Subtype'))).toBe(PDFName.of('Link'));
    expect(link.lookup(PDFName.of('Dest'), PDFArray).get(0)).toBe(page.ref);
  }

  form.getTextField('Applicant.Name').setText('Ada Lovelace');
  expect(form.getTextField('Applicant_4.Name').getText()).toBe('Grace');
  form.getTextField('Applicant_4.Name').setText('Grace Hopper');
  const edited = (await PDFDocument.load(await merged.save())).getForm();
  expect(edited.getTextField('Applicant.Name').getText()).toBe('Ada Lovelace');
  expect(edited.getTextField('Applicant_4.Name').getText()).toBe('Grace Hopper');
  expect(await first.save()).toEqual(firstBefore);
  expect(await second.save()).toEqual(secondBefore);
});
