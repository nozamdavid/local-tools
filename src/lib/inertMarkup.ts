/**
 * Lightweight, zero-dependency inert markup sanitization utilities.
 * Enforces authoritative privacy boundaries on imported markup (MHTML, HTML, CSS, OOXML .rels).
 */

/**
 * Unescapes CSS escape sequences (\xx hex and \char) in CSS strings and URLs.
 */
export function unescapeCss(str: string): string {
  return str.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|([^0-9a-fA-F\r\n]))/g, (_match, hex, char) => {
    if (hex) {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    }
    return char || '';
  });
}

/**
 * Checks if a URL is safe to retain in standalone/local rendering (data, blob, or internal hash).
 */
export function isSafeDataOrBlobUrl(url: string): boolean {
  const clean = unescapeCss(url.trim());
  return /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(clean) ||
    /^data:(?:text\/css|font\/[^;]+);base64,/i.test(clean) ||
    clean.startsWith('blob:') ||
    clean.startsWith('#');
}

/**
 * Robustly neutralizes closing style tag variants in user CSS to prevent rawtext HTML breakout.
 * Handles </style>, </style >, </style\t>, </style\n>, </style/x>, and </style attr="foo">.
 * Turning </style into <\/style keeps the HTML parser inside RAWTEXT mode, while CSS parsers
 * treat \/ as an escaped forward slash character.
 */
export function escapeStyleTagBreakout(css: string): string {
  return css.replace(/<\s*\/\s*style\b/gi, '<\\/style');
}

/**
 * Strips active scripts, meta-refresh, base elements, forms, frames, and outbound link navigation
 * from editable sample HTML to prevent privacy leaks and unintended redirects.
 */
