// Run against a local Loconvert build with a small video and a playable video
// above 64 MiB. Point PLAYWRIGHT_MODULE at an installed Playwright package.
// node docs/video-draft-regression.mjs http://localhost:5173 small.mp4 large.mp4
import assert from 'node:assert/strict';
import { log } from 'node:console';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const [origin, small, large] = process.argv.slice(2);
assert(origin && small && large, 'Pass the Loconvert origin and two local video paths.');
assert(statSync(small).size < 64 * 1024 ** 2 && statSync(large).size > 64 * 1024 ** 2);

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
try {
  const context = await browser.newContext({ locale: 'en-US' });
  const editor = await context.newPage();
  editor.setDefaultTimeout(10_000);
  await editor.addInitScript(() => {
    const prototype = globalThis.IDBObjectStore.prototype;
    const put = prototype.put;
    const observed = (globalThis.videoDraftCheck = { mediaWrites: 0, trim: null });
    prototype.put = function (value, ...keys) {
      const request = put.call(this, value, ...keys);
      if (this.name === 'video-assets') {
        this.transaction.addEventListener('complete', () => observed.mediaWrites++, { once: true });
      }
      if (this.name === 'drafts' && value?.edit) {
        this.transaction.addEventListener('complete', () => (observed.trim = value.edit.segments[0].start), { once: true });
      }
      return request;
    };
  });
  await editor.goto(new URL('/video/video-editor', origin).href);
  const chooser = editor.waitForEvent('filechooser');
  await editor.getByRole('button', { name: 'Choose files', exact: true }).click();
  await (await chooser).setFiles([small, large]);

  const trim = editor.getByRole('spinbutton', { name: 'Trim in (s)' });
  async function editTrim(value) {
    await trim.fill(String(value));
    await trim.press('Enter');
  }
  for (const value of [0.25, 0.5]) {
    await editTrim(value);
    await editor.waitForFunction((expected) => globalThis.videoDraftCheck.trim === expected, value);
    assert.equal(await editor.evaluate(() => globalThis.videoDraftCheck.mediaWrites), 2);
  }

  await editor.getByRole('button', { name: 'Back to home' }).click();
  await editor.waitForURL(new URL('/', origin).href);
  await editor.reload();
  const reopen = editor.getByRole('button', { name: /^Reopen / });
  assert((await reopen.getAttribute('aria-label')).includes(basename(large)));
  await reopen.click();
  await editor.getByRole('button', { name: `${basename(large)} (Clip 2)`, exact: true }).waitFor();
  assert.equal(Number(await trim.inputValue()), 0.5);

  const history = await context.newPage();
  await history.goto(new URL('/', origin).href);
  const remove = history.getByRole('button', { name: /^Remove .* from recent files$/ });
  await remove.click();
  await remove.waitFor({ state: 'detached' });
  await editTrim(0.75);
  await editor.getByText('This project changed or was removed in Recent files. Export your video to keep these edits.').waitFor();
  assert.equal(await editor.evaluate(() => globalThis.videoDraftCheck.mediaWrites), 0);
  await history.reload();
  assert.equal(await history.getByRole('button', { name: /^Reopen / }).count(), 0);
  log('Large project reopened with both clips and the latest trim. Autosaves reused media. Removal stayed final.');
} finally {
  await browser.close();
}
