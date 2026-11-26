import { describe, expect, it } from 'vitest';
import { classifyFile, isToolEligibleForBatch, isToolEligibleForFile, VIEWER_ACCEPT } from './toolInputs';
import { fileKind, matchesAccept, setPendingFiles, suggestToolsForFiles, takePendingFiles } from './handoff';
import { MESH_ACCEPT } from '../tools/3d/_mesh/types';
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

  it('prioritizes editors for compatible single-file drops and preserves specialized routes', () => {
    for (const [name, path, accept] of [
      ['photo.jpg', '/image/photo-editor', 'image/*'],
      ['graphic.png', '/image/photo-editor', 'image/*'],
      ['clip.mp4', '/video/video-editor', 'video/*'],
      ['clip.mov', '/video/video-editor', 'video/*'],
      ['clip.webm', '/video/video-editor', 'video/*'],
    ]) {
      const file = createFile(name);
      expect(suggestToolsForFiles([file])[0].path).toBe(path);
      setPendingFiles([file], path);
      expect(takePendingFiles(path, accept)).toEqual({ accepted: [file], rejected: [] });
    }

    expect(suggestToolsForFiles([createFile('photo.heic')])[0].id).toBe('img-heic-to-jpg');
    expect(suggestToolsForFiles([createFile('clip.avi')])[0].id).toBe('video-health');
    expect(suggestToolsForFiles([createFile('voice.webm', 'audio/webm')]).map(({ id }) => id)).not.toContain('video-editor');

    const batch = suggestToolsForFiles([createFile('first.mp4'), createFile('second.webm')]).map(({ id }) => id);
    expect(batch[0]).toBe('merge');
    expect(batch).not.toContain('video-editor');
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
    const batch = suggestToolsForFiles([first, second]).map(({ id }) => id);
    expect(batch[0]).toBe('img-compare');
    expect(batch).not.toContain('img-photo-editor');
  });

  it('hands a single mesh or CAD drop to the 3D Viewer and keeps model batches on the merger', () => {
    const mesh = createFile('part.obj', 'text/plain');
    const cad = createFile('assembly.stp', 'application/octet-stream');

    for (const file of [mesh, cad]) {
      const [first] = suggestToolsForFiles([file]);
      setPendingFiles([file], first.path);
      const handoff = takePendingFiles(first.path, MESH_ACCEPT);

      expect(first.id).toBe('three-viewer');
      expect(first.path).toBe('/3d/viewer');
      expect(handoff).toEqual({ accepted: [file], rejected: [] });
    }

    expect(suggestToolsForFiles([mesh, cad]).map(({ id }) => id)).toEqual(['three-merge', 'batch-rename']);
    expect(isToolEligibleForFile(getToolMeta('three-viewer'), createFile('model.fbx', 'model/fbx'))).toBe(false);
  });

  it('offers only the 3D Viewer and file inspector for GLB and glTF scenes', () => {
    for (const file of [
      createFile('scene.glb'),
      createFile('scene.gltf', 'application/json'),
      createFile('scene', 'model/gltf-binary'),
      createFile('scene', 'model/gltf+json'),
    ]) {
      expect(fileKind(file)).toBe('3d');
      expect(matchesAccept(file, VIEWER_ACCEPT)).toBe(true);
      expect(matchesAccept(file, MESH_ACCEPT)).toBe(false);
      expect(suggestToolsForFiles([file]).map(({ id }) => id)).toEqual(['three-viewer', 'file-inspector']);
    }
  });

  it('hands off a scene and its companion files together', () => {
    const buffer = createFile('geometry.bin');
    const texture = createFile('albedo.png');
    const avif = createFile('albedo.avif', 'image/avif');
    const cad = createFile('part.step');

    expect(matchesAccept(avif, VIEWER_ACCEPT)).toBe(false);

    for (const scene of [createFile('scene.gltf'), createFile('scene.glb')]) {
      const files = [buffer, scene, texture];
      const suggestions = suggestToolsForFiles(files);
      expect(suggestions.map(({ id }) => id)).toEqual(['three-viewer', 'batch-rename']);

      setPendingFiles(files, suggestions[0].path);
      expect(takePendingFiles('/3d/viewer', VIEWER_ACCEPT, true)).toEqual({ accepted: files, rejected: [] });

      for (const batch of [
        [scene, cad],
        [scene, createFile('other.glb')],
        [scene, createFile('notes.txt')],
        [scene, avif],
        [buffer, texture],
      ]) {
        expect(suggestToolsForFiles(batch).map(({ id }) => id)).toEqual(['batch-rename']);
      }
    }
  });
});
