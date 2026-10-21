import { suggestToolsForFiles } from './handoff';

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

  // Test 1: PNG includes img-png-to-jpg and excludes reverse/incompatible converters
  runTest('PNG: includes img-png-to-jpg, excludes reverse/incompatible tools', () => {
    const file = new File(['dummy'], 'example.png', { type: 'image/png' });
    const suggestions = suggestToolsForFiles([file]);
    const ids = suggestions.map((t) => t.id);
    const first12 = ids.slice(0, 12);

    assert(hasNoDuplicates(ids), `PNG results contain duplicates: ${ids.join(', ')}`);
    assert(ids.includes('img-png-to-jpg'), 'PNG suggestions must include img-png-to-jpg');
    assert(first12.includes('img-png-to-jpg'), 'First 12 PNG suggestions must include img-png-to-jpg');

    const forbidden = [
      'img-jpg-to-png',
      'img-heic-to-jpg',
      'img-webp-to-jpg',
      'img-webp-to-png',
      'img-svg-to-png',
      'pdf-jpg-to-pdf',
    ];

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
      'file-converter',
    ];
    for (const toolId of expectedGeneric) {
      assert(ids.includes(toolId), `PNG suggestions should include generic tool ${toolId}`);
    }
  });

  // Test 2: JPEG aliases (.jpg, .jpeg, .jpe) reverse appropriately
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

      const forbidden = [
        'img-png-to-jpg',
        'img-heic-to-jpg',
        'img-webp-to-jpg',
        'img-webp-to-png',
        'img-svg-to-png',
      ];
      for (const toolId of forbidden) {
        assert(!ids.includes(toolId), `${item.name} must NOT contain ${toolId}`);
        assert(!first12.includes(toolId), `${item.name} first 12 must NOT contain ${toolId}`);
      }
    }
  });

  // Test 3: WebP specific tools rank correct and reverse tools excluded
  runTest('WebP: includes webp-to-jpg/png, excludes reverse tools', () => {
    const file = new File(['dummy'], 'photo.webp', { type: 'image/webp' });
    const suggestions = suggestToolsForFiles([file]);
    const ids = suggestions.map((t) => t.id);
    const first12 = ids.slice(0, 12);

    assert(hasNoDuplicates(ids), `WebP results contain duplicates: ${ids.join(', ')}`);
    assert(ids.includes('img-webp-to-jpg'), 'WebP suggestions must include img-webp-to-jpg');
    assert(ids.includes('img-webp-to-png'), 'WebP suggestions must include img-webp-to-png');
    assert(first12.includes('img-webp-to-jpg'), 'First 12 WebP suggestions must include img-webp-to-jpg');
    assert(first12.includes('img-webp-to-png'), 'First 12 WebP suggestions must include img-webp-to-png');

    const forbidden = [
      'img-png-to-jpg',
      'img-jpg-to-png',
      'img-heic-to-jpg',
      'img-svg-to-png',
      'pdf-jpg-to-pdf',
    ];
    for (const toolId of forbidden) {
      assert(!ids.includes(toolId), `WebP suggestions must NOT contain ${toolId}`);
      assert(!first12.includes(toolId), `First 12 WebP suggestions must NOT contain ${toolId}`);
    }

    assert(ids.includes('img-compress'), 'WebP should retain generic tool img-compress');
    assert(ids.includes('img-convert'), 'WebP should retain generic tool img-convert');
  });

  // Test 4: HEIC / HEIF specific tools rank correct
  runTest('HEIC/HEIF: includes heic-to-jpg, excludes reverse tools', () => {
    for (const filename of ['photo.heic', 'photo.heif']) {
      const mime = filename.endsWith('.heic') ? 'image/heic' : 'image/heif';
      const file = new File(['dummy'], filename, { type: mime });
      const suggestions = suggestToolsForFiles([file]);
      const ids = suggestions.map((t) => t.id);
      const first12 = ids.slice(0, 12);

      assert(hasNoDuplicates(ids), `${filename} contains duplicates: ${ids.join(', ')}`);
      assert(ids.includes('img-heic-to-jpg'), `${filename} must include img-heic-to-jpg`);
      assert(first12.includes('img-heic-to-jpg'), `${filename} first 12 must include img-heic-to-jpg`);

      const forbidden = [
        'img-png-to-jpg',
        'img-jpg-to-png',
        'img-webp-to-jpg',
        'img-webp-to-png',
        'img-svg-to-png',
        'pdf-jpg-to-pdf',
      ];
      for (const toolId of forbidden) {
        assert(!ids.includes(toolId), `${filename} must NOT contain ${toolId}`);
        assert(!first12.includes(toolId), `${filename} first 12 must NOT contain ${toolId}`);
      }
    }
  });

  // Test 5: SVG specific tools rank correct
  runTest('SVG: includes svg-to-png, excludes reverse tools', () => {
    const file = new File(['<svg></svg>'], 'vector.svg', { type: 'image/svg+xml' });
    const suggestions = suggestToolsForFiles([file]);
    const ids = suggestions.map((t) => t.id);
    const first12 = ids.slice(0, 12);

    assert(hasNoDuplicates(ids), `SVG contains duplicates: ${ids.join(', ')}`);
    assert(ids.includes('img-svg-to-png'), 'SVG suggestions must include img-svg-to-png');
    assert(first12.includes('img-svg-to-png'), 'First 12 SVG suggestions must include img-svg-to-png');

    const forbidden = [
      'img-png-to-jpg',
      'img-jpg-to-png',
      'img-heic-to-jpg',
      'img-webp-to-jpg',
      'img-webp-to-png',
      'pdf-jpg-to-pdf',
    ];
    for (const toolId of forbidden) {
      assert(!ids.includes(toolId), `SVG must NOT contain ${toolId}`);
      assert(!first12.includes(toolId), `First 12 SVG suggestions must NOT contain ${toolId}`);
    }
  });

  // Test 6: Empty file list returns empty array
  runTest('Empty file list: returns empty array', () => {
    const suggestions = suggestToolsForFiles([]);
    assert(Array.isArray(suggestions) && suggestions.length === 0, 'Empty file list must return []');
  });

  // Test 7: PDF suggestions preserve direction
  runTest('PDF: preserves direction, excludes X-to-pdf converters', () => {
    const file = new File(['dummy'], 'document.pdf', { type: 'application/pdf' });
    const suggestions = suggestToolsForFiles([file]);
    const ids = suggestions.map((t) => t.id);

    assert(hasNoDuplicates(ids), `PDF contains duplicates: ${ids.join(', ')}`);
    assert(ids.includes('pdf-merge'), 'PDF must include pdf-merge');
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
      'img-png-to-jpg',
      'img-jpg-to-png',
    ];
    for (const toolId of forbidden) {
      assert(!ids.includes(toolId), `PDF must NOT contain ${toolId}`);
    }
  });

  // Test 8: DOCX suggestions preserve direction
  runTest('DOCX: preserves direction, suggests word-to-pdf / docx-to-image', () => {
    const file = new File(['dummy'], 'document.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const suggestions = suggestToolsForFiles([file]);
    const ids = suggestions.map((t) => t.id);

    assert(hasNoDuplicates(ids), `DOCX contains duplicates: ${ids.join(', ')}`);
    assert(ids.includes('pdf-word-to-pdf'), 'DOCX must include pdf-word-to-pdf');
    assert(ids.includes('img-docx-to-jpg'), 'DOCX must include img-docx-to-jpg');
    assert(ids.includes('img-docx-to-png'), 'DOCX must include img-docx-to-png');
    assert(!ids.includes('pdf-pdf-to-word'), 'DOCX must NOT contain pdf-pdf-to-word');
    assert(!ids.includes('img-jpg-to-png'), 'DOCX must NOT contain img-jpg-to-png');
    assert(!ids.includes('img-png-to-jpg'), 'DOCX must NOT contain img-png-to-jpg');
  });

  // Test 9: Uppercase extensions and blank MIME
  runTest('Uppercase extensions and blank MIME: retain sensible format behavior', () => {
    const cases = [
      { name: 'PHOTO.PNG', expect: 'img-png-to-jpg', forbid: 'img-jpg-to-png' },
      { name: 'PHOTO.JPG', expect: 'img-jpg-to-png', forbid: 'img-png-to-jpg' },
      { name: 'PHOTO.JPEG', expect: 'img-jpg-to-png', forbid: 'img-png-to-jpg' },
      { name: 'PHOTO.JPE', expect: 'img-jpg-to-png', forbid: 'img-png-to-jpg' },
      { name: 'PHOTO.WEBP', expect: 'img-webp-to-jpg', forbid: 'img-png-to-jpg' },
      { name: 'PHOTO.HEIC', expect: 'img-heic-to-jpg', forbid: 'img-png-to-jpg' },
      { name: 'IMAGE.SVG', expect: 'img-svg-to-png', forbid: 'img-png-to-jpg' },
    ];

    for (const c of cases) {
      const file = new File(['dummy'], c.name, { type: '' });
      const suggestions = suggestToolsForFiles([file]);
      const ids = suggestions.map((t) => t.id);
      const first12 = ids.slice(0, 12);

      assert(hasNoDuplicates(ids), `${c.name} contains duplicates: ${ids.join(', ')}`);
      assert(ids.includes(c.expect), `${c.name} (blank MIME) must include ${c.expect}`);
      assert(first12.includes(c.expect), `${c.name} first 12 must include ${c.expect}`);
      assert(!ids.includes(c.forbid), `${c.name} (blank MIME) must NOT include ${c.forbid}`);
      assert(!first12.includes(c.forbid), `${c.name} first 12 must NOT include ${c.forbid}`);
    }
  });

  // Test 10: First 12 visible suggestions on Home have no reverse/incompatible directional converters
  runTest('Visible first 12 cards on Home: only compatible tools', () => {
    const sampleFiles = [
      { file: new File(['dummy'], 'sample.png', { type: 'image/png' }), forbidden: ['img-jpg-to-png', 'img-heic-to-jpg', 'img-webp-to-jpg', 'img-webp-to-png', 'img-svg-to-png', 'pdf-jpg-to-pdf'] },
      { file: new File(['dummy'], 'sample.jpg', { type: 'image/jpeg' }), forbidden: ['img-png-to-jpg', 'img-heic-to-jpg', 'img-webp-to-jpg', 'img-webp-to-png', 'img-svg-to-png'] },
      { file: new File(['dummy'], 'sample.webp', { type: 'image/webp' }), forbidden: ['img-png-to-jpg', 'img-jpg-to-png', 'img-heic-to-jpg', 'img-svg-to-png', 'pdf-jpg-to-pdf'] },
      { file: new File(['dummy'], 'sample.heic', { type: 'image/heic' }), forbidden: ['img-png-to-jpg', 'img-jpg-to-png', 'img-webp-to-jpg', 'img-webp-to-png', 'img-svg-to-png', 'pdf-jpg-to-pdf'] },
      { file: new File(['dummy'], 'sample.svg', { type: 'image/svg+xml' }), forbidden: ['img-png-to-jpg', 'img-jpg-to-png', 'img-webp-to-jpg', 'img-webp-to-png', 'img-heic-to-jpg', 'pdf-jpg-to-pdf'] },
    ];

    for (const { file, forbidden } of sampleFiles) {
      const suggestions = suggestToolsForFiles([file]);
      const first12 = suggestions.slice(0, 12).map((t) => t.id);
      assert(first12.length > 0, `Suggestions for ${file.name} should not be empty`);
      assert(hasNoDuplicates(first12), `First 12 for ${file.name} has duplicates`);
      for (const toolId of forbidden) {
        assert(!first12.includes(toolId), `First 12 for ${file.name} must not contain ${toolId}`);
      }
    }
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
