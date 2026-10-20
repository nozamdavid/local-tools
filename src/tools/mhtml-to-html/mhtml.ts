import { unescapeCss, sanitizeCssText } from '../../lib/inertMarkup';

export interface MhtmlPart {
  headers: Record<string, string>;
  contentType: string;
  mimeType: string;
  charset: string;
  encoding: string;
  location?: string;
  contentId?: string;
  data: Uint8Array;
  text?: string;
}

export interface ParseMhtmlResult {
  rootHtml: string;
  parts: MhtmlPart[];
  title?: string;
}

export interface ConvertMhtmlOptions {
  mode: 'standalone' | 'zip';
  blockRemoteUrls?: boolean;
  stripScripts?: boolean;
}

export interface ConvertedMhtmlOutput {
  html: string;
  assets?: { name: string; blob: Blob }[];
  blockedRemoteCount: number;
  inlinedAssetsCount: number;
}

/**
 * Normalizes and decodes Base64 into Uint8Array safely in both Browser and Node.
 */
export function decodeBase64(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(clean, 'base64'));
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes Quoted-Printable string or byte sequence into Uint8Array.
 * Handles soft line breaks (=\r\n or =\n) and byte-level =XX hex decoding.
 */
export function decodeQuotedPrintable(input: string): Uint8Array {
  const unfolded = input.replace(/=(?:\r\n|\n|\r)/g, '');
  const bytes: number[] = [];
  let i = 0;
  const len = unfolded.length;

  while (i < len) {
    const char = unfolded[i];
    if (char === '=' && i + 2 < len) {
      const hex = unfolded.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 3;
        continue;
      }
    }
    bytes.push(char.charCodeAt(0) & 0xff);
    i++;
  }

  return new Uint8Array(bytes);
}

/**
 * Unfolds MIME header lines according to RFC 2822.
 */
export function unfoldHeaders(headerText: string): string[] {
  const rawLines = headerText.split(/\r?\n/);
  const unfolded: string[] = [];

  for (const line of rawLines) {
    if (line.length === 0) continue;
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += ' ' + line.trim();
    } else {
      unfolded.push(line);
    }
  }

  return unfolded;
}

/**
 * Parses header lines into a lowercase key-value dictionary.
 */
export function parseHeaderLines(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const val = line.slice(colonIdx + 1).trim();
      headers[key] = val;
    }
  }
  return headers;
}

/**
 * Extracts boundary string from Content-Type header.
 */
export function extractBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
  return match ? (match[1] || match[2] || null) : null;
}

/**
 * Parses an entire MHTML document into its root HTML and referenced MIME parts.
 */
export function parseMhtml(mhtmlText: string): ParseMhtmlResult {
  const splitIdx = mhtmlText.search(/\r?\n\r?\n/);
  if (splitIdx === -1) {
    throw new Error('Invalid MHTML: Missing MIME header separator.');
  }

  const topHeaderText = mhtmlText.slice(0, splitIdx);
  const bodyText = mhtmlText.slice(splitIdx);

  const topHeaderLines = unfoldHeaders(topHeaderText);
  const topHeaders = parseHeaderLines(topHeaderLines);

  const contentType = topHeaders['content-type'] || '';
  const boundary = extractBoundary(contentType);

  if (!boundary) {
    throw new Error('Invalid MHTML: Could not find multipart boundary in Content-Type header.');
  }

  const subject = topHeaders['subject'];
  const startCid = (contentType.match(/start="?([^";]+)"?/i)?.[1] || '').replace(/[<>]/g, '');

  const delimiter = `--${boundary}`;
  const rawParts = bodyText.split(delimiter);

  const parts: MhtmlPart[] = [];
  let rootHtmlPart: MhtmlPart | null = null;

  for (const rawPart of rawParts) {
    const trimmed = rawPart.trim();
    if (!trimmed || trimmed === '--') continue;

    const partHeaderSplit = rawPart.search(/\r?\n\r?\n/);
    if (partHeaderSplit === -1) continue;

    const partHeaderStr = rawPart.slice(0, partHeaderSplit);
    const partBodyStr = rawPart.slice(partHeaderSplit).replace(/^\r?\n\r?\n/, '');

    const partHeaders = parseHeaderLines(unfoldHeaders(partHeaderStr));
    const partContentType = partHeaders['content-type'] || 'text/plain';
    const encoding = (partHeaders['content-transfer-encoding'] || '7bit').toLowerCase();
    const location = partHeaders['content-location'];
    const contentIdRaw = partHeaders['content-id'];
    const contentId = contentIdRaw ? contentIdRaw.replace(/[<>]/g, '').trim() : undefined;

    const mimeMatch = partContentType.match(/^([^;]+)/);
    const mimeType = mimeMatch ? mimeMatch[1].trim().toLowerCase() : 'text/plain';

    const charsetMatch = partContentType.match(/charset=(?:"([^"]+)"|([^\s;]+))/i);
    const charset = (charsetMatch ? charsetMatch[1] || charsetMatch[2] : 'utf-8').toLowerCase();

    let data: Uint8Array;
    let text: string | undefined;

    if (encoding === 'base64') {
      data = decodeBase64(partBodyStr);
      if (mimeType.startsWith('text/') || mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('xml')) {
        try {
          text = new TextDecoder(charset).decode(data);
        } catch {
          text = new TextDecoder('utf-8').decode(data);
        }
      }
    } else if (encoding === 'quoted-printable') {
      data = decodeQuotedPrintable(partBodyStr);
      try {
        text = new TextDecoder(charset).decode(data);
      } catch {
        text = new TextDecoder('utf-8').decode(data);
      }
    } else {
      const encoder = new TextEncoder();
      data = encoder.encode(partBodyStr);
      text = partBodyStr;
    }

    const part: MhtmlPart = {
      headers: partHeaders,
      contentType: partContentType,
      mimeType,
      charset,
      encoding,
      location,
      contentId,
      data,
      text,
    };

    parts.push(part);

    if (!rootHtmlPart) {
      if (startCid && contentId && contentId === startCid) {
        rootHtmlPart = part;
      } else if (mimeType === 'text/html') {
        rootHtmlPart = part;
      }
    }
  }

  if (!rootHtmlPart && parts.length > 0) {
    rootHtmlPart = parts[0];
  }

  const rootHtml = rootHtmlPart?.text || '';
  return {
    rootHtml,
    parts,
    title: subject,
  };
}

