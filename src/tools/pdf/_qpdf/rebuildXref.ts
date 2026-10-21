// "latin1" decodes one character per byte, which keeps text offsets equal to byte offsets
const latin1 = new TextDecoder('latin1');

function toAsciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Rebuilds the cross-reference table of a damaged PDF by scanning for "N G obj" markers.
 * The WASM build of qpdf cannot reconstruct a broken xref itself, so this runs before it.
 * Objects stored inside object streams are not found; files that depend on them are not rebuilt.
 * Throws when no document catalog can be located.
 */
export function rebuildXref(bytes: Uint8Array): Uint8Array {
  const text = latin1.decode(bytes);

  // keep only complete objects: cut a truncated tail after the last "endobj"
  const lastEnd = text.lastIndexOf('endobj');
  if (lastEnd < 0) throw new Error('No PDF objects were found in this file.');
  const body = text.slice(0, lastEnd + 'endobj'.length);

  const offsets = new Map<number, { offset: number; gen: number }>();
  const objPattern = /(?<![0-9])(\d{1,10})[ \t\r\n]+(\d{1,5})[ \t\r\n]+obj\b/g;
  for (let m = objPattern.exec(body); m; m = objPattern.exec(body)) {
    // later definitions replace earlier ones (incremental updates)
    offsets.set(Number(m[1]), { offset: m.index, gen: Number(m[2]) });
  }
  if (offsets.size === 0) throw new Error('No PDF objects were found in this file.');

  let rootRef: string | null = null;
  const rootPattern = /\/Root[ \t\r\n]+(\d+)[ \t\r\n]+(\d+)[ \t\r\n]+R/g;
  for (let m = rootPattern.exec(body); m; m = rootPattern.exec(body)) {
    if (offsets.has(Number(m[1]))) rootRef = `${m[1]} ${m[2]} R`;
  }
  if (!rootRef) {
    for (const [num, { offset, gen }] of offsets) {
      const end = body.indexOf('endobj', offset);
      if (/\/Type[ \t\r\n]*\/Catalog\b/.test(body.slice(offset, end < 0 ? undefined : end))) {
        rootRef = `${num} ${gen} R`;
      }
    }
  }
  if (!rootRef) throw new Error('The document catalog could not be found.');

  const maxObj = Math.max(...offsets.keys());
  const header = body.startsWith('%PDF-') ? '' : '%PDF-1.7\n';
  const prefix = header.length;

  let xref = `xref\n0 ${maxObj + 1}\n`;
  for (let n = 0; n <= maxObj; n++) {
    const entry = offsets.get(n);
    xref += entry ? `${pad(entry.offset + prefix, 10)} ${pad(entry.gen, 5)} n \n` : `${pad(0, 10)} ${pad(n === 0 ? 65535 : 0, 5)} f \n`;
  }

  const xrefOffset = prefix + body.length + 1;
  const tail = `\n${xref}trailer\n<< /Size ${maxObj + 1} /Root ${rootRef} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  // the body is copied from the original bytes: the scan text is only used to find offsets
  const head = toAsciiBytes(header);
  const end = toAsciiBytes(tail);
  const out = new Uint8Array(head.length + body.length + end.length);
  out.set(head, 0);
  out.set(bytes.subarray(0, body.length), head.length);
  out.set(end, head.length + body.length);
  return out;
}
