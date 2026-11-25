import { translate } from '../../../lib/i18n';

export const MAX_SVG_BYTES = 5 * 1024 * 1024;

type LocalizedError = Error & { sourceEnglish: string };

function localizedError(sourceEnglish: string, cause?: unknown): LocalizedError {
  const error = new Error(translate(sourceEnglish), cause === undefined ? undefined : { cause }) as LocalizedError;
  error.sourceEnglish = sourceEnglish;
  return error;
}
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export type SvgSizeStatus = 'smaller' | 'same' | 'larger';

export function getSvgSizeChange(originalBytes: number, optimizedBytes: number): { status: SvgSizeStatus; difference: number } {
  if (optimizedBytes < originalBytes) return { status: 'smaller', difference: originalBytes - optimizedBytes };
  if (optimizedBytes > originalBytes) return { status: 'larger', difference: optimizedBytes - originalBytes };
  return { status: 'same', difference: 0 };
}

export async function optimizeSvgText(source: string): Promise<string> {
  const sourceBytes = new TextEncoder().encode(source).byteLength;
  if (sourceBytes === 0) throw localizedError('The SVG file is empty.');
  if (sourceBytes > MAX_SVG_BYTES) throw localizedError('SVG files must be 5 MB or smaller.');

  try {
    const { optimize } = await import('svgo/browser');
    const result = optimize(source, {
      multipass: true,
      plugins: [
        {
          name: 'preset-default',
          params: {
            overrides: {
              cleanupIds: false,
              inlineStyles: false,
              mergeStyles: false,
              minifyStyles: false,
              removeXMLProcInst: false,
            },
          },
        },
      ],
    });

    const rootName = result.data
      .match(/<([A-Za-z_][\w:.-]*)(?:\s|\/?>)/)?.[1]
      ?.split(':')
      .at(-1);
    if (rootName?.toLowerCase() !== 'svg') throw localizedError('The file does not contain an SVG root element.');
    return result.data;
  } catch (err) {
    if (err instanceof Error && 'sourceEnglish' in err) throw err;
    throw localizedError('This SVG is malformed or unsupported. Check its XML syntax and try again.', err);
  }
}

/** Conservative check used only to decide whether an SVG may be shown in an image preview. */
export function hasExternalResourceReferences(svg: string): boolean {
  const withoutComments = svg.replace(/<!--[\s\S]*?-->/g, '');
  let invalidCharacterReference = false;
  const content = withoutComments
    .replace(/&#(?:x([\da-f]+)|(\d+));/gi, (reference, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? '', hex ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        invalidCharacterReference = true;
        return reference;
      }
      return String.fromCodePoint(codePoint);
    })
    .replace(/&(amp|lt|gt|quot|apos);/g, (_reference, name: string) => XML_ENTITIES[name]);
  if (invalidCharacterReference) return true;

  if (/<!DOCTYPE\b|<\?xml-stylesheet\b|\bxml:base\s*=|<(?:animate|set)\b/i.test(content) || content.includes('\\')) {
    return true;
  }

  const hrefOrSrc = /\b(?:href|src)\s*=\s*(["'])([\s\S]*?)\1/gi;
  for (const match of content.matchAll(hrefOrSrc)) {
    const value = match[2].trim();
    if (value && !value.startsWith('#')) return true;
  }

  const cssUrls = /\burl\s*\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi;
  for (const match of content.matchAll(cssUrls)) {
    const value = (match[2] ?? match[3] ?? '').trim();
    if (value && !value.startsWith('#')) return true;
  }

  if (/@import\b/i.test(content)) return true;
  return false;
}

/** Returns a sanitized SVG string for an image-only preview, or null when references could leave the local file. */
export function createSafeSvgPreview(source: string): string | null {
  if (hasExternalResourceReferences(source)) return null;

  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.localName.toLowerCase() !== 'svg') return null;

  for (const element of Array.from(document.querySelectorAll('*'))) {
    const localName = element.localName.toLowerCase();
    if (localName === 'script' || localName === 'foreignobject') {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) element.removeAttributeNode(attribute);
    }
  }

  return new XMLSerializer().serializeToString(document.documentElement);
}
