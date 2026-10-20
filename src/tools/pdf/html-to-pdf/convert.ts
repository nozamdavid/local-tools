import { PDFDocument } from 'pdf-lib';
import { addElementPages, pageGeometry, type PageSetup } from '../_render/render';

/** Standards mode makes the body height follow its content, which pagination needs. */
export function withDoctype(html: string): string {
  return /^\s*(<!--[\s\S]*?-->\s*)*<!doctype/i.test(html) ? html : `<!DOCTYPE html>\n${html}`;
}

export function checkHtml(content: string): string | null {
  if (!content.trim()) return 'This file is empty.';
  if (content.includes('\0')) return 'This file appears to be binary, not an HTML document.';
  return null;
}

/**
 * Strips active scripts, external image references, stylesheets, and outbound frames
 * to preserve privacy and prevent network leaks.
 */
export function sanitizeHtml(rawHtml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // 1. Remove all script and noscript tags
  doc.querySelectorAll('script, noscript').forEach((el) => el.remove());

  // 2. Remove base elements that could rewrite relative URLs
  doc.querySelectorAll('base').forEach((el) => el.remove());

  // 3. Remove inline event handlers and clean style attributes
  const all = doc.querySelectorAll('*');
  for (const el of Array.from(all)) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) {
        el.removeAttribute(attr.name);
      }
      if (attr.name.toLowerCase() === 'style') {
        let val = attr.value;
        val = val.replace(/@import\s+[^;]+;/gi, '/* @import blocked */');
        val = val.replace(/url\s*\(\s*['"]?(?!data:|blob:)[^'")]+['"]?\s*\)/gi, 'none');
        el.setAttribute('style', val);
      }
    }
  }

  // 4. Remove external stylesheets (<link rel="stylesheet"> or other external resources)
  doc.querySelectorAll('link').forEach((link) => {
    const href = link.getAttribute('href') || '';
    if (!href.startsWith('data:') && !href.startsWith('blob:')) {
      link.remove();
    }
  });

  // 5. Remove iframes, object, embed, audio, video, forms
  doc.querySelectorAll('iframe, frame, object, embed, applet, form, input[type="image"]').forEach((el) => el.remove());
  doc.querySelectorAll('video, audio').forEach((media) => {
    const src = media.getAttribute('src') || '';
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      media.removeAttribute('src');
    }
    media.querySelectorAll('source').forEach((s) => {
      const srcUrl = s.getAttribute('src') || '';
      if (!srcUrl.startsWith('data:') && !srcUrl.startsWith('blob:')) {
        s.remove();
      }
    });
  });

  // 6. Neutralize external images
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      // Keep the alt text visible so the layout hints at what was there.
      const alt = img.getAttribute('alt');
      if (alt) {
        const note = doc.createElement('span');
        note.textContent = `[${alt}]`;
        img.replaceWith(note);
      } else {
        img.remove();
      }
      return;
    }
    img.removeAttribute('srcset');
  });

  // 7. Neutralize SVG images
  doc.querySelectorAll('image').forEach((img) => {
    const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
    if (href && !href.startsWith('data:') && !href.startsWith('blob:')) {
      img.removeAttribute('href');
      img.removeAttribute('xlink:href');
    }
  });

  // 8. Remove links
  doc.querySelectorAll('a').forEach((a) => {
    a.removeAttribute('href');
    a.removeAttribute('target');
  });

  // 9. Clean <style> blocks from @import and external urls
  doc.querySelectorAll('style').forEach((style) => {
    let css = style.textContent || '';
    css = css.replace(/@import\s+[^;]+;/gi, '/* @import blocked */');
    css = css.replace(/url\s*\(\s*['"]?(?!data:|blob:)[^'")]+['"]?\s*\)/gi, 'none');
    style.textContent = css;
  });

  // 10. Inject strict CSP meta tag in head
  let head = doc.head;
  if (!head) {
    head = doc.createElement('head');
    doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
  }
  const cspMeta = doc.createElement('meta');
  cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
  cspMeta.setAttribute(
    'content',
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data: blob:; font-src data: blob:;"
  );
  head.insertBefore(cspMeta, head.firstChild);

  return doc.documentElement.outerHTML;
}

function loadFrame(frame: HTMLIFrameElement, html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The HTML took too long to load.')), 15000);
    frame.addEventListener(
      'load',
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
    frame.srcdoc = withDoctype(html);
  });
}

export async function htmlToPdf(
  html: string,
  setup: PageSetup,
  onProgress: (ratio: number) => void
): Promise<{ blob: Blob; pages: number }> {
  const checkError = checkHtml(html);
  if (checkError) throw new Error(checkError);

  const clean = sanitizeHtml(html);
  const geo = pageGeometry(setup.size === 'letter' ? 'letter' : 'a4', setup.orientation, setup.marginMm);

  // No allow-scripts: scripts in the document never run. allow-same-origin lets us measure it.
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.position = 'fixed';
  frame.style.left = '-20000px';
  frame.style.top = '0';
  frame.style.width = `${geo.contentWpx}px`;
  frame.style.height = '800px';
  frame.style.border = '0';
  frame.style.background = '#ffffff';
  document.body.appendChild(frame);

  try {
    await loadFrame(frame, clean);
    onProgress(0.1);

    const doc = frame.contentDocument;
    if (!doc || !doc.body) throw new Error('The HTML could not be rendered.');

    const images = Array.from(doc.images);
    await Promise.all(images.map((img) => img.decode().catch(() => undefined)));

    frame.style.height = `${Math.ceil(doc.documentElement.scrollHeight)}px`;
    onProgress(0.2);

    const pdf = await PDFDocument.create();
    const pages = await addElementPages(pdf, doc.body, geo, setup.format, (done, total) =>
      onProgress(0.2 + (0.75 * done) / total)
    );

    const bytes = await pdf.save();
    onProgress(1);
    return {
      blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
      pages,
    };
  } finally {
    frame.remove();
  }
}
