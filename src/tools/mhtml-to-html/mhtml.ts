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
  // 1. Remove soft line breaks
  const unfolded = input.replace(/=(?:\r\n|\n|\r)/g, '');

  // 2. Decode =XX to raw bytes
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
 * Lines beginning with space or tab are continuation of previous line.
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
 * Handles both quoted (`boundary="..."`) and unquoted (`boundary=...`).
 */
export function extractBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
  return match ? (match[1] || match[2] || null) : null;
}

/**
 * Parses an entire MHTML document into its root HTML and referenced MIME parts.
 */
export function parseMhtml(mhtmlText: string): ParseMhtmlResult {
  // Find top header and body boundary
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

  // Split into parts by boundary
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

    // Parse MIME type and charset
    const mimeMatch = partContentType.match(/^([^;]+)/);
    const mimeType = mimeMatch ? mimeMatch[1].trim().toLowerCase() : 'text/plain';

    const charsetMatch = partContentType.match(/charset=(?:"([^"]+)"|([^\s;]+))/i);
    const charset = (charsetMatch ? charsetMatch[1] || charsetMatch[2] : 'utf-8').toLowerCase();

    // Decode body data
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
      // 7bit, 8bit, binary
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

    // Identify root HTML part
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
  // Strip url query parameters and hash
  let clean = name.split('?')[0].split('#')[0];
  // Take basename
  const lastSlash = clean.lastIndexOf('/');
  if (lastSlash >= 0) {
    clean = clean.slice(lastSlash + 1);
  }
  // Remove dangerous chars and path traversal
  clean = clean.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!clean || clean === '.' || clean === '..') {
    clean = `asset_${index}`;
  }

  // Ensure extension
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
 * Resolves references (Content-Location, CID, and CSS url(...)),
 * inlines or extracts assets, disables scripts and blocks external remote references.
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
      // Normalized relative path
      try {
        const u = new URL(part.location);
        resourceMap.set(u.pathname, part);
        resourceMap.set(u.pathname.replace(/^\//, ''), part);
      } catch {
        // location was already relative
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
      let safeName = safeAssetFilename(origName, assetIndex, part.mimeType);

      // Ensure uniqueness
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

  let processedHtml = rootHtml;
  let inlinedCount = 0;
  let blockedCount = 0;

  // Helper to resolve an arbitrary URL against the resourceMap
  const resolveUrl = (rawUrl: string): string => {
    const cleanUrl = rawUrl.trim().replace(/^['"]|['"]$/g, '');
    if (!cleanUrl) return rawUrl;

    // Direct match
    let part = resourceMap.get(cleanUrl);
    if (!part && cleanUrl.startsWith('cid:')) {
      part = resourceMap.get(cleanUrl.slice(4));
    }
    if (!part) {
      // Try stripped query
      const noQuery = cleanUrl.split('?')[0].split('#')[0];
      part = resourceMap.get(noQuery);
    }
    if (!part) {
      // Try basename
      const lastSlash = cleanUrl.lastIndexOf('/');
      if (lastSlash >= 0) {
        part = resourceMap.get(cleanUrl.slice(lastSlash + 1));
      }
    }

    if (part && assetTargets.has(part)) {
      inlinedCount++;
      return assetTargets.get(part)!;
    }

    // Check if it's an unmapped remote URL
    const isRemote = /^https?:\/\/|^\/\//i.test(cleanUrl);
    if (isRemote && options.blockRemoteUrls) {
      blockedCount++;
      // Neutralize remote URL to prevent phoning home or fetching private data
      return 'about:blank#blocked-remote-ref';
    }

    return cleanUrl;
  };

  // 1. Resolve URLs inside CSS url(...) in <style> and inline styles
  processedHtml = processedHtml.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_match, _quote, urlInside) => {
    const resolved = resolveUrl(urlInside);
    return `url("${resolved}")`;
  });

  // 2. Resolve HTML src, href, poster attributes
  processedHtml = processedHtml.replace(/\b(src|href|poster)\s*=\s*(["'])([^"']+)\2/gi, (_match, attr, quote, val) => {
    // Avoid modifying fragment links (#section)
    if (val.startsWith('#') || val.startsWith('mailto:')) {
      return `${attr}=${quote}${val}${quote}`;
    }
    const resolved = resolveUrl(val);
    return `${attr}=${quote}${resolved}${quote}`;
  });

  // 3. Security: Strip scripts and inline JS event handlers to keep output inert
  if (options.stripScripts) {
    // Remove script tags and contents
    processedHtml = processedHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '<!-- script removed for security -->');
    // Remove self-closing scripts
    processedHtml = processedHtml.replace(/<script\b[^>]*\/>/gi, '<!-- script removed for security -->');
    // Strip on* inline event handlers (e.g. onclick, onload, onerror)
    processedHtml = processedHtml.replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    // Neutralize javascript: hrefs
    processedHtml = processedHtml.replace(/\bhref\s*=\s*(["'])javascript:[^"']*\1/gi, 'href="javascript:void(0)"');
  }

  return {
    html: processedHtml,
    assets: options.mode === 'zip' ? zipAssets : undefined,
    blockedRemoteCount: blockedCount,
    inlinedAssetsCount: inlinedCount,
  };
}
