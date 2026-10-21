import { PDFDocument } from 'pdf-lib';
import { addElementPages, pageGeometry, type PageSetup } from '../_render/render';
import { sanitizeCssText } from '../../../lib/inertMarkup';

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
  // If running in Node/headless where DOMParser is not defined, use regex fallback
  if (typeof DOMParser === 'undefined') {
    let clean = rawHtml;
    // 1. Remove scripts
    clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    clean = clean.replace(/<script\b[^>]*\/>/gi, '');
    // 2. Remove base and meta refresh
    clean = clean.replace(/<base\b[^>]*>/gi, '');
    clean = clean.replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])refresh\1[^>]*>/gi, '');
    // 3. Remove inline event handlers
    clean = clean.replace(/\s+on[a-zA-Z]+\s*=\s*(?:["'][^"']*["']|[^\s>]+)/gi, '');
    // 4. Style blocks and inline style
    clean = clean.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, css) => `<style>${sanitizeCssText(css)}</style>`);
    clean = clean.replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi, (_m, q, css) => `style=${q}${sanitizeCssText(css)}${q}`);
    // 5. Remove link stylesheets
    clean = clean.replace(/<link\b[^>]*\/?>|<link\b[^>]*>.*?<\/link>/gi, (m) => {
      return /href\s*=\s*(["'])(?:data:|blob:)/i.test(m) ? m : '';
    });
    // 6. External images: replace with [alt] if alt present, else remove
    clean = clean.replace(/<img\b([^>]*)>/gi, (m, attrs) => {
      const srcMatch = attrs.match(/src\s*=\s*(["'])(.*?)\1/i);
      const src = srcMatch ? srcMatch[2] : '';
      if (src.startsWith('data:') || src.startsWith('blob:')) {
        return m.replace(/\ssrcset\s*=\s*(["']).*?\1/gi, '');
      }
      const altMatch = attrs.match(/alt\s*=\s*(["'])(.*?)\1/i);
      return altMatch ? `<span>[${altMatch[2]}]</span>` : '';
    });
    // 7. Remove picture source srcset
    clean = clean.replace(/<source\b[^>]*>/gi, (m) => {
      return /srcset\s*=\s*(["'])(?:https?:|\/\/)/i.test(m) ? '' : m;
    });
    // 8. Neutralize SVG use, feImage, and image
    clean = clean.replace(/<use\b([^>]*)>/gi, (m, attrs) => {
      if (/href\s*=\s*(["'])#/i.test(attrs)) return m;
      return m.replace(/\s*(?:xlink:)?href\s*=\s*(["']).*?\1/gi, '');
    });
    clean = clean.replace(/<feImage\b([^>]*)>/gi, (m, attrs) => {
      if (/href\s*=\s*(["'])(?:data:|blob:)/i.test(attrs)) return m;
      return m.replace(/\s*(?:xlink:)?href\s*=\s*(["']).*?\1/gi, '');
    });
    clean = clean.replace(/<image\b([^>]*)>/gi, (m, attrs) => {
      if (/href\s*=\s*(["'])(?:data:|blob:)/i.test(attrs)) return m;
      return m.replace(/\s*(?:xlink:)?href\s*=\s*(["']).*?\1/gi, '');
    });
    // 9. Remove links
    clean = clean.replace(/<a\b([^>]*)>/gi, (m, attrs) => {
      if (/href\s*=\s*(["'])#/i.test(attrs)) return m;
      return m.replace(/\s*href\s*=\s*(["']).*?\1/gi, '').replace(/\s*target\s*=\s*(["']).*?\1/gi, '');
    });
    // 10. Remove frames, forms, objects
    clean = clean.replace(
      /<(?:iframe|frame|frameset|object|embed|applet|form)\b[^>]*>.*?<\/(?:iframe|frame|frameset|object|embed|applet|form)>/gis,
      '',
    );
    clean = clean.replace(/<(?:iframe|frame|frameset|object|embed|applet|form)\b[^>]*\/?>/gi, '');

    const csp =
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data: blob:; font-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';\">";
    if (/<head\b[^>]*>/i.test(clean)) {
      return clean.replace(/<head\b[^>]*>/i, (m) => `${m}\n  ${csp}`);
    }
    return `<head>\n  ${csp}\n</head>\n${clean}`;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // 1. Remove all script and noscript tags
  doc.querySelectorAll('script, noscript').forEach((el) => el.remove());

  // 2. Remove base and meta-refresh elements
  doc.querySelectorAll('base, meta[http-equiv="refresh" i]').forEach((el) => el.remove());

  // 3. Remove inline event handlers and clean style attributes
  const all = doc.querySelectorAll('*');
  for (const el of Array.from(all)) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) {
        el.removeAttribute(attr.name);
      }
      if (attr.name.toLowerCase() === 'style') {
        el.setAttribute('style', sanitizeCssText(attr.value));
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
  doc.querySelectorAll('iframe, frame, frameset, object, embed, applet, form, input[type="image"]').forEach((el) => el.remove());
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

  // Neutralize picture source elements
  doc.querySelectorAll('picture source, source').forEach((source) => {
    const src = source.getAttribute('src') || '';
    const srcset = source.getAttribute('srcset') || '';
    const isSafe =
      (!src || src.startsWith('data:') || src.startsWith('blob:')) && (!srcset || srcset.startsWith('data:') || srcset.startsWith('blob:'));
    if (!isSafe) {
      source.remove();
    } else {
      source.removeAttribute('srcset');
    }
  });

  // 7. Neutralize SVG use, feImage, and image elements
  doc.querySelectorAll('use').forEach((useEl) => {
    const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
    if (href && !href.startsWith('#')) {
      useEl.removeAttribute('href');
      useEl.removeAttribute('xlink:href');
    }
  });

  doc.querySelectorAll('feImage').forEach((feEl) => {
    const href = feEl.getAttribute('href') || feEl.getAttribute('xlink:href') || '';
    if (href && !href.startsWith('data:') && !href.startsWith('blob:')) {
      feEl.removeAttribute('href');
      feEl.removeAttribute('xlink:href');
    }
  });

  doc.querySelectorAll('image').forEach((img) => {
    const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
    if (href && !href.startsWith('data:') && !href.startsWith('blob:')) {
      img.removeAttribute('href');
      img.removeAttribute('xlink:href');
    }
  });

  // 8. Remove links (preserve local fragment anchors)
  doc.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('#')) {
      a.removeAttribute('href');
      a.removeAttribute('target');
    }
  });

  // 9. Clean <style> blocks from @import and external urls
  doc.querySelectorAll('style').forEach((style) => {
    style.textContent = sanitizeCssText(style.textContent || '');
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
    "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data: blob:; font-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';",
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
      { once: true },
    );
    frame.srcdoc = withDoctype(html);
  });
}

export async function htmlToPdf(
  html: string,
  setup: PageSetup,
  onProgress: (ratio: number) => void,
): Promise<{ blob: Blob; pages: number }> {
  const checkError = checkHtml(html);
  if (checkError) throw new Error(checkError);

  const clean = sanitizeHtml(html);
  const geo = pageGeometry(setup.size === 'letter' ? 'letter' : 'a4', setup.orientation, setup.marginMm);

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.position = 'fixed';
  frame.style.left = '-20000px';
  frame.style.top = '0';
  frame.style.width = `${geo.contentWpx}px`;
  frame.style.height = `${geo.contentHpx}px`;
  frame.style.border = 'none';
  frame.style.visibility = 'hidden';
  document.body.appendChild(frame);

  try {
    await loadFrame(frame, clean);
    onProgress(0.25);

    const doc = frame.contentDocument || frame.contentWindow?.document;
    if (!doc || !doc.body) throw new Error('Could not access the rendered document.');

    const pdf = await PDFDocument.create();
    const pages = await addElementPages(pdf, doc.body, geo, setup.format, (done, total) => {
      onProgress(0.25 + 0.7 * (done / Math.max(1, total)));
    });

    onProgress(0.95);
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
