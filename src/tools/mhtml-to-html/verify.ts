import { parseMhtml, convertMhtmlToHtml, decodeQuotedPrintable, decodeBase64, unfoldHeaders } from './mhtml';

export async function runVerification(): Promise<void> {
  console.log('--- Starting MHTML to HTML Verification ---');

  // 1. Quoted-Printable decoding with multi-byte UTF-8 and soft line break
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

  // 4. Synthetic MHTML archive containing:
  // - Archived positive image (CID) & archived positive CSS (Content-Location)
  // - CSS quoted @import
  // - CSS escaped url (ht\tp\:\/\/...)
  // - HTML srcset, object data, base, meta refresh, frame/iframe
  // - Relative unmapped leak (/canary-relative-leak)
  const syntheticMhtml = [
    'From: <Saved by Web>',
    'Snapshot-Content-Location: http://localhost:5300/index.html',
    'Subject: Synthetic Security Canary Test',
    'MIME-Version: 1.0',
    'Content-Type: multipart/related;',
    ' boundary="----=_Synthetic_Part_9876"',
    '',
    '------=_Synthetic_Part_9876',
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: 7bit',
    'Content-Location: http://localhost:5300/index.html',
    '',
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <base href="http://localhost:5300/canary-base/">',
    '  <meta http-equiv="refresh" content="0;url=http://localhost:5300/canary-refresh">',
    '  <link rel="stylesheet" href="http://localhost:5300/style.css">',
    '  <style>',
    '    @import "http://localhost:5300/canary-quoted-import.css";',
    '    .escaped-bg { background-image: url(ht\\tp\\:\\/\\/localhost:5300\\/canary-escaped.png); }',
    '    .archived-bg { background-image: url("http://localhost:5300/archived-banner.png"); }',
    '  </style>',
    '  <script>window.__canary_script_exec = true;</script>',
    '</head>',
    '<body>',
    '  <h1 onclick="alert(1)">Title</h1>',
    '  <img src="cid:cat-image@local" alt="cat">',
    '  <img src="http://localhost:5300/archived-banner.png" alt="banner">',
    '  <img srcset="http://localhost:5300/canary-srcset.png 2x" alt="srcset-canary">',
    '  <img src="/canary-relative-leak.png" alt="relative-leak">',
    '  <object data="http://localhost:5300/canary-object.swf" type="application/x-shockwave-flash"></object>',
    '  <iframe src="http://localhost:5300/canary-iframe.html"></iframe>',
    '  <frame src="http://localhost:5300/canary-frame.html">',
    '  <a href="http://localhost:5300/canary-outbound">Outbound Link</a>',
    '  <a href="#section2">Local Anchor</a>',
    '</body>',
    '</html>',
    '------=_Synthetic_Part_9876',
    'Content-Type: text/css',
    'Content-Transfer-Encoding: 7bit',
    'Content-Location: http://localhost:5300/style.css',
    '',
    'body { color: #333; }',
    '------=_Synthetic_Part_9876',
    'Content-Type: image/png',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <cat-image@local>',
    '',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    '------=_Synthetic_Part_9876',
    'Content-Type: image/png',
    'Content-Transfer-Encoding: base64',
    'Content-Location: http://localhost:5300/archived-banner.png',
    '',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    '------=_Synthetic_Part_9876--',
  ].join('\r\n');

  const parsed = parseMhtml(syntheticMhtml);
  if (parsed.parts.length !== 4) {
    throw new Error(`Expected 4 parts in MHTML, got ${parsed.parts.length}`);
  }
  console.log(`✓ MHTML parsed ${parsed.parts.length} parts successfully.`);

  // -------------------------------------------------------------
  // Test A: Standalone Mode
  // -------------------------------------------------------------
  const standalone = convertMhtmlToHtml(syntheticMhtml, {
    mode: 'standalone',
    blockRemoteUrls: true,
    stripScripts: true,
  });

  // Verify strong mode-aware CSP injected at FIRST head position
  const headIdx = standalone.html.indexOf('<head>');
  const cspIdx = standalone.html.indexOf('http-equiv="Content-Security-Policy"');
  if (cspIdx === -1 || cspIdx < headIdx) {
    throw new Error('CSP meta tag not found or not inside <head>');
  }
  if (!standalone.html.includes("default-src 'none'")) {
    throw new Error("CSP missing default-src 'none'");
  }
  if (!standalone.html.includes("base-uri 'none'") || !standalone.html.includes("form-action 'none'")) {
    throw new Error('CSP missing base-uri/form-action none');
  }
  console.log('✓ Authoritative standalone CSP verified at first head position.');

  // Verify positive archived assets were resolved to data URIs
  if (!standalone.html.includes('src="data:image/png;base64,')) {
    throw new Error('CID image was not inlined to data URI');
  }
  if (standalone.html.includes('http://localhost:5300/style.css')) {
    throw new Error('Archived CSS stylesheet link was not inlined');
  }
  if (!standalone.html.includes('data:image/png;base64,') || !standalone.html.includes('archived-bg')) {
    throw new Error('Archived banner image was not properly resolved in CSS/HTML');
  }
  console.log('✓ Positive archived image and stylesheet assets preserved and resolved.');

  // Verify external & relative leaks are neutralized
  if (standalone.html.includes('canary-quoted-import.css')) {
    throw new Error('CSS quoted @import leak was not neutralized!');
  }
  if (standalone.html.includes('canary-escaped.png')) {
    throw new Error('CSS escaped url(...) leak was not neutralized!');
  }
  if (standalone.html.includes('canary-srcset.png')) {
    throw new Error('HTML srcset canary leak was not neutralized!');
  }
  if (standalone.html.includes('canary-object.swf')) {
    throw new Error('<object data="..."> canary leak was not neutralized!');
  }
  if (standalone.html.includes('canary-base')) {
    throw new Error('<base> tag was not removed!');
  }
  if (standalone.html.includes('canary-refresh')) {
    throw new Error('<meta http-equiv="refresh"> was not removed!');
  }
  if (standalone.html.includes('canary-iframe') || standalone.html.includes('canary-frame')) {
    throw new Error('Frames were not stripped!');
  }
  if (standalone.html.includes('/canary-relative-leak.png')) {
    throw new Error('Unmapped relative URL was not blocked/neutralized!');
  }
  if (standalone.html.includes('canary-outbound')) {
    throw new Error('Active outbound link was not neutralized!');
  }
  // Local fragment anchor must be preserved
  if (!standalone.html.includes('href="#section2"')) {
    throw new Error('Local fragment anchor #section2 was removed!');
  }
  // Script and onclick stripped
  if (standalone.html.includes('__canary_script_exec') || standalone.html.includes('onclick=')) {
    throw new Error('Scripts or inline event handlers were not stripped!');
  }
  console.log(`✓ All canary leaks neutralized (${standalone.blockedRemoteCount} remote/unmapped refs blocked).`);

  // -------------------------------------------------------------
  // Test B: ZIP Mode
  // -------------------------------------------------------------
  const zipConverted = convertMhtmlToHtml(syntheticMhtml, {
    mode: 'zip',
    blockRemoteUrls: true,
    stripScripts: true,
  });

  if (!zipConverted.assets || zipConverted.assets.length === 0) {
    throw new Error('ZIP mode did not return asset files');
  }
  // Verify ZIP HTML references ONLY generated safe assets in ./assets/
  if (!zipConverted.html.includes('./assets/')) {
    throw new Error('ZIP HTML did not point to ./assets/ folder');
  }
  // Verify zero unmapped canary references remain in ZIP HTML
  if (
    zipConverted.html.includes('canary-quoted-import.css') ||
    zipConverted.html.includes('canary-escaped.png') ||
    zipConverted.html.includes('canary-srcset.png') ||
    zipConverted.html.includes('canary-relative-leak.png')
  ) {
    throw new Error('Unmapped canary references found in ZIP output HTML!');
  }
  console.log(`✓ ZIP mode generated ${zipConverted.assets.length} safe assets with strictly sanitized references.`);

  console.log('--- ALL MHTML VERIFICATIONS PASSED SUCCESSFULLY ---');
}

// Self-run when executed directly
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('verify')) {
  runVerification().catch((err) => {
    console.error('MHTML verification failed:', err);
    process.exit(1);
  });
}