export function sanitizeSampleHtml(html: string): string {
  let clean = html;

  // 1. Strip script elements
  clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  clean = clean.replace(/<script\b[^>]*\/>/gi, '');

  // 2. Strip base and meta refresh
  clean = clean.replace(/<base\b[^>]*>/gi, '');
  clean = clean.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');

  // 3. Strip forms and frame/embedded elements
  clean = clean.replace(/<(?:iframe|frame|frameset|object|embed|applet|form)\b[^>]*>.*?<\/(?:iframe|frame|frameset|object|embed|applet|form)>/gis, '');
  clean = clean.replace(/<(?:iframe|frame|frameset|object|embed|applet|form)\b[^>]*\/>/gi, '');

  // 4. Strip inline event handlers
  clean = clean.replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // 5. Neutralize outbound navigation on links (preserve local hash anchors)
  clean = clean.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
    const hrefMatch = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    const href = hrefMatch ? hrefMatch[2] : '';
    if (href.startsWith('#')) {
      return match.replace(/\starget\s*=\s*(["']).*?\1/gi, '');
    }
    return match
      .replace(/\bhref\s*=\s*(["']).*?\1/gi, 'href="#"')
      .replace(/\starget\s*=\s*(["']).*?\1/gi, '');
  });

  return clean;
}

/**
 * Neutralizes external @import rules and external url(...) references in CSS text.
 */
export function sanitizeCssText(
  cssText: string,
  resolveUrl?: (url: string) => string
): string {
  // 1. Process @import (with url(...) or quoted string, optional semicolon, media query)
  let result = cssText.replace(
    /@import\s+(?:url\s*\(\s*(['"]?)([^)'"]+)\1\s*\)|(['"])([^'"]+)\3)[^\S\r\n]*([^;\r\n{}]*);?/gi,
    (_match, _q1, url1, _q2, url2, media) => {
      const rawUrl = url1 || url2 || '';
      const unescaped = unescapeCss(rawUrl.trim());
      if (resolveUrl) {
        const resolved = resolveUrl(unescaped);
        if (resolved && !resolved.startsWith('about:blank') && resolved !== 'none') {
          const mediaSuffix = media?.trim() ? ` ${media.trim()}` : '';
          return `@import url("${resolved}")${mediaSuffix};`;
        }
      }
      return '/* @import blocked */';
    }
  );

  // 2. Process url(...) references
  result = result.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_match, _quote, urlInside) => {
    const unescaped = unescapeCss(urlInside.trim());
    if (resolveUrl) {
      const resolved = resolveUrl(unescaped);
      return `url("${resolved}")`;
    }
    if (isSafeDataOrBlobUrl(unescaped)) {
      return `url("${unescaped}")`;
    }
    return 'none';
  });

  // 3. Fail-closed defense: remove any leftover @import rules
  result = result.replace(/@import\b[^;{}]*(?:;|$)/gi, '/* @import blocked */');

  return result;
}

/**
 * Safely parses and neutralizes external relationships in Office (.docx, .pptx) .rels files.
 * Replaces external images with transparent 1x1 PNG data URIs.
 * Neutralizes external hyperlinks to safe inert '#' targets while preserving visible text.
 * Strictly preserves internal image targets (e.g. media/image1.png).
 */
export function neutralizeOfficeRels(relsXml: string): string {
  // Strip external DTD and entity declarations
  const cleanXml = relsXml
    .replace(/<!DOCTYPE\s+[^>\[]+(?:\[[\s\S]*?\])?\s*>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '');

  // 1. Browser XML DOM parser if available
  if (typeof DOMParser !== 'undefined' && typeof XMLSerializer !== 'undefined') {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(cleanXml, 'application/xml');
      const parseError = xmlDoc.querySelector('parsererror');
      if (!parseError) {
        const rels = xmlDoc.getElementsByTagName('Relationship');
        for (let i = 0; i < rels.length; i++) {
          const rel = rels[i];
          const targetMode = (rel.getAttribute('TargetMode') || '').toLowerCase();
          const target = (rel.getAttribute('Target') || '').trim();
          const type = (rel.getAttribute('Type') || '').toLowerCase();

          const isRemote = /^https?:|^\/\/|^ftp:|^javascript:/i.test(target);
          const isExternal = targetMode === 'external' || isRemote;

          if (isExternal) {
            if (type.includes('image')) {
              rel.setAttribute(
                'Target',
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA='
              );
              rel.removeAttribute('TargetMode');
            } else if (type.includes('hyperlink')) {
              rel.setAttribute('Target', '#');
              rel.removeAttribute('TargetMode');
            } else {
              rel.setAttribute('Target', 'about:blank#blocked-rel');
              rel.removeAttribute('TargetMode');
            }
          }
        }
        return new XMLSerializer().serializeToString(xmlDoc);
      }
    } catch {
      // Fall through to regex-based parser
    }
  }

  // 2. Regex fallback for Node/headless verification, handling single/double quotes,
  // non-self-closing tags, protocol-relative URLs, and XML entities.
  return cleanXml.replace(
    /<Relationship\b([^>]*?)(?:\/>|>(.*?)<\/Relationship>)/gi,
    (fullMatch, attrs, innerContent) => {
      const targetModeMatch = attrs.match(/TargetMode\s*=\s*(["'])(.*?)\1/i);
      const targetMode = targetModeMatch ? targetModeMatch[2].toLowerCase() : '';

      const targetMatch = attrs.match(/Target\s*=\s*(["'])(.*?)\1/i);
      const rawTarget = targetMatch ? targetMatch[2] : '';
      const decodedTarget = rawTarget.replace(/&amp;/g, '&');

      const typeMatch = attrs.match(/Type\s*=\s*(["'])(.*?)\1/i);
      const typeVal = typeMatch ? typeMatch[2].toLowerCase() : '';

      const isRemote = /^https?:|^\/\/|^ftp:|^javascript:/i.test(decodedTarget.trim());
      const isExternal = targetMode === 'external' || isRemote;

      if (!isExternal) {
        return fullMatch;
      }

      let newTarget = 'about:blank#blocked-rel';
      if (typeVal.includes('image')) {
        newTarget = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAA=';
      } else if (typeVal.includes('hyperlink')) {
        newTarget = '#';
      }

      let newAttrs = attrs
        .replace(/\s*TargetMode\s*=\s*(["']).*?\1/gi, '')
        .replace(/Target\s*=\s*(["']).*?\1/gi, `Target="${newTarget}"`);

      if (!/Target\s*=/i.test(newAttrs)) {
        newAttrs += ` Target="${newTarget}"`;
      }

      if (innerContent !== undefined) {
        return `<Relationship ${newAttrs.trim()}>${innerContent}</Relationship>`;
      }
      return `<Relationship ${newAttrs.trim()}/>`;
    }
  );
}
