import { suggestToolsForFiles, setPendingFiles, clearPendingFiles, peekPendingFiles, takePendingFiles, matchesAccept } from './handoff';
import { isToolEligibleForBatch } from './toolInputs';
import { getToolMeta } from '../tools/registry';
import { parseCsv, detectDelimiter } from '../tools/_tabular/csv';

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export interface VerificationSummary {
  passed: boolean;
  total: number;
  passedCount: number;
  failedCount: number;
  results: TestResult[];
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasNoDuplicates(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}

export function runHandoffVerification(): VerificationSummary {
  const results: TestResult[] = [];

  const runTest = (name: string, fn: () => void) => {
    try {
      fn();
      results.push({ name, passed: true });
    } catch (err) {
      results.push({
        name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // 1. PNG: includes img-png-to-jpg and generics, excludes reverse/incompatible converters
  runTest('PNG: includes img-png-to-jpg, excludes reverse/incompatible tools', () => {
    const file = new File(['dummy'], 'example.png', { type: 'image/png' });
    const suggestions = suggestToolsForFiles([file]);
    const ids = suggestions.map((t) => t.id);
    const first12 = ids.slice(0, 12);

    assert(hasNoDuplicates(ids), `PNG results contain duplicates: ${ids.join(', ')}`);
    assert(ids.includes('img-png-to-jpg'), 'PNG suggestions must include img-png-to-jpg');
    assert(first12.includes('img-png-to-jpg'), 'First 12 PNG suggestions must include img-png-to-jpg');

    const forbidden = ['img-jpg-to-png', 'img-heic-to-jpg', 'img-webp-to-jpg', 'img-webp-to-png', 'img-svg-to-png', 'pdf-jpg-to-pdf'];
    for (const toolId of forbidden) {
      assert(!ids.includes(toolId), `PNG suggestions must NOT contain ${toolId}`);
      assert(!first12.includes(toolId), `First 12 PNG suggestions must NOT contain ${toolId}`);
    }

    const expectedGeneric = [
      'img-compress',
      'img-resize',
      'img-convert',
      'img-image-to-webp',
      'img-image-to-svg',
      'img-image-to-pdf',
      'file-converter',
    ];
    for (const toolId of expectedGeneric) {
      assert(ids.includes(toolId), `PNG suggestions should include generic tool ${toolId}`);
    }
  });

  // 2. JPEG aliases (.jpg, .jpeg, .jpe)
  runTest('JPEG aliases: .jpg, .jpeg, .jpe suggest jpg-to-png and pdf-jpg-to-pdf, exclude reverse tools', () => {
    const extList = [
      { name: 'photo.jpg', type: 'image/jpeg' },
      { name: 'photo.jpeg', type: 'image/jpeg' },
      { name: 'photo.jpe', type: 'image/jpeg' },
    ];

    for (const item of extList) {
      const file = new File(['dummy'], item.name, { type: item.type });
      const suggestions = suggestToolsForFiles([file]);
      const ids = suggestions.map((t) => t.id);
      const first12 = ids.slice(0, 12);

      assert(hasNoDuplicates(ids), `${item.name} contains duplicates: ${ids.join(', ')}`);
      assert(ids.includes('img-jpg-to-png'), `${item.name} must include img-jpg-to-png`);
      assert(first12.includes('img-jpg-to-png'), `${item.name} first 12 must include img-jpg-to-png`);
      assert(ids.includes('pdf-jpg-to-pdf'), `${item.name} must include pdf-jpg-to-pdf`);
      assert(first12.includes('pdf-jpg-to-pdf'), `${item.name} first 12 must include pdf-jpg-to-pdf`);

      const forbidden = ['img-png-to-jpg', 'img-heic-to-jpg', 'img-webp-to-jpg', 'img-webp-to-png', 'img-svg-to-png'];
      for (const toolId of forbidden) {
        assert(!ids.includes(toolId), `${item.name} must NOT contain ${toolId}`);
        assert(!first12.includes(toolId), `${item.name} first 12 must NOT contain ${toolId}`);
      }
    }
  });

  // 3. WebP: excludes self-conversion (img-image-to-webp) and reverse tools
  runTest('WebP: includes webp-to-jpg/png, excludes reverse tools and self-conversion', () => {
    const file = new File(['dummy'], 'photo.webp', { type: 'image/webp' });
    const suggestions = suggestToolsForFiles([file]);
    const ids = suggestions.map((t) => t.id);
    const first12 = ids.slice(0, 12);

    assert(hasNoDuplicates(ids), `WebP results contain duplicates: ${ids.join(', ')}`);
    assert(ids.includes('img-webp-to-jpg'), 'WebP suggestions must include img-webp-to-jpg');
    assert(ids.includes('img-webp-to-png'), 'WebP suggestions must include img-webp-to-png');
    assert(first12.includes('img-webp-to-jpg'), 'First 12 WebP suggestions must include img-webp-to-jpg');
    assert(first12.includes('img-webp-to-png'), 'First 12 WebP suggestions must include img-webp-to-png');

    const forbidden = ['img-image-to-webp', 'img-png-to-jpg', 'img-jpg-to-png', 'img-heic-to-jpg', 'img-svg-to-png'];
    for (const toolId of forbidden) {
      assert(!ids.includes(toolId), `WebP suggestions must NOT contain ${toolId}`);
    }

    assert(ids.includes('img-compress'), 'WebP should retain generic tool img-compress');
    assert(ids.includes('img-convert'), 'WebP should retain generic tool img-convert');
  });

  // 4. HEIC / HEIF: includes heic-to-jpg, exif-viewer
  runTest('HEIC/HEIF: includes heic-to-jpg and exif-viewer, excludes reverse tools', () => {
    for (const filename of ['photo.heic', 'photo.heif']) {
      const mime = filename.endsWith('.heic') ? 'image/heic' : 'image/heif';
      const file = new File(['dummy'], filename, { type: mime });
      const suggestions = suggestToolsForFiles([file]);
      const ids = suggestions.map((t) => t.id);
      const first12 = ids.slice(0, 12);

      assert(hasNoDuplicates(ids), `${filename} contains duplicates: ${ids.join(', ')}`);
      assert(ids.includes('img-heic-to-jpg'), `${filename} must include img-heic-to-jpg`);
      assert(ids.includes('img-exif-viewer'), `${filename} must include img-exif-viewer`);
      assert(first12.includes('img-heic-to-jpg'), `${filename} first 12 must include img-heic-to-jpg`);

      const forbidden = ['img-png-to-jpg', 'img-jpg-to-png', 'img-webp-to-jpg', 'img-webp-to-png', 'img-svg-to-png'];
      for (const toolId of forbidden) {
        assert(!ids.includes(toolId), `${filename} must NOT contain ${toolId}`);
      }
    }
  });

  // 5. SVG: vector XML, excludes camera EXIF, raster sketch, raster-to-svg
  runTest('SVG: includes svg-to-png, excludes camera EXIF, raster sketch, and raster-to-svg', () => {
    const file = new File(['<svg></svg>'], 'vector.svg', { type: 'image/svg+xml' });
    const suggestions = suggestToolsForFiles([file]);
    const ids = suggestions.map((t) => t.id);

    assert(hasNoDuplicates(ids), `SVG contains duplicates: ${ids.join(', ')}`);
    assert(ids.includes('img-svg-to-png'), 'SVG suggestions must include img-svg-to-png');

    const forbidden = [
      'img-image-to-svg',
      'img-exif-viewer',
      'img-exif-remover',
      'img-photo-to-sketch',
      'img-png-to-jpg',
      'img-jpg-to-png',
      'img-heic-to-jpg',
      'img-webp-to-jpg',
      'img-webp-to-png',
    ];
    for (const toolId of forbidden) {
      assert(!ids.includes(toolId), `SVG must NOT contain ${toolId}`);
    }
  });

  // 6. GIF and BMP: general images, exclude camera exif-viewer
  runTest('GIF and BMP: accept general images, exclude exif-viewer', () => {
    for (const item of [
      { name: 'anim.gif', type: 'image/gif' },
      { name: 'bitmap.bmp', type: 'image/bmp' },
    ]) {
      const file = new File(['dummy'], item.name, { type: item.type });
      const ids = suggestToolsForFiles([file]).map((t) => t.id);
      assert(hasNoDuplicates(ids), `${item.name} has duplicates`);
      assert(ids.includes('img-compress') || ids.includes('img-resize'), `${item.name} should include generic editor`);
      assert(!ids.includes('img-exif-viewer'), `${item.name} must NOT contain img-exif-viewer`);
    }
  });

  // 7. ICO: icon converter and file inspector, excludes canvas editors and exif
  runTest('ICO: suggests icon-converter, excludes canvas editors', () => {
    const file = new File(['dummy'], 'favicon.ico', { type: 'image/x-icon' });
    const ids = suggestToolsForFiles([file]).map((t) => t.id);
    assert(hasNoDuplicates(ids), `ICO contains duplicates: ${ids.join(', ')}`);
    assert(ids.includes('img-icon-converter'), 'ICO must include img-icon-converter');
    assert(ids.includes('file-converter'), 'ICO must include file-converter');
    assert(ids.includes('file-inspector'), 'ICO must include file-inspector');
    assert(!ids.includes('img-crop'), 'ICO must NOT contain img-crop');
    assert(!ids.includes('img-rotate'), 'ICO must NOT contain img-rotate');
    assert(!ids.includes('img-exif-viewer'), 'ICO must NOT contain img-exif-viewer');
  });

  // 8. AVIF and JXL: modern images, exclude exif-viewer
  runTest('AVIF and JXL: accept image tools, exclude exif-viewer', () => {
    for (const item of [
      { name: 'photo.avif', type: 'image/avif' },
      { name: 'photo.jxl', type: 'image/jxl' },
    ]) {
      const file = new File(['dummy'], item.name, { type: item.type });
      const ids = suggestToolsForFiles([file]).map((t) => t.id);
      assert(hasNoDuplicates(ids), `${item.name} has duplicates`);
      assert(ids.includes('img-convert'), `${item.name} should include img-convert`);
      assert(!ids.includes('img-exif-viewer'), `${item.name} must NOT contain img-exif-viewer`);
    }
  });

  // 9. TIFF: supported by exif-viewer, file-converter, but not exif-remover or standard canvas tools
  runTest('TIFF: suggests exif-viewer and file converter, excludes exif-remover and canvas editors without decoder', () => {
    const file = new File(['dummy'], 'scan.tiff', { type: 'image/tiff' });
    const ids = suggestToolsForFiles([file]).map((t) => t.id);
    assert(hasNoDuplicates(ids), `TIFF contains duplicates: ${ids.join(', ')}`);
    assert(ids.includes('img-exif-viewer'), 'TIFF must include img-exif-viewer');
    assert(!ids.includes('img-exif-remover'), 'TIFF must NOT contain img-exif-remover');
    assert(ids.includes('file-converter'), 'TIFF must include file-converter');
    assert(ids.includes('file-inspector'), 'TIFF must include file-inspector');
    assert(!ids.includes('img-crop'), 'TIFF must NOT contain img-crop');
    assert(!ids.includes('img-rotate'), 'TIFF must NOT contain img-rotate');

    // TIFF batch also excludes img-exif-remover
    const tiff1 = new File(['dummy1'], 'scan1.tiff', { type: 'image/tiff' });
    const tiff2 = new File(['dummy2'], 'scan2.tiff', { type: 'image/tiff' });
    const batchIds = suggestToolsForFiles([tiff1, tiff2]).map((t) => t.id);
    assert(!batchIds.includes('img-exif-remover'), 'TIFF batch must NOT include img-exif-remover');
  });

  // 10. Video containers (MP4, WebM, MOV, MKV, AVI): include video-health and video tools
  runTest('Video containers: MP4, WebM, MOV, MKV, AVI include video-health and video tools', () => {
    for (const ext of ['mp4', 'webm', 'mov', 'mkv', 'avi']) {
      const file = new File(['dummy'], `sample.${ext}`, { type: '' });
      const ids = suggestToolsForFiles([file]).map((t) => t.id);
      assert(hasNoDuplicates(ids), `${ext} has duplicates`);
      assert(ids.includes('video-health'), `${ext} must include video-health`);
      assert(ids.includes('convert'), `${ext} must include video convert`);
      assert(ids.includes('compress'), `${ext} must include video compress`);
      assert(ids.includes('trim'), `${ext} must include trim`);
      assert(!ids.includes('img-convert'), `${ext} must NOT contain img-convert`);
      assert(!ids.includes('pdf-merge'), `${ext} must NOT contain pdf-merge`);
    }
  });

  // 11. Audio formats: MP3, WAV, M4A, OGG include speech/speed tools, exclude video-only
  runTest('Audio formats: MP3, WAV, M4A, OGG include audio tools, exclude video-only', () => {
    for (const item of [
      { name: 'voice.mp3', type: 'audio/mpeg' },
      { name: 'voice.wav', type: 'audio/wav' },
      { name: 'voice.m4a', type: 'audio/mp4' },
      { name: 'voice.ogg', type: 'audio/ogg' },
    ]) {
      const file = new File(['dummy'], item.name, { type: item.type });
      const ids = suggestToolsForFiles([file]).map((t) => t.id);
      assert(hasNoDuplicates(ids), `${item.name} has duplicates`);
      assert(ids.includes('video-to-text'), `${item.name} must include video-to-text`);
      assert(ids.includes('subtitles'), `${item.name} must include subtitles`);
      assert(ids.includes('video-info'), `${item.name} must include video-info`);
      assert(ids.includes('media-speed'), `${item.name} must include media-speed`);
      assert(ids.includes('file-converter'), `${item.name} must include file-converter`);

      const videoOnly = [
        'trim',
        'crop',
        'loop',
        'resize',
        'merge',
        'compress',
        'audio-extract',
        'remove-audio',
        'boost-volume',
        'video-health',
      ];
      for (const vId of videoOnly) {
        assert(!ids.includes(vId), `${item.name} must NOT contain video-only tool ${vId}`);
      }
    }
  });

  // 12. Audio vs Video distinction for WebM
  runTest('WebM distinction: audio/webm vs video/webm', () => {
    const audioWebm = new File(['dummy'], 'track.webm', { type: 'audio/webm' });
    const audioIds = suggestToolsForFiles([audioWebm]).map((t) => t.id);
    assert(audioIds.includes('video-to-text'), 'audio/webm must include video-to-text');
    assert(!audioIds.includes('video-health'), 'audio/webm must NOT include video-health');
    assert(!audioIds.includes('trim'), 'audio/webm must NOT include trim');

    const videoWebm = new File(['dummy'], 'clip.webm', { type: 'video/webm' });
    const videoIds = suggestToolsForFiles([videoWebm]).map((t) => t.id);
    assert(videoIds.includes('video-health'), 'video/webm must include video-health');
    assert(videoIds.includes('trim'), 'video/webm must include trim');
  });

  // 13. PDF single file: preserves direction, excludes X-to-pdf and multi-pdf tools
  runTest('PDF: preserves direction, excludes X-to-pdf converters and multi-file tools for single file', () => {
    const file = new File(['dummy'], 'document.pdf', { type: 'application/pdf' });
    const ids = suggestToolsForFiles([file]).map((t) => t.id);

    assert(hasNoDuplicates(ids), `PDF contains duplicates: ${ids.join(', ')}`);
    assert(ids.includes('pdf-split'), 'PDF must include pdf-split');
    assert(ids.includes('pdf-compress'), 'PDF must include pdf-compress');
    assert(ids.includes('pdf-pdf-to-jpg'), 'PDF must include pdf-pdf-to-jpg');
    assert(ids.includes('pdf-pdf-to-word'), 'PDF must include pdf-pdf-to-word');
    assert(ids.includes('img-pdf-to-image'), 'PDF must include img-pdf-to-image');

    const forbidden = [
      'pdf-word-to-pdf',
      'pdf-jpg-to-pdf',
      'pdf-powerpoint-to-pdf',
      'pdf-excel-to-pdf',
      'pdf-html-to-pdf',
      'pdf-merge',
      'pdf-compare',
      'img-png-to-jpg',
      'img-jpg-to-png',
    ];
    for (const toolId of forbidden) {
      assert(!ids.includes(toolId), `PDF must NOT contain ${toolId}`);
    }
  });

  // 14. Modern Office: DOCX, XLSX, PPTX
  runTest('Office: DOCX, XLSX, PPTX input contracts', () => {
    const docx = new File(['dummy'], 'document.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const docxIds = suggestToolsForFiles([docx]).map((t) => t.id);
    assert(docxIds.includes('pdf-word-to-pdf'), 'DOCX must include pdf-word-to-pdf');
    assert(docxIds.includes('img-docx-to-jpg'), 'DOCX must include img-docx-to-jpg');
    assert(docxIds.includes('img-docx-to-png'), 'DOCX must include img-docx-to-png');
    assert(docxIds.includes('file-converter'), 'DOCX must include file-converter');
    assert(!docxIds.includes('pdf-pdf-to-word'), 'DOCX must NOT contain pdf-pdf-to-word');

    const xlsx = new File(['dummy'], 'data.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const xlsxIds = suggestToolsForFiles([xlsx]).map((t) => t.id);
    assert(xlsxIds.includes('pdf-excel-to-pdf'), 'XLSX must include pdf-excel-to-pdf');
    assert(!xlsxIds.includes('file-converter'), 'XLSX is not in file-converter matrix');

    const pptx = new File(['dummy'], 'slides.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    const pptxIds = suggestToolsForFiles([pptx]).map((t) => t.id);
    assert(pptxIds.includes('pdf-powerpoint-to-pdf'), 'PPTX must include pdf-powerpoint-to-pdf');
    assert(!pptxIds.includes('file-converter'), 'PPTX is not in file-converter matrix');
  });

  // 15. Unsupported Legacy Office: .doc, .xls, .ppt, .odt, .ods, .odp, .rtf
  runTest('Legacy Office: exclude converters, suggest file-inspector', () => {
    const legacyNames = ['old.doc', 'sheet.xls', 'deck.ppt', 'doc.odt', 'table.ods', 'notes.rtf'];
    for (const name of legacyNames) {
      const file = new File(['dummy'], name, { type: '' });
      const ids = suggestToolsForFiles([file]).map((t) => t.id);
      assert(ids.includes('file-inspector'), `${name} must include file-inspector`);
      assert(!ids.includes('file-converter'), `${name} must NOT include file-converter`);
      assert(!ids.includes('pdf-word-to-pdf'), `${name} must NOT include pdf-word-to-pdf`);
      assert(!ids.includes('pdf-excel-to-pdf'), `${name} must NOT include pdf-excel-to-pdf`);
      assert(!ids.includes('pdf-powerpoint-to-pdf'), `${name} must NOT include pdf-powerpoint-to-pdf`);
    }
  });

  // 16. Web formats: HTML, MHTML, CSS
  runTest('Web formats: HTML, MHTML, CSS distinct contracts', () => {
    const htmlFile = new File(['<html></html>'], 'page.html', { type: 'text/html' });
    const htmlIds = suggestToolsForFiles([htmlFile]).map((t) => t.id);
    assert(htmlIds.includes('pdf-html-to-pdf'), 'HTML must include pdf-html-to-pdf');
    assert(!htmlIds.includes('mhtml-to-html'), 'HTML must NOT include mhtml-to-html');
    assert(!htmlIds.includes('css-viewer'), 'HTML must NOT include css-viewer');

    const mhtmlFile = new File(['mime'], 'archive.mhtml', { type: 'message/rfc822' });
    const mhtmlIds = suggestToolsForFiles([mhtmlFile]).map((t) => t.id);
    assert(mhtmlIds.includes('mhtml-to-html'), 'MHTML must include mhtml-to-html');
    assert(!mhtmlIds.includes('pdf-html-to-pdf'), 'MHTML must NOT include pdf-html-to-pdf');

    const cssFile = new File(['body{}'], 'style.css', { type: 'text/css' });
    const cssIds = suggestToolsForFiles([cssFile]).map((t) => t.id);
    assert(cssIds.includes('css-viewer'), 'CSS must include css-viewer');
    assert(!cssIds.includes('mhtml-to-html'), 'CSS must NOT include mhtml-to-html');
  });

  // 17. Data and text formats: JSON, CSV, TSV, TXT, LOG, GPX, KML, XML
  runTest('Data and text: JSON, CSV, TSV, TXT, LOG, GPX, KML, XML', () => {
    const jsonFile = new File(['{}'], 'data.json', { type: 'application/json' });
    const jsonIds = suggestToolsForFiles([jsonFile]).map((t) => t.id);
    assert(jsonIds.includes('json-csv'), 'JSON must include json-csv');
    assert(jsonIds.includes('file-converter'), 'JSON must include file-converter');
    assert(!jsonIds.includes('csv-viewer'), 'JSON must NOT include csv-viewer');

    const csvFile = new File(['a,b'], 'data.csv', { type: 'text/csv' });
    const csvIds = suggestToolsForFiles([csvFile]).map((t) => t.id);
    assert(csvIds.includes('csv-viewer'), 'CSV must include csv-viewer');
    assert(csvIds.includes('json-csv'), 'CSV must include json-csv');

    const tsvFile = new File(['a\tb'], 'data.tsv', { type: 'text/tab-separated-values' });
    const tsvIds = suggestToolsForFiles([tsvFile]).map((t) => t.id);
    assert(tsvIds.includes('csv-viewer'), 'TSV must include csv-viewer');
    assert(tsvIds.includes('txt-to-csv'), 'TSV must include txt-to-csv');

    const txtFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const txtIds = suggestToolsForFiles([txtFile]).map((t) => t.id);
    assert(txtIds.includes('txt-to-csv'), 'TXT must include txt-to-csv');

    const gpxFile = new File(['<gpx></gpx>'], 'track.gpx', { type: 'application/gpx+xml' });
    const gpxIds = suggestToolsForFiles([gpxFile]).map((t) => t.id);
    assert(gpxIds.includes('gpx-kml'), 'GPX must include gpx-kml');

    const kmlFile = new File(['<kml></kml>'], 'doc.kml', { type: 'application/vnd.google-earth.kml+xml' });
    const kmlIds = suggestToolsForFiles([kmlFile]).map((t) => t.id);
    assert(kmlIds.includes('gpx-kml'), 'KML must include gpx-kml');

    const xmlFile = new File(['<data></data>'], 'generic.xml', { type: 'application/xml' });
    const xmlIds = suggestToolsForFiles([xmlFile]).map((t) => t.id);
    assert(xmlIds.includes('file-inspector'), 'Ambiguous XML must include file-inspector');
    assert(!xmlIds.includes('gpx-kml'), 'Ambiguous XML must NOT include gpx-kml');
    assert(!xmlIds.includes('img-svg-to-png'), 'Ambiguous XML must NOT include img-svg-to-png');
  });

  // 18. Unknown binary: suggests file-inspector, excludes file-converter
  runTest('Unknown binary: suggests file-inspector, excludes file-converter and format-specific tools', () => {
    const file = new File(['\x00\x01\x02'], 'firmware.bin', { type: 'application/octet-stream' });
    const ids = suggestToolsForFiles([file]).map((t) => t.id);
    assert(ids.includes('file-inspector'), 'Unknown binary must include file-inspector');
    assert(!ids.includes('file-converter'), 'Unknown binary must NOT include file-converter');
    assert(!ids.includes('img-convert'), 'Unknown binary must NOT include img-convert');
    assert(!ids.includes('convert'), 'Unknown binary must NOT include video convert');
  });

  // 19. Normalization: uppercase, blank MIME, octet-stream fallback, MIME-only
  runTest('Normalization: uppercase, blank MIME, octet-stream fallback, MIME-only', () => {
    const upperJpg = new File(['dummy'], 'PHOTO.JPG', { type: '' });
    const upperIds = suggestToolsForFiles([upperJpg]).map((t) => t.id);
    assert(upperIds.includes('img-jpg-to-png'), 'PHOTO.JPG must include img-jpg-to-png');

    const octetPng = new File(['dummy'], 'image.png', { type: 'application/octet-stream' });
    const octetIds = suggestToolsForFiles([octetPng]).map((t) => t.id);
    assert(octetIds.includes('img-png-to-jpg'), 'PNG with octet-stream must include img-png-to-jpg');

    const noExtPng = new File(['dummy'], 'blob', { type: 'image/png' });
    const noExtIds = suggestToolsForFiles([noExtPng]).map((t) => t.id);
    assert(noExtIds.includes('img-png-to-jpg'), 'Extensionless image/png must include img-png-to-jpg');
  });

  // 20. Multi-file: 2 images vs 10 images
  runTest('Multi-file: 2 images vs 10 images', () => {
    const img1 = new File(['dummy1'], 'p1.png', { type: 'image/png' });
    const img2 = new File(['dummy2'], 'p2.png', { type: 'image/png' });
    const ids2 = suggestToolsForFiles([img1, img2]).map((t) => t.id);

    assert(hasNoDuplicates(ids2), `2 images has duplicates: ${ids2.join(', ')}`);
    assert(ids2.includes('batch-rename'), '2 images must include batch-rename');
    assert(ids2.includes('img-merge'), '2 images must include img-merge');
    assert(ids2.includes('img-collage'), '2 images must include img-collage');
    assert(ids2.includes('img-bulk-convert'), '2 images must include img-bulk-convert');
    assert(!ids2.includes('img-crop'), '2 images must NOT include single-file editor img-crop');
    assert(!ids2.includes('img-rotate'), '2 images must NOT include single-file editor img-rotate');

    const tenImages = Array.from({ length: 10 }, (_, i) => new File(['d'], `p${i}.png`, { type: 'image/png' }));
    const ids10 = suggestToolsForFiles(tenImages).map((t) => t.id);
    assert(ids10.includes('img-merge'), '10 images can merge');
    assert(!ids10.includes('img-collage'), '10 images must NOT include collage (max 9)');
  });

  // 21. Multi-file: Mixed JPEG/PNG batch excludes JPG-to-PDF but retains Image-to-PDF
  runTest('Multi-file: Mixed JPEG/PNG batch excludes JPG-to-PDF but retains Image-to-PDF', () => {
    const jpg = new File(['dummy1'], 'photo.jpg', { type: 'image/jpeg' });
    const png = new File(['dummy2'], 'image.png', { type: 'image/png' });
    const ids = suggestToolsForFiles([jpg, png]).map((t) => t.id);

    assert(!ids.includes('pdf-jpg-to-pdf'), 'Mixed JPEG/PNG batch must NOT include pdf-jpg-to-pdf');
    assert(ids.includes('img-image-to-pdf'), 'Mixed JPEG/PNG batch must include img-image-to-pdf');

    const jpg2 = new File(['dummy3'], 'photo2.jpg', { type: 'image/jpeg' });
    const allJpgIds = suggestToolsForFiles([jpg, jpg2]).map((t) => t.id);
    assert(allJpgIds.includes('pdf-jpg-to-pdf'), 'All-JPEG batch must include pdf-jpg-to-pdf');
  });

  // 22. Multi-file: Heterogeneous selection (image + PDF)
  runTest('Multi-file: Heterogeneous selection (image + PDF)', () => {
    const img = new File(['dummy'], 'photo.png', { type: 'image/png' });
    const pdf = new File(['dummy'], 'doc.pdf', { type: 'application/pdf' });
    const ids = suggestToolsForFiles([img, pdf]).map((t) => t.id);

    assert(ids.includes('batch-rename'), 'Heterogeneous selection must include batch-rename');
    assert(!ids.includes('img-merge'), 'Heterogeneous selection must NOT include img-merge');
    assert(!ids.includes('pdf-merge'), 'Heterogeneous selection must NOT include pdf-merge');
    assert(!ids.includes('img-crop'), 'Heterogeneous selection must NOT include img-crop');
    assert(!ids.includes('pdf-split'), 'Heterogeneous selection must NOT include pdf-split');
  });

  // 23. Multi-file: 2 PDFs vs 3 PDFs
  runTest('Multi-file: 2 PDFs vs 3 PDFs', () => {
    const pdf1 = new File(['d1'], 'doc1.pdf', { type: 'application/pdf' });
    const pdf2 = new File(['d2'], 'doc2.pdf', { type: 'application/pdf' });
    const pdf3 = new File(['d3'], 'doc3.pdf', { type: 'application/pdf' });

    const ids2 = suggestToolsForFiles([pdf1, pdf2]).map((t) => t.id);
    assert(ids2.includes('pdf-merge'), '2 PDFs must include pdf-merge');
    assert(ids2.includes('pdf-compare'), '2 PDFs must include pdf-compare');
    assert(ids2.includes('batch-rename'), '2 PDFs must include batch-rename');
    assert(!ids2.includes('pdf-split'), '2 PDFs must NOT include pdf-split');

    const ids3 = suggestToolsForFiles([pdf1, pdf2, pdf3]).map((t) => t.id);
    assert(ids3.includes('pdf-merge'), '3 PDFs must include pdf-merge');
    assert(!ids3.includes('pdf-compare'), '3 PDFs must NOT include pdf-compare (requires exactly 2)');
  });

  // 24. Multi-file: JSON / CSV batches
  runTest('Multi-file: JSON and CSV batches', () => {
    const json1 = new File(['{}'], 'j1.json', { type: 'application/json' });
    const json2 = new File(['{}'], 'j2.json', { type: 'application/json' });
    const jsonIds = suggestToolsForFiles([json1, json2]).map((t) => t.id);
    assert(jsonIds.includes('json-csv'), '2 JSONs must include json-csv');
    assert(jsonIds.includes('batch-rename'), '2 JSONs must include batch-rename');

    const csv1 = new File(['a'], 'c1.csv', { type: 'text/csv' });
    const mixedIds = suggestToolsForFiles([json1, csv1]).map((t) => t.id);
    assert(!mixedIds.includes('json-csv'), 'Mixed JSON and CSV must NOT include json-csv');
    assert(mixedIds.includes('batch-rename'), 'Mixed JSON and CSV must include batch-rename');
  });

  // 25. Ranking: batch-rename always in top 12 for multi-file
  runTest('Ranking: batch-rename always in top 12 for multi-file selections', () => {
    const img1 = new File(['d1'], 'a.png', { type: 'image/png' });
    const img2 = new File(['d2'], 'b.png', { type: 'image/png' });
    const first12 = suggestToolsForFiles([img1, img2])
      .slice(0, 12)
      .map((t) => t.id);
    assert(first12.includes('batch-rename'), 'batch-rename must be in first 12 for multi-image drop');
  });

  // 26. Empty file list returns empty array
  runTest('Empty file list: returns empty array', () => {
    const suggestions = suggestToolsForFiles([]);
    assert(Array.isArray(suggestions) && suggestions.length === 0, 'Empty file list must return []');
  });

  // 27. Peek and Take API contracts
  runTest('Peek and Take: non-consuming peek, path and TTL checks, take consumption', () => {
    clearPendingFiles();
    const f1 = new File(['data'], 'test.txt', { type: 'text/plain' });

    assert(peekPendingFiles('/csv-viewer') === null, 'Peek when empty must return null');

    setPendingFiles([f1], '/csv-viewer');
    assert(peekPendingFiles('/other-path') === null, 'Peek with wrong path must return null');

    const peek1 = peekPendingFiles('/csv-viewer');
    assert(peek1 !== null && peek1.length === 1 && peek1[0] === f1, 'Peek should return pending files');

    const peek2 = peekPendingFiles('/csv-viewer');
    assert(peek2 !== null && peek2.length === 1 && peek2[0] === f1, 'Peek must NOT consume pending files');

    const taken = takePendingFiles('/csv-viewer');
    assert(taken !== null && taken.accepted.length === 1 && taken.accepted[0] === f1, 'Take should return files');

    assert(peekPendingFiles('/csv-viewer') === null, 'Peek after take must return null (consumed)');
    assert(takePendingFiles('/csv-viewer') === null, 'Second take must return null (already consumed)');
    clearPendingFiles();
  });

  // 28. Extensionless files with recognized MIME
  runTest('Extensionless files: recognized MIME for CSV, TSV, JSON, GPX, KML', () => {
    const csvFile = new File(['a,b\n1,2'], 'raw_csv_stream', { type: 'text/csv' });
    const csvIds = suggestToolsForFiles([csvFile]).map((t) => t.id);
    assert(csvIds.includes('json-csv'), 'Extensionless text/csv must include json-csv');
    assert(csvIds.includes('csv-viewer'), 'Extensionless text/csv must include csv-viewer');
    assert(
      matchesAccept(csvFile, '.json,application/json,.csv,.tsv,text/csv,text/tab-separated-values,text/*'),
      'Extensionless CSV matches json-csv accept',
    );

    const tsvFile = new File(['a\tb\n1\t2'], 'raw_tsv_stream', { type: 'text/tab-separated-values' });
    const tsvIds = suggestToolsForFiles([tsvFile]).map((t) => t.id);
    assert(tsvIds.includes('json-csv'), 'Extensionless text/tab-separated-values must include json-csv');
    assert(tsvIds.includes('csv-viewer'), 'Extensionless text/tab-separated-values must include csv-viewer');
    assert(
      matchesAccept(tsvFile, '.json,application/json,.csv,.tsv,text/csv,text/tab-separated-values,text/*'),
      'Extensionless TSV matches json-csv accept',
    );

    const jsonFile = new File(['{"key":"value"}'], 'raw_json_stream', { type: 'application/json' });
    const jsonIds = suggestToolsForFiles([jsonFile]).map((t) => t.id);
    assert(jsonIds.includes('json-csv'), 'Extensionless application/json must include json-csv');

    const gpxFile = new File(['<gpx version="1.1"></gpx>'], 'raw_gpx_stream', { type: 'application/gpx+xml' });
    const gpxIds = suggestToolsForFiles([gpxFile]).map((t) => t.id);
    assert(gpxIds.includes('gpx-kml'), 'Extensionless application/gpx+xml must include gpx-kml');
    assert(
      matchesAccept(gpxFile, '.gpx,.kml,.xml,application/gpx+xml,application/vnd.google-earth.kml+xml'),
      'Extensionless GPX matches gpx-kml accept',
    );

    const kmlFile = new File(['<kml></kml>'], 'raw_kml_stream', { type: 'application/vnd.google-earth.kml+xml' });
    const kmlIds = suggestToolsForFiles([kmlFile]).map((t) => t.id);
    assert(kmlIds.includes('gpx-kml'), 'Extensionless application/vnd.google-earth.kml+xml must include gpx-kml');
    assert(
      matchesAccept(kmlFile, '.gpx,.kml,.xml,application/gpx+xml,application/vnd.google-earth.kml+xml'),
      'Extensionless KML matches gpx-kml accept',
    );
  });

  // 29. Mixed TSV + CSV batch delimiter autodetection and parsing
  runTest('Mixed TSV + CSV batch: per-file delimiter autodetection and parsing', () => {
    const tsvFile = new File(['name\tage\nAlice\t30'], 'records.tsv', { type: 'text/tab-separated-values' });
    const csvFile = new File(['city,country\nParis,France'], 'locations.csv', { type: 'text/csv' });

    const batch = [tsvFile, csvFile];
    const batchMeta = getToolMeta('json-csv');
    assert(isToolEligibleForBatch(batchMeta, batch), 'Mixed TSV + CSV batch must be eligible for json-csv');

    const batchIds = suggestToolsForFiles(batch).map((t) => t.id);
    assert(batchIds.includes('json-csv'), 'Mixed TSV + CSV batch suggestions must include json-csv');

    // Simulate batch execution where firstTSV set delimiter to '\t'
    const tsvText = 'name\tage\nAlice\t30';
    const csvText = 'city,country\nParis,France';

    const tsvRows = parseCsv(tsvText, { delimiter: '\t' });
    assert(tsvRows.length === 2 && tsvRows[0].length === 2 && tsvRows[0][0] === 'name', 'TSV parses tab delimiter');

    // For CSV, if tab state was carried, it would fail to split into 2 columns
    const carriedTabRows = parseCsv(csvText, { delimiter: '\t' });
    assert(carriedTabRows[0].length === 1, 'Carrying tab into CSV results in single unparsed column');

    // Per-file autodetection for CSV default parses properly
    const effectiveCsvDelim = detectDelimiter(csvText);
    assert(effectiveCsvDelim === ',', 'CSV delimiter autodetects as comma');
    const csvRows = parseCsv(csvText, { delimiter: effectiveCsvDelim });
    assert(csvRows.length === 2 && csvRows[0].length === 2 && csvRows[0][0] === 'city', 'CSV correctly parses 2 columns');
  });

  // 30. 3D & CAD single models: suggest six single tools, exclude three-merge
  runTest('3D and CAD single models: suggest six single tools, exclude three-merge', () => {
    const singleFormats = [
      { name: 'part.stl', type: 'model/stl' },
      { name: 'model.obj', type: 'model/obj' },
      { name: 'scan.ply', type: 'model/ply' },
      { name: 'object.3mf', type: 'model/3mf' },
      { name: 'assembly.step', type: 'model/step' },
      { name: 'component.stp', type: 'model/step' },
      { name: 'design.iges', type: 'model/iges' },
      { name: 'surface.igs', type: 'model/iges' },
      { name: 'solid.brep', type: 'model/x-brep' },
    ];

    const expectedSix = ['three-convert', 'three-simplify', 'three-inspect', 'three-transform', 'three-normals', 'three-split'];

    for (const item of singleFormats) {
      const file = new File(['dummy content'], item.name, { type: item.type });
      const ids = suggestToolsForFiles([file]).map((t) => t.id);

      assert(hasNoDuplicates(ids), `${item.name} suggestions contain duplicates: ${ids.join(', ')}`);

      for (const expectedTool of expectedSix) {
        assert(ids.includes(expectedTool), `${item.name} must include ${expectedTool}`);
      }

      assert(!ids.includes('three-merge'), `${item.name} must NOT include three-merge for single file`);

      const forbidden = ['convert', 'compress', 'img-convert', 'pdf-merge'];
      for (const fId of forbidden) {
        assert(!ids.includes(fId), `${item.name} must NOT contain unrelated tool ${fId}`);
      }
    }
  });

  // 31. OBJ text/plain & MIME-only FileDrop matching
  runTest('3D classification and matchesAccept: OBJ text/plain and MIME-only FileDrop matching', () => {
    // OBJ with text/plain (common browser drop behavior)
    const textPlainObj = new File(['# OBJ file\nv 0 0 0\n'], 'model.obj', { type: 'text/plain' });
    const objIds = suggestToolsForFiles([textPlainObj]).map((t) => t.id);
    assert(objIds.includes('three-convert'), 'OBJ with text/plain must classify as 3D and include three-convert');
    assert(matchesAccept(textPlainObj, '.stl,.obj,.ply,.3mf'), 'OBJ with text/plain matches .obj in accept');

    // Extensionless files with recognized 3D MIME
    const mimeStl = new File(['solid test'], 'raw_stl_stream', { type: 'model/stl' });
    const stlIds = suggestToolsForFiles([mimeStl]).map((t) => t.id);
    assert(stlIds.includes('three-convert'), 'Extensionless model/stl must suggest 3D tools');
    assert(matchesAccept(mimeStl, '.stl,.obj,.ply,model/stl'), 'Extensionless model/stl matches accept');

    const mimeObj = new File(['v 1 2 3'], 'raw_obj_stream', { type: 'text/obj' });
    const mimeObjIds = suggestToolsForFiles([mimeObj]).map((t) => t.id);
    assert(mimeObjIds.includes('three-convert'), 'Extensionless text/obj must suggest 3D tools');
    assert(matchesAccept(mimeObj, '.obj,model/obj,model/*'), 'Extensionless text/obj matches accept');

    const mimeStep = new File(['ISO-10303-21;'], 'raw_cad_stream', { type: 'model/step' });
    const stepIds = suggestToolsForFiles([mimeStep]).map((t) => t.id);
    assert(stepIds.includes('three-convert'), 'Extensionless model/step must suggest 3D tools');
    assert(matchesAccept(mimeStep, '.step,.stp,model/step'), 'Extensionless model/step matches accept');
  });

  // 32. Multi-file: all-models batch vs mixed model + other batch
  runTest('3D multi-file batches: all-models suggests only three-merge + batch-rename, mixed suggests only batch-rename', () => {
    const stl = new File(['dummy stl'], 'part1.stl', { type: 'model/stl' });
    const obj = new File(['dummy obj'], 'part2.obj', { type: 'model/obj' });
    const allModelsIds = suggestToolsForFiles([stl, obj]).map((t) => t.id);

    assert(hasNoDuplicates(allModelsIds), `All-models batch has duplicates: ${allModelsIds.join(', ')}`);
    assert(allModelsIds.length === 2, `All-models batch must suggest exactly 2 tools, got: ${allModelsIds.join(', ')}`);
    assert(allModelsIds.includes('three-merge'), 'All-models batch must include three-merge');
    assert(allModelsIds.includes('batch-rename'), 'All-models batch must include batch-rename');

    const png = new File(['dummy image'], 'texture.png', { type: 'image/png' });
    const mixedBatchIds = suggestToolsForFiles([stl, png]).map((t) => t.id);
    assert(
      mixedBatchIds.length === 1 && mixedBatchIds[0] === 'batch-rename',
      `Mixed model + image batch must ONLY suggest batch-rename, got: ${mixedBatchIds.join(', ')}`,
    );

    const pdf = new File(['dummy pdf'], 'spec.pdf', { type: 'application/pdf' });
    const mixedPdfIds = suggestToolsForFiles([obj, pdf]).map((t) => t.id);
    assert(
      mixedPdfIds.length === 1 && mixedPdfIds[0] === 'batch-rename',
      `Mixed model + pdf batch must ONLY suggest batch-rename, got: ${mixedPdfIds.join(', ')}`,
    );
  });

  // 33. Unknown binary safety: firmware.bin suggests NO 3D tools
  runTest('Unknown binary safety: firmware.bin does not suggest any 3D tools', () => {
    const binFile = new File(['\x00\x01\x02\x03'], 'firmware.bin', { type: 'application/octet-stream' });
    const ids = suggestToolsForFiles([binFile]).map((t) => t.id);

    const threeTools = [
      'three-convert',
      'three-simplify',
      'three-inspect',
      'three-transform',
      'three-normals',
      'three-split',
      'three-merge',
    ];

    for (const toolId of threeTools) {
      assert(!ids.includes(toolId), `Unknown binary must NOT suggest 3D tool ${toolId}`);
    }
    assert(ids.includes('file-inspector'), 'Unknown binary should retain file-inspector');
  });
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;

  return {
    passed: failedCount === 0,
    total: results.length,
    passedCount,
    failedCount,
    results,
  };
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('verify')) {
  const summary = runHandoffVerification();
  console.log(`\n--- Handoff Verification: ${summary.passedCount}/${summary.total} tests passed ---`);
  for (const r of summary.results) {
    console.log(`${r.passed ? '✓ PASS' : '✗ FAIL'}: ${r.name}`);
    if (r.error) console.error(`   Error: ${r.error}`);
  }
  if (!summary.passed) process.exit(1);
}
