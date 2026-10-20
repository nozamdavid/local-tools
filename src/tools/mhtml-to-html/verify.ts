import {
  parseMhtml,
  convertMhtmlToHtml,
  decodeQuotedPrintable,
  decodeBase64,
  unfoldHeaders,
} from './mhtml';

export async function runVerification(): Promise<void> {
  console.log('--- Starting MHTML to HTML Verification ---');

  // 1. Quoted-Printable decoding with multi-byte UTF-8 and soft line break
  // =E2=82=AC is Euro sign '€', =C3=A9 is 'é'
  const qpInput = 'Price: 100 =E2=82=AC for caf=\r\n=C3=A9 items';
  const qpBytes = decodeQuotedPrintable(qpInput);
  const qpDecoded = new TextDecoder('utf-8').decode(qpBytes);
  if (qpDecoded !== 'Price: 100 € for café items') {
    throw new Error(`Quoted-printable decoding failed: got "${qpDecoded}"`);
  }
  console.log('✓ Quoted-printable multi-byte UTF-8 decoding verified.');

  // 2. Base64 decoding
  const testString = 'Hello MHTML Base64 Asset';
  const base64Input = btoa(testString);
  const b64Bytes = decodeBase64(base64Input);
  const b64Decoded = new TextDecoder().decode(b64Bytes);
  if (b64Decoded !== testString) {
    throw new Error(`Base64 decoding failed: expected "${testString}", got "${b64Decoded}"`);
  }
  console.log('✓ Base64 decoding verified.');

  // 3. Folded MIME headers
  const foldedHeader = 'Content-Type: multipart/related;\r\n boundary="--boundary-123";\r\n\ttype="text/html"';
  const unfolded = unfoldHeaders(foldedHeader);
  if (unfolded.length !== 1 || !unfolded[0].includes('type="text/html"')) {
    throw new Error(`Header unfolding failed: got ${JSON.stringify(unfolded)}`);
  }
  console.log('✓ Folded headers parsing verified.');

  // 4. Full MHTML parsing & Asset resolution + Remote-ref blocking
  const mhtmlFixture = [
    'From: <Saved by Web>',
    'Snapshot-Content-Location: http://example.com/index.html',
    'Subject: Test Page',
    'MIME-Version: 1.0',
    'Content-Type: multipart/related;',
    ' boundary="----=_NextPart_000_1234"',
    '',
    '------=_NextPart_000_1234',
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: quoted-printable',
    'Content-Location: http://example.com/index.html',
    '',
    '<!DOCTYPE html><html><head>',
    '<link rel="stylesheet" href="http://example.com/style.css">',
    '<script>alert("malicious script");</script>',
    '</head><body>',
    '<h1 onclick="alert(1)">Title</h1>',
    '<img src="cid:cat-image@local" alt="cat">',
    '<img src="http://example.com/banner.png" alt="banner">',
    '<img src="https://evil-tracker.com/pixel.gif" alt="tracker">',
    '</body></html>',
    '------=_NextPart_000_1234',
    'Content-Type: text/css',
    'Content-Transfer-Encoding: 7bit',
    'Content-Location: http://example.com/style.css',
    '',
    'body { background: #fff; }',
    '------=_NextPart_000_1234',
    'Content-Type: image/png',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <cat-image@local>',
    '',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    '------=_NextPart_000_1234',
    'Content-Type: image/png',
    'Content-Transfer-Encoding: base64',
    'Content-Location: http://example.com/banner.png',
    '',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    '------=_NextPart_000_1234--',
  ].join('\r\n');

  const parsed = parseMhtml(mhtmlFixture);
  if (parsed.parts.length !== 4) {
    throw new Error(`Expected 4 parts in MHTML, got ${parsed.parts.length}`);
  }
  console.log(`✓ MHTML parsed ${parsed.parts.length} parts successfully.`);

  // Test Standalone conversion
  const converted = convertMhtmlToHtml(mhtmlFixture, {
    mode: 'standalone',
    blockRemoteUrls: true,
    stripScripts: true,
  });

  // Verify CID asset was converted to data URI
  if (!converted.html.includes('src="data:image/png;base64,')) {
    throw new Error('CID image was not replaced with Data URI');
  }

  // Verify Content-Location asset (banner.png) was converted to data URI
  if (converted.html.includes('http://example.com/banner.png')) {
    throw new Error('Content-Location asset was not replaced with Data URI');
  }

  // Verify remote ref blocking
  if (converted.html.includes('https://evil-tracker.com/pixel.gif')) {
    throw new Error('Remote URL was NOT blocked!');
  }
  if (!converted.html.includes('about:blank#blocked-remote-ref')) {
    throw new Error('Remote URL was not neutralized to safe placeholder');
  }
  if (converted.blockedRemoteCount < 1) {
    throw new Error(`Expected at least 1 blocked remote ref, got ${converted.blockedRemoteCount}`);
  }
  console.log('✓ Remote-ref blocking verified.');

  // Verify script and event handler stripping
  if (converted.html.includes('alert(')) {
    throw new Error('Script or inline event handler was not stripped!');
  }
  if (converted.html.includes('onclick=')) {
    throw new Error('onclick handler was not stripped!');
  }
  console.log('✓ Script and event handler neutralization verified.');

  // Test ZIP conversion
  const zipConverted = convertMhtmlToHtml(mhtmlFixture, {
    mode: 'zip',
    blockRemoteUrls: true,
    stripScripts: true,
  });
  if (!zipConverted.assets || zipConverted.assets.length === 0) {
    throw new Error('ZIP mode did not return asset files');
  }
  if (!zipConverted.html.includes('assets/')) {
    throw new Error('ZIP HTML did not point to ./assets/ folder');
  }
  console.log(`✓ ZIP mode generated ${zipConverted.assets.length} safe assets.`);

  console.log('--- ALL MHTML VERIFICATIONS PASSED SUCCESSFULLY ---');
}

// Self-run when executed directly
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('verify')) {
  runVerification().catch((err) => {
    console.error('MHTML verification failed:', err);
    process.exit(1);
  });
}
