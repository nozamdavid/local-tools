// Run against a local Loconvert server. Point PLAYWRIGHT_MODULE at an installed Playwright package.
// node docs/frontend-regression.mjs http://localhost:5173
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import process from 'node:process';
import { URL } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

const [origin] = process.argv.slice(2);
assert(origin, 'Pass the Loconvert origin.');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

try {
  const page = await browser.newPage({ locale: 'en-US' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(new URL('/#%', origin).href);
  await page.getByRole('heading', { name: 'Your local file toolkit.' }).waitFor();

  const pdf = await PDFDocument.create();
  pdf.addPage();
  const pdfBytes = [...(await pdf.save())];
  await page.locator('main input[type=file]').setInputFiles(
    ['one.pdf', 'two.pdf'].map((name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from(pdfBytes) })),
  );
  await page.locator('.quick-drop-result a[href="/pdf/merge"]').click();
  await page.getByRole('button', { name: 'Merge 2 PDFs' }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).waitFor();

  await page.goto(new URL('/pdf/compare', origin).href);
  const base = page.getByRole('group', { name: 'Drop Document A (Base PDF)' });
  const comparison = page.getByRole('group', { name: 'Drop Document B (New PDF)' });
  const comparisonPicker = comparison.getByRole('button', { name: 'Choose file' });
  await comparisonPicker.focus();
  await page.evaluate((bytes) => {
    const transfer = new globalThis.DataTransfer();
    transfer.items.add(new globalThis.File([new Uint8Array(bytes)], 'comparison.pdf', { type: 'application/pdf' }));
    globalThis.document.activeElement.dispatchEvent(
      new globalThis.ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, pdfBytes);
  await comparison.waitFor({ state: 'detached' });
  assert(await base.isVisible(), 'A paste focused on Document B must leave Document A empty.');

  async function resizeTwoImages() {
    await page.goto(new URL('/image/bulk-resize', origin).href);
    const images = await page.evaluate(() => {
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = canvas.height = 10;
      const context = canvas.getContext('2d');
      return ['red', 'blue'].map((color) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 10, 10);
        return canvas.toDataURL('image/png').split(',')[1];
      });
    });
    await page.locator('input[type="file"]').setInputFiles(
      images.map((image) => ({ name: 'frame.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') })),
    );
    await page.getByRole('button', { name: 'Resize 2 images' }).click();
    const results = page.getByRole('region', { name: 'Results: 2 files ready' });
    await results.waitFor();
    return results;
  }

  const results = await resizeTwoImages();
  const downloadEvent = page.waitForEvent('download');
  await results.getByRole('button', { name: 'Download all 2 (.zip)' }).click();
  const download = await downloadEvent;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const archive = await JSZip.loadAsync(Buffer.concat(chunks));
  const entries = Object.values(archive.files);
  assert.equal(entries.length, 2);
  assert.notDeepEqual(await entries[0].async('uint8array'), await entries[1].async('uint8array'));

  await results.getByRole('button', { name: /Continue with/ }).click();
  await page.waitForURL(new URL('/image/compare', origin).href);
  await page.getByRole('slider').waitFor();

  const nextResults = await resizeTwoImages();
  await page.evaluate(() => {
    const original = globalThis.Blob.prototype.arrayBuffer;
    globalThis.archiveReads = [];
    globalThis.Blob.prototype.arrayBuffer = function () {
      return new Promise((resolve) => {
        globalThis.archiveReads.push(() => resolve(original.call(this)));
      });
    };
  });
  await nextResults.getByRole('button', { name: 'Download all 2 (.zip)' }).click();
  await page.waitForFunction(() => globalThis.archiveReads.length === 2);
  await nextResults.getByRole('button', { name: 'Start over' }).click();
  const cancelledDownload = page.waitForEvent('download', { timeout: 1000 });
  await page.evaluate(() => globalThis.archiveReads.forEach((read) => read()));
  await assert.rejects(cancelledDownload, { name: 'TimeoutError' });
  assert.deepEqual(errors, []);
  log('PDF paste targets one slot. Both same-name outputs download and transfer. Reset suppresses a pending ZIP download.');
} finally {
  await browser.close();
}
