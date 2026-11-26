import { expect, it } from 'vitest';
import { convertMhtmlToHtml } from './mhtml';

it('decodes an 8-bit root and preserves the exact name and bytes of an unencoded asset', async () => {
  const bytes = Buffer.from(
    [
      'Content-Type: multipart/related; boundary = "sample"; start = "<page>"',
      '',
      '--sample',
      'Content-Type: text/html',
      '',
      '<p>Alternate page</p>',
      '--sample',
      'Content-Type: text/html; charset = "windows-1252"',
      'Content-Transfer-Encoding: 8bit',
      'Content-ID: <page>',
      '',
      '<html><head><meta charset="windows-1252"></head><body>Café <img src="picture.png"></body></html>',
      '--sample',
      'Content-Type: image/png',
      'Content-Transfer-Encoding: binary',
      'Content-Location: picture.png',
      '',
      '\x89PNG\x00\xff',
      '--sample--',
      '',
    ].join('\r\n'),
    'latin1',
  );

  const result = convertMhtmlToHtml(bytes, { mode: 'zip', blockRemoteUrls: true, stripScripts: true });
  expect(result.html).toMatch(/<meta charset="utf-8">\s*<meta charset="windows-1252">/);
  expect(result.html).toContain('<body>Café <img src="./assets/picture.png"></body>');
  const picture = result.assets?.find(({ name }) => name === 'assets/picture.png');
  expect(picture?.name).toBe('assets/picture.png');
  expect(new Uint8Array(await picture!.blob.arrayBuffer())).toEqual(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 255));
});
