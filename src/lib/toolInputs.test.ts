import { describe, expect, it } from 'vitest';
import { classifyFile, isToolEligibleForFile } from './toolInputs';
import { fileKind, matchesAccept, suggestToolsForFiles } from './handoff';
import { getToolMeta } from '../tools/registry';

function createFile(name: string, type = ''): File {
  const blob = new Blob(['sample data'], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob as File;
}

describe('toolInputs and handoff classification', () => {
  it('classifies OpenDocument formats into opendocument grouping distinct from legacy-office', () => {
    const odt = classifyFile(createFile('document.odt'));
    expect(odt.format).toBe('opendocument');
    expect(odt.isOpenDocument).toBe(true);
    expect(odt.isLegacyOffice).toBe(false);
    expect(odt.isDocx).toBe(false);

    const fods = classifyFile(createFile('sheet.fods'));
    expect(fods.format).toBe('opendocument');
    expect(fods.isOpenDocument).toBe(true);
    expect(fods.isLegacyOffice).toBe(false);

    const odb = classifyFile(createFile('records.odb'));
    expect(odb.format).toBe('opendocument');
    expect(odb.isOpenDocument).toBe(true);

    const oxt = classifyFile(createFile('plugin.oxt'));
    expect(oxt.format).toBe('opendocument');
    expect(oxt.isOpenDocument).toBe(true);
  });

  it('classifies dotx as docx', () => {
    const dotx = classifyFile(createFile('template.dotx'));
    expect(dotx.format).toBe('docx');
    expect(dotx.isDocx).toBe(true);
    expect(matchesAccept(createFile('template.dotx'), '.docx')).toBe(true);
  });

  it('classifies legacy office, epub, and vsdx appropriately', () => {
    const doc = classifyFile(createFile('legacy.doc'));
    expect(doc.format).toBe('legacy-office');
    expect(doc.isLegacyOffice).toBe(true);
    expect(doc.isOpenDocument).toBe(false);

    const epub = classifyFile(createFile('book.epub'));
    expect(epub.format).toBe('epub');
    expect(epub.isEpub).toBe(true);

    const vsdx = classifyFile(createFile('chart.vsdx'));
    expect(vsdx.format).toBe('vsdx');
    expect(vsdx.isVsdx).toBe(true);
  });

  it('does not categorize odb or oxt as word in fileKind', () => {
    expect(fileKind(createFile('test.odb'))).not.toBe('word');
    expect(fileKind(createFile('test.oxt'))).not.toBe('word');
    expect(fileKind(createFile('test.odt'))).toBe('word');
    expect(fileKind(createFile('test.ods'))).toBe('excel');
    expect(fileKind(createFile('test.odp'))).toBe('powerpoint');
  });

  it('routes recognized types to generic file-converter and inspector, but not ODF to DOCX renderer', () => {
    const fileConverter = getToolMeta('file-converter');
    const fileInspector = getToolMeta('file-inspector');
    const wordToPdf = getToolMeta('pdf-word-to-pdf');
    const excelToPdf = getToolMeta('pdf-excel-to-pdf');
    const pptToPdf = getToolMeta('pdf-powerpoint-to-pdf');

    const odt = createFile('test.odt');
    expect(isToolEligibleForFile(fileConverter, odt)).toBe(true);
    expect(isToolEligibleForFile(fileInspector, odt)).toBe(true);
    expect(isToolEligibleForFile(wordToPdf, odt)).toBe(false);

    const dotx = createFile('test.dotx');
    expect(isToolEligibleForFile(fileConverter, dotx)).toBe(true);
    expect(isToolEligibleForFile(wordToPdf, dotx)).toBe(true);

    const xlsx = createFile('test.xlsx');
    expect(isToolEligibleForFile(fileConverter, xlsx)).toBe(true);
    expect(isToolEligibleForFile(excelToPdf, xlsx)).toBe(true);

    const pptx = createFile('test.pptx');
    expect(isToolEligibleForFile(fileConverter, pptx)).toBe(true);
    expect(isToolEligibleForFile(pptToPdf, pptx)).toBe(true);

    const suggestionsOdt = suggestToolsForFiles([odt]).map((t) => t.id);
    expect(suggestionsOdt).toContain('file-converter');
    expect(suggestionsOdt).toContain('file-inspector');
    expect(suggestionsOdt).not.toContain('pdf-word-to-pdf');
  });
});
