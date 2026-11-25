import { describe, expect, it } from 'vitest';
import { classifyFile, isToolEligibleForBatch, isToolEligibleForFile } from './toolInputs';
import { fileKind, matchesAccept, suggestToolsForFiles } from './handoff';
import { getToolMeta } from '../tools/registry';

function createFile(name: string, type = ''): File {
  const blob = new Blob(['sample data'], { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob as File;
}

describe('toolInputs and handoff classification', () => {
  it('offers inspection for an unknown extension that matches an object property', () => {
    const file = createFile('example.constructor');
    expect(classifyFile(file).format).toBe('unknown');
    expect(suggestToolsForFiles([file]).map((tool) => tool.id)).toContain('file-inspector');
  });

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

  it('classifies ordinary ZIP archives without reclassifying document packages', () => {
    const zip = createFile('assets.zip', 'application/zip');
    const docx = createFile('report.docx', 'application/zip');
    const odt = createFile('report.odt', 'application/zip');
    const zipExtractor = getToolMeta('zip-extract');

    expect(classifyFile(zip).format).toBe('zip');
    expect(classifyFile(docx).format).toBe('docx');
    expect(classifyFile(odt).format).toBe('opendocument');
    expect(isToolEligibleForFile(zipExtractor, zip)).toBe(true);
    expect(isToolEligibleForFile(zipExtractor, docx)).toBe(false);
    expect(matchesAccept(zip, '.zip')).toBe(true);
    expect(suggestToolsForFiles([zip]).map((tool) => tool.id)[0]).toBe('zip-extract');
  });

  it('routes SRT and VTT files to subtitles for import and editing', () => {
    for (const name of ['captions.srt', 'captions.vtt']) {
      const file = createFile(name);
      const classification = classifyFile(file);

      expect(classification.isSubtitle).toBe(true);
      expect(fileKind(file)).toBe('text');
      expect(isToolEligibleForFile(getToolMeta('subtitles'), file)).toBe(true);
      expect(suggestToolsForFiles([file]).map((tool) => tool.id)[0]).toBe('subtitles');
    }
  });

  it('ranks SVG optimization, audio trimming, and PDF metadata cleaning for matching outputs', () => {
    const svg = createFile('art.svg', 'image/svg+xml');
    const audio = createFile('voice.wav', 'audio/wav');
    const pdf = createFile('scan.pdf', 'application/pdf');

    expect(suggestToolsForFiles([svg]).map((tool) => tool.id)[0]).toBe('img-svg-optimize');
    expect(suggestToolsForFiles([audio]).map((tool) => tool.id)[0]).toBe('audio-trim');
    expect(suggestToolsForFiles([pdf]).map((tool) => tool.id)[0]).toBe('pdf-metadata-cleaner');
    expect(isToolEligibleForFile(getToolMeta('audio-trim'), audio)).toBe(true);
    expect(isToolEligibleForFile(getToolMeta('audio-trim'), createFile('clip.mp4', 'video/mp4'))).toBe(false);
    expect(isToolEligibleForFile(getToolMeta('pdf-metadata-cleaner'), pdf)).toBe(true);
    expect(isToolEligibleForFile(getToolMeta('pdf-metadata-cleaner'), svg)).toBe(false);
  });

  it('suggests image comparison only for exactly two supported images', () => {
    const first = createFile('first.png', 'image/png');
    const second = createFile('second.jpg', 'image/jpeg');
    const third = createFile('third.webp', 'image/webp');
    const compare = getToolMeta('img-compare');

    expect(isToolEligibleForFile(compare, first)).toBe(false);
    expect(isToolEligibleForBatch(compare, [first, second])).toBe(true);
    expect(isToolEligibleForBatch(compare, [first, second, third])).toBe(false);
    expect(isToolEligibleForBatch(compare, [first, createFile('archive.zip', 'application/zip')])).toBe(false);
    expect(suggestToolsForFiles([first, second]).map((tool) => tool.id)[0]).toBe('img-compare');
  });
});