/**
 * Creates safe filenames for ZIP archive assets.
 */
export function safeAssetFilename(name: string, index: number, mimeType: string): string {
  let clean = name.split('?')[0].split('#')[0];
  const lastSlash = clean.lastIndexOf('/');
  if (lastSlash >= 0) {
    clean = clean.slice(lastSlash + 1);
  }
  clean = clean.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!clean || clean === '.' || clean === '..') {
    clean = `asset_${index}`;
  }

  if (!clean.includes('.')) {
    if (mimeType === 'image/png') clean += '.png';
    else if (mimeType === 'image/jpeg') clean += '.jpg';
    else if (mimeType === 'image/gif') clean += '.gif';
    else if (mimeType === 'image/webp') clean += '.webp';
    else if (mimeType === 'image/svg+xml') clean += '.svg';
    else if (mimeType === 'text/css') clean += '.css';
    else if (mimeType === 'application/javascript') clean += '.js';
    else clean += '.bin';
  }

  return clean;
}

/**
 * Converts Uint8Array to Base64 safely.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Helper to resolve srcset candidate URLs.
 */
function resolveSrcset(srcset: string, resolveUrl: (url: string) => string): string {
  return srcset
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return '';
      const parts = trimmed.split(/\s+/);
      const url = parts[0];
      const descriptor = parts.slice(1).join(' ');
      const resolved = resolveUrl(url);
      return descriptor ? `${resolved} ${descriptor}` : resolved;
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Injects a strict, mode-aware Content-Security-Policy meta tag as the very FIRST element in <head>.
 */
export function injectStrictCsp(html: string, mode: 'standalone' | 'zip'): string {
  const cspContent =
    mode === 'standalone'
      ? "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; font-src data:; media-src data: blob:; script-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none';"
      : "default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' data:; font-src 'self' data:; media-src 'self' data: blob:; script-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none';";

  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${cspContent}">`;

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}\n  ${metaTag}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (match) => `${match}\n<head>\n  ${metaTag}\n</head>`);
  }
  return `<head>\n  ${metaTag}\n</head>\n${html}`;
}

/**
 * Resolves references (Content-Location, CID, and CSS url(...)),
 * inlines or extracts assets, disables scripts, blocks external remote references,
 * and injects authoritative mode-aware Content Security Policy.
 */
export function convertMhtmlToHtml(
  mhtmlText: string,
  options: ConvertMhtmlOptions = { mode: 'standalone', blockRemoteUrls: true, stripScripts: true }
): ConvertedMhtmlOutput {
  const { rootHtml, parts } = parseMhtml(mhtmlText);

  // Build resource lookup maps
  const resourceMap = new Map<string, MhtmlPart>();

  for (const part of parts) {
    if (part.contentId) {
      resourceMap.set(`cid:${part.contentId}`, part);
      resourceMap.set(part.contentId, part);
    }
    if (part.location) {
      resourceMap.set(part.location, part);
      try {
        const u = new URL(part.location);
        resourceMap.set(u.pathname, part);
        resourceMap.set(u.pathname.replace(/^\//, ''), part);
      } catch {
        resourceMap.set(part.location.replace(/^\//, ''), part);
      }
    }
  }

  // Assign asset targets (either data URI or safe zip path)
  const assetTargets = new Map<MhtmlPart, string>();
  const zipAssets: { name: string; blob: Blob }[] = [];
  const usedNames = new Set<string>();

  let assetIndex = 1;
  for (const part of parts) {
    if (part.mimeType === 'text/html' && part.text === rootHtml) continue;

    if (options.mode === 'standalone') {
      const b64 = bytesToBase64(part.data);
      const dataUri = `data:${part.mimeType};base64,${b64}`;
      assetTargets.set(part, dataUri);
    } else {
      const origName = part.location || part.contentId || `asset_${assetIndex}`;
      const safeName = safeAssetFilename(origName, assetIndex, part.mimeType);

      let uniqueName = safeName;
      let counter = 2;
      while (usedNames.has(uniqueName)) {
        const dot = safeName.lastIndexOf('.');
        uniqueName = dot > 0 ? `${safeName.slice(0, dot)}_${counter}${safeName.slice(dot)}` : `${safeName}_${counter}`;
        counter++;
      }
      usedNames.add(uniqueName);

      const relPath = `./assets/${uniqueName}`;
      assetTargets.set(part, relPath);
      zipAssets.push({
        name: `assets/${uniqueName}`,
        blob: new Blob([part.data as BlobPart], { type: part.mimeType }),
      });
      assetIndex++;
    }
  }

  let inlinedCount = 0;
  let blockedCount = 0;

  // Authoritative resolver for arbitrary URLs
  const resolveUrl = (rawUrl: string): string => {
    const unescaped = unescapeCss(rawUrl.trim().replace(/^['"]|['"]$/g, ''));
    if (!unescaped) return rawUrl;

    if (unescaped.startsWith('#') || unescaped.startsWith('mailto:')) {
      return unescaped;
    }

    // Direct match
    let part = resourceMap.get(unescaped);
    if (!part && unescaped.startsWith('cid:')) {
      part = resourceMap.get(unescaped.slice(4));
    }
    if (!part) {
      const noQuery = unescaped.split('?')[0].split('#')[0];
      part = resourceMap.get(noQuery);
    }
    if (!part) {
      const lastSlash = unescaped.lastIndexOf('/');
      if (lastSlash >= 0) {
        part = resourceMap.get(unescaped.slice(lastSlash + 1));
      }
    }

    if (part && assetTargets.has(part)) {
      inlinedCount++;
      return assetTargets.get(part)!;
    }

    // Safe inline raster data URIs can be retained
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(unescaped)) {
      return unescaped;
    }

    // Unmapped references: in both standalone and ZIP modes, block remote or relative leaks
    if (options.blockRemoteUrls) {
      blockedCount++;
      return 'about:blank#blocked-remote-ref';
    }

    return rawUrl;
  };

  let processedHtml = rootHtml;

  // 1. Process via inert DOMParser when available in browser
  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(processedHtml, 'text/html');

    // Remove active/navigating elements: base, meta-refresh, forms, frames, object, embed
    doc.querySelectorAll('base, meta[http-equiv="refresh" i], iframe, frame, frameset, object, embed, applet, form, input[type="image"]').forEach((el) => el.remove());

    if (options.stripScripts) {
      doc.querySelectorAll('script, noscript').forEach((el) => el.remove());
    }

    // Remove event handlers and clean style attributes
    const all = doc.querySelectorAll('*');
    for (const el of Array.from(all)) {
      for (const attr of Array.from(el.attributes)) {
        if (options.stripScripts && attr.name.toLowerCase().startsWith('on')) {
          el.removeAttribute(attr.name);
        }
        if (attr.name.toLowerCase() === 'style') {
          el.setAttribute('style', sanitizeCssText(attr.value, resolveUrl));
        }
      }
    }

    // Clean style elements
    doc.querySelectorAll('style').forEach((styleEl) => {
      styleEl.textContent = sanitizeCssText(styleEl.textContent || '', resolveUrl);
    });

    // Clean link tags: stylesheets and preloads
    doc.querySelectorAll('link').forEach((link) => {
      const href = link.getAttribute('href');
      if (href) {
        const resolved = resolveUrl(href);
        if (resolved.startsWith('about:blank')) {
          link.remove();
        } else {
          link.setAttribute('href', resolved);
        }
      }
    });

    // Clean img, video, audio, track
    doc.querySelectorAll('img, video, audio, track').forEach((media) => {
      const src = media.getAttribute('src');
      if (src) {
        media.setAttribute('src', resolveUrl(src));
      }
      const poster = media.getAttribute('poster');
      if (poster) {
        media.setAttribute('poster', resolveUrl(poster));
      }
      const srcset = media.getAttribute('srcset');
      if (srcset) {
        media.setAttribute('srcset', resolveSrcset(srcset, resolveUrl));
      }
    });

    // Clean picture source tags
    doc.querySelectorAll('picture source').forEach((source) => {
      const src = source.getAttribute('src');
      if (src) {
        source.setAttribute('src', resolveUrl(src));
      }
      const srcset = source.getAttribute('srcset');
      if (srcset) {
        source.setAttribute('srcset', resolveSrcset(srcset, resolveUrl));
      }
    });

    // Neutralize SVG use and feImage
    doc.querySelectorAll('svg use').forEach((useEl) => {
      const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
      if (!href.startsWith('#')) {
        const resolved = resolveUrl(href);
        if (resolved.startsWith('about:blank')) {
          useEl.removeAttribute('href');
          useEl.removeAttribute('xlink:href');
        } else {
          useEl.setAttribute('href', resolved);
        }
      }
    });
    doc.querySelectorAll('svg feImage, svg image').forEach((imgEl) => {
      const href = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href') || '';
      if (href) {
        const resolved = resolveUrl(href);
        if (resolved.startsWith('about:blank')) {
          imgEl.removeAttribute('href');
          imgEl.removeAttribute('xlink:href');
        } else {
          imgEl.setAttribute('href', resolved);
        }
      }
    });

    // Strip active navigation on <a> tags
    doc.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) {
        return;
      }
      if (href.toLowerCase().startsWith('javascript:')) {
        a.setAttribute('href', 'javascript:void(0)');
        return;
      }
      const resolved = resolveUrl(href);
      if (resolved.startsWith('about:blank')) {
        a.setAttribute('href', 'about:blank#blocked-link');
      } else {
        a.setAttribute('href', resolved);
      }
      a.removeAttribute('target');
    });

    processedHtml = doc.documentElement.outerHTML;
  } else {
    // 2. Headless / Node string processing fallback

    // Strip base and meta refresh
    processedHtml = processedHtml.replace(/<base\b[^>]*>/gi, '');
    processedHtml = processedHtml.replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])refresh\1[^>]*>/gi, '');

    // Strip forms, frames, object, embed
    processedHtml = processedHtml.replace(/<(?:iframe|frame|frameset|object|embed|applet)\b[^>]*>.*?<\/(?:iframe|frame|frameset|object|embed|applet)>/gis, '');
    processedHtml = processedHtml.replace(/<(?:iframe|frame|frameset|object|embed|applet)\b[^>]*\/?>/gi, '');
    processedHtml = processedHtml.replace(/<form\b[^>]*>.*?<\/form>/gis, '');
    processedHtml = processedHtml.replace(/<form\b[^>]*\/?>/gi, '');

    // Resolve CSS in <style> blocks
    processedHtml = processedHtml.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_match, css) => {
      const sanitized = sanitizeCssText(css, resolveUrl);
      return `<style>${sanitized}</style>`;
    });

    // Resolve inline style attributes
    processedHtml = processedHtml.replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi, (_match, quote, css) => {
      const sanitized = sanitizeCssText(css, resolveUrl);
      return `style=${quote}${sanitized}${quote}`;
    });

    // Resolve srcset attributes
    processedHtml = processedHtml.replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi, (_match, quote, val) => {
      return `srcset=${quote}${resolveSrcset(val, resolveUrl)}${quote}`;
    });

    // Resolve HTML src, href, poster, data attributes
    processedHtml = processedHtml.replace(/\b(src|href|poster|data)\s*=\s*(["'])([^"']+)\2/gi, (_match, attr, quote, val) => {
      if (val.startsWith('#') || val.startsWith('mailto:')) {
        return `${attr}=${quote}${val}${quote}`;
      }
      if (options.stripScripts && val.toLowerCase().startsWith('javascript:')) {
        return `${attr}=${quote}javascript:void(0)${quote}`;
      }
      const resolved = resolveUrl(val);
      return `${attr}=${quote}${resolved}${quote}`;
    });

    // Strip scripts and event handlers
    if (options.stripScripts) {
      processedHtml = processedHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '<!-- script removed for security -->');
      processedHtml = processedHtml.replace(/<script\b[^>]*\/>/gi, '<!-- script removed for security -->');
      processedHtml = processedHtml.replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    }
  }

  // 3. Inject authoritative mode-aware CSP at first head position
  processedHtml = injectStrictCsp(processedHtml, options.mode);

  return {
    html: processedHtml,
    assets: options.mode === 'zip' ? zipAssets : undefined,
    blockedRemoteCount: blockedCount,
    inlinedAssetsCount: inlinedCount,
  };
}
