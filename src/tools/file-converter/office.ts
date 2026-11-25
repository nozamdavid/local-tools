import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { readZipEntry } from '../../lib/zip';

export interface OfficeFormat {
  label: string;
  mime: string;
  ext: string;
  family: 'document';
  aliases: string[];
  targets: string[];
  limitation?: string;
}

const CONTENT_ONLY = 'Exports document content without preserving its original layout, formatting, images, or pagination.';
const SPREADSHEET_LIMITATION = `${CONTENT_ONLY} CSV and TSV contain only the first sheet; JSON and HTML include every sheet with its name and cached cell values.`;
const LIBREOFFICE_EXPORT =
  'This legacy binary format is not parsed in the browser. Open it in LibreOffice and export it to a supported format.';

/** Office format metadata used by the file converter. Existing format detection entries remain authoritative. */
export const OFFICE_FORMATS: Record<string, OfficeFormat> = {
  odt: {
    label: 'OpenDocument Text',
    mime: 'application/vnd.oasis.opendocument.text',
    ext: 'odt',
    family: 'document',
    aliases: ['odt'],
    targets: ['txt', 'html', 'pdf'],
    limitation: CONTENT_ONLY,
  },
  ott: {
    label: 'OpenDocument Text Template',
    mime: 'application/vnd.oasis.opendocument.text-template',
    ext: 'ott',
    family: 'document',
    aliases: ['ott'],
    targets: ['txt', 'html', 'pdf'],
    limitation: CONTENT_ONLY,
  },
  odm: {
    label: 'OpenDocument Master Document',
    mime: 'application/vnd.oasis.opendocument.text-master',
    ext: 'odm',
    family: 'document',
    aliases: ['odm'],
    targets: ['txt', 'html', 'pdf'],
    limitation: `${CONTENT_ONLY} Only text embedded in the master file is included; linked subdocuments are not opened.`,
  },
  fodt: {
    label: 'Flat OpenDocument Text',
    mime: 'application/vnd.oasis.opendocument.text-flat-xml',
    ext: 'fodt',
    family: 'document',
    aliases: ['fodt'],
    targets: ['txt', 'html', 'pdf'],
    limitation: CONTENT_ONLY,
  },
  ods: {
    label: 'OpenDocument Spreadsheet',
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
    ext: 'ods',
    family: 'document',
    aliases: ['ods'],
    targets: ['txt', 'html', 'pdf', 'csv', 'tsv', 'json'],
    limitation: SPREADSHEET_LIMITATION,
  },
  ots: {
    label: 'OpenDocument Spreadsheet Template',
    mime: 'application/vnd.oasis.opendocument.spreadsheet-template',
    ext: 'ots',
    family: 'document',
    aliases: ['ots'],
    targets: ['txt', 'html', 'pdf', 'csv', 'tsv', 'json'],
    limitation: SPREADSHEET_LIMITATION,
  },
  fods: {
    label: 'Flat OpenDocument Spreadsheet',
    mime: 'application/vnd.oasis.opendocument.spreadsheet-flat-xml',
    ext: 'fods',
    family: 'document',
    aliases: ['fods'],
    targets: ['txt', 'html', 'pdf', 'csv', 'tsv', 'json'],
    limitation: SPREADSHEET_LIMITATION,
  },
  odp: {
    label: 'OpenDocument Presentation',
    mime: 'application/vnd.oasis.opendocument.presentation',
    ext: 'odp',
    family: 'document',
    aliases: ['odp'],
    targets: ['txt', 'html', 'pdf'],
    limitation: CONTENT_ONLY,
  },
  otp: {
    label: 'OpenDocument Presentation Template',
    mime: 'application/vnd.oasis.opendocument.presentation-template',
    ext: 'otp',
    family: 'document',
    aliases: ['otp'],
    targets: ['txt', 'html', 'pdf'],
    limitation: CONTENT_ONLY,
  },
  fodp: {
    label: 'Flat OpenDocument Presentation',
    mime: 'application/vnd.oasis.opendocument.presentation-flat-xml',
    ext: 'fodp',
    family: 'document',
    aliases: ['fodp'],
    targets: ['txt', 'html', 'pdf'],
    limitation: CONTENT_ONLY,
  },
  odg: {
    label: 'OpenDocument Drawing',
    mime: 'application/vnd.oasis.opendocument.graphics',
    ext: 'odg',
    family: 'document',
    aliases: ['odg'],
    targets: ['txt', 'html', 'pdf'],
    limitation: CONTENT_ONLY,
  },
  otg: {
    label: 'OpenDocument Drawing Template',
    mime: 'application/vnd.oasis.opendocument.graphics-template',
    ext: 'otg',
    family: 'document',
    aliases: ['otg'],
    targets: ['txt', 'html', 'pdf'],
    limitation: CONTENT_ONLY,
  },
  fodg: {
    label: 'Flat OpenDocument Drawing',
    mime: 'application/vnd.oasis.opendocument.graphics-flat-xml',
    ext: 'fodg',
    family: 'document',
    aliases: ['fodg'],
    targets: ['txt', 'html', 'pdf'],
    limitation: CONTENT_ONLY,
  },
  odf: {
    label: 'OpenDocument Formula',
    mime: 'application/vnd.oasis.opendocument.formula',
    ext: 'odf',
    family: 'document',
    aliases: ['odf'],
    targets: ['txt', 'html', 'pdf'],
    limitation: CONTENT_ONLY,
  },
  odb: {
    label: 'OpenDocument Database',
    mime: 'application/vnd.oasis.opendocument.database',
    ext: 'odb',
    family: 'document',
    aliases: ['odb'],
    targets: [],
    limitation:
      'This is a database container. This browser converter does not open database connections or export query results; export a table or query with LibreOffice Base.',
  },
  oxt: {
    label: 'OpenOffice Extension Package',
    mime: 'application/vnd.openofficeorg.extension',
    ext: 'oxt',
    family: 'document',
    aliases: ['oxt'],
    targets: [],
    limitation: 'This is an office extension package, not a document. Manage it with the LibreOffice Extension Manager.',
  },
  doc: {
    label: 'Word Document (DOC)',
    mime: 'application/msword',
    ext: 'doc',
    family: 'document',
    aliases: ['doc'],
    targets: [],
    limitation: `${LIBREOFFICE_EXPORT} Save as DOCX, ODT, or PDF in LibreOffice Writer.`,
  },
  docx: {
    label: 'Word Document (DOCX)',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx',
    family: 'document',
    aliases: ['docx'],
    targets: ['pdf', 'png', 'jpg', 'txt', 'html'],
    limitation: 'PDF, PNG, and JPG exports use the available DOCX renderer; text and HTML exports extract document content.',
  },
  dot: {
    label: 'Word Template (DOT)',
    mime: 'application/msword',
    ext: 'dot',
    family: 'document',
    aliases: ['dot'],
    targets: [],
    limitation: `${LIBREOFFICE_EXPORT} Save as DOCX, ODT, or PDF in LibreOffice Writer.`,
  },
  dotx: {
    label: 'Word Template (DOTX)',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
    ext: 'dotx',
    family: 'document',
    aliases: ['dotx'],
    targets: ['pdf', 'png', 'jpg', 'txt', 'html'],
    limitation: 'Uses the available DOCX content and rendering paths; template layout and advanced fields may differ.',
  },
  rtf: {
    label: 'Rich Text Format',
    mime: 'application/rtf',
    ext: 'rtf',
    family: 'document',
    aliases: ['rtf'],
    targets: [],
    limitation: 'RTF parsing is not supported in the browser. Open it in LibreOffice Writer and export to a supported format.',
  },
  wps: {
    label: 'Works Word Processor Document',
    mime: 'application/vnd.ms-works',
    ext: 'wps',
    family: 'document',
    aliases: ['wps'],
    targets: [],
    limitation: `${LIBREOFFICE_EXPORT} Save as DOCX, ODT, or PDF in LibreOffice Writer.`,
  },
  xls: {
    label: 'Excel Spreadsheet (XLS)',
    mime: 'application/vnd.ms-excel',
    ext: 'xls',
    family: 'document',
    aliases: ['xls'],
    targets: [],
    limitation: `${LIBREOFFICE_EXPORT} Save as XLSX, ODS, CSV, or PDF in LibreOffice Calc.`,
  },
  xlsx: {
    label: 'Excel Spreadsheet (XLSX)',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
    family: 'document',
    aliases: ['xlsx'],
    targets: ['pdf', 'csv', 'tsv', 'json', 'txt'],
    limitation:
      'Spreadsheet exports use cached cell values. CSV and TSV include only the first sheet; JSON preserves sheet names and values.',
  },
  xlt: {
    label: 'Excel Template (XLT)',
    mime: 'application/vnd.ms-excel',
    ext: 'xlt',
    family: 'document',
    aliases: ['xlt'],
    targets: [],
    limitation: `${LIBREOFFICE_EXPORT} Save as XLSX, ODS, CSV, or PDF in LibreOffice Calc.`,
  },
  csv: { label: 'CSV Document', mime: 'text/csv', ext: 'csv', family: 'document', aliases: ['csv'], targets: ['json', 'tsv', 'csv'] },
  tsv: {
    label: 'TSV Document',
    mime: 'text/tab-separated-values',
    ext: 'tsv',
    family: 'document',
    aliases: ['tsv'],
    targets: ['json', 'csv', 'tsv'],
  },
  ppt: {
    label: 'PowerPoint Presentation (PPT)',
    mime: 'application/vnd.ms-powerpoint',
    ext: 'ppt',
    family: 'document',
    aliases: ['ppt'],
    targets: [],
    limitation: `${LIBREOFFICE_EXPORT} Save as PPTX, ODP, or PDF in LibreOffice Impress.`,
  },
  pptx: {
    label: 'PowerPoint Presentation (PPTX)',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ext: 'pptx',
    family: 'document',
    aliases: ['pptx'],
    targets: ['pdf', 'txt'],
    limitation: 'PDF export uses the available presentation renderer; text export extracts slide content.',
  },
  pps: {
    label: 'PowerPoint Slide Show (PPS)',
    mime: 'application/vnd.ms-powerpoint',
    ext: 'pps',
    family: 'document',
    aliases: ['pps'],
    targets: [],
    limitation: `${LIBREOFFICE_EXPORT} Save as PPTX, ODP, or PDF in LibreOffice Impress.`,
  },
  pdf: { label: 'PDF Document', mime: 'application/pdf', ext: 'pdf', family: 'document', aliases: ['pdf'], targets: ['txt', 'png', 'jpg'] },
  epub: {
    label: 'EPUB Publication',
    mime: 'application/epub+zip',
    ext: 'epub',
    family: 'document',
    aliases: ['epub'],
    targets: ['txt', 'html', 'pdf'],
    limitation:
      'Extracts readable spine content in reading order. DRM, remote resources, images, scripts, and book layout are not preserved.',
  },
  vsd: {
    label: 'Visio Drawing (VSD)',
    mime: 'application/vnd.visio',
    ext: 'vsd',
    family: 'document',
    aliases: ['vsd'],
    targets: [],
    limitation: `${LIBREOFFICE_EXPORT} Open it in LibreOffice Draw and export to SVG or PDF.`,
  },
  vsdx: {
    label: 'Visio Drawing (VSDX)',
    mime: 'application/vnd.ms-visio.drawing',
    ext: 'vsdx',
    family: 'document',
    aliases: ['vsdx'],
    targets: ['txt', 'html', 'pdf'],
    limitation: 'Exports text labels from pages in numeric order. Shapes, connectors, geometry, and visual layout are not preserved.',
  },
  pub: {
    label: 'Publisher Document',
    mime: 'application/x-mspublisher',
    ext: 'pub',
    family: 'document',
    aliases: ['pub'],
    targets: [],
    limitation: 'This legacy Publisher binary is not parsed in the browser. Open it in LibreOffice Draw or Publisher and export to PDF.',
  },
};

const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5_000;
const MAX_XML_NODES = 500_000;
const MAX_TEXT_CHARS = 4 * 1024 * 1024;
const MAX_ROWS = 10_000;
const MAX_CELLS = 100_000;
const MAX_REPEAT = 10_000;
const MAX_CELL_TEXT = 64 * 1024;

const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  math: 'http://www.w3.org/1998/Math/MathML',
  xhtml: 'http://www.w3.org/1999/xhtml',
  container: 'urn:oasis:names:tc:opendocument:xmlns:container',
  opf: 'http://www.idpf.org/2007/opf',
};

type XmlContent = string | XmlElement;
interface XmlAttribute {
  local: string;
  namespace: string;
  value: string;
}
interface XmlElement {
  local: string;
  namespace: string;
  attributes: XmlAttribute[];
  children: XmlContent[];
}

class TextBudget {
  private used = 0;

  consume(text: string, copies = 1): void {
    this.used += text.length * copies;
    if (this.used > MAX_TEXT_CHARS) throw new Error('Document text exceeds the 4 MB extraction limit.');
  }
}

function parseXml(xml: string, label: string): XmlElement {
  if (xml.length > MAX_PACKAGE_BYTES) throw new Error(`${label} exceeds the 32 MB XML limit.`);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error(`${label} uses a DTD or entity declaration, which is not supported.`);
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`Malformed XML in ${label}: ${valid.err.msg}.`);

  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    cdataPropName: '#cdata',
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
  });
  const parsed = parser.parse(xml) as unknown;
  let count = 0;

  function convert(raw: unknown, inheritedNamespaces: Map<string, string>): XmlContent | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (typeof record['#text'] === 'string') {
      count++;
      return record['#text'];
    }
    if (typeof record['#cdata'] === 'string') {
      count++;
      return record['#cdata'];
    }
    const name = Object.keys(record).find((key) => key !== ':@');
    if (!name || name.startsWith('?') || name.startsWith('#')) return null;

    const rawAttributes = record[':@'] && typeof record[':@'] === 'object' ? (record[':@'] as Record<string, unknown>) : {};
    const namespaces = new Map(inheritedNamespaces);
    for (const [key, value] of Object.entries(rawAttributes)) {
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const attributeName = key.startsWith('@_') ? key.slice(2) : key;
      if (attributeName === 'xmlns') namespaces.set('', String(value));
      else if (attributeName.startsWith('xmlns:')) namespaces.set(attributeName.slice(6), String(value));
    }

    const [prefix, local] = name.includes(':') ? [name.slice(0, name.indexOf(':')), name.slice(name.indexOf(':') + 1)] : ['', name];
    count++;
    if (count > MAX_XML_NODES) throw new Error(`${label} contains too many XML nodes.`);
    const attributes: XmlAttribute[] = [];
    for (const [key, value] of Object.entries(rawAttributes)) {
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const attributeName = key.startsWith('@_') ? key.slice(2) : key;
      if (attributeName === 'xmlns' || attributeName.startsWith('xmlns:')) continue;
      const [attributePrefix, attributeLocal] = attributeName.includes(':')
        ? [attributeName.slice(0, attributeName.indexOf(':')), attributeName.slice(attributeName.indexOf(':') + 1)]
        : ['', attributeName];
      attributes.push({
        local: attributeLocal,
        namespace: attributePrefix ? namespaces.get(attributePrefix) || '' : '',
        value: String(value),
      });
    }

    const children: XmlContent[] = [];
    const rawChildren = record[name];
    if (Array.isArray(rawChildren)) {
      for (const rawChild of rawChildren) {
        const child = convert(rawChild, namespaces);
        if (child !== null) children.push(child);
      }
    }
    if (count > MAX_XML_NODES) throw new Error(`${label} contains too many XML nodes.`);
    return { local, namespace: namespaces.get(prefix) || '', attributes, children };
  }

  const roots: XmlElement[] = [];
  if (Array.isArray(parsed)) {
    for (const rawRoot of parsed) {
      const root = convert(rawRoot, new Map());
      if (root && typeof root !== 'string') roots.push(root);
    }
  }
  if (roots.length !== 1) throw new Error(`${label} must contain one XML document element.`);
  return roots[0];
}

function attribute(element: XmlElement, local: string, namespace = ''): string | undefined {
  return element.attributes.find((item) => item.local === local && item.namespace === namespace)?.value;
}

function isElement(item: XmlContent, namespace: string, local: string): item is XmlElement {
  return typeof item !== 'string' && item.namespace === namespace && item.local === local;
}

function directChildren(element: XmlElement, namespace: string, local: string): XmlElement[] {
  return element.children.filter((child): child is XmlElement => isElement(child, namespace, local));
}

function descendants(element: XmlElement, predicate: (item: XmlElement) => boolean): XmlElement[] {
  const found: XmlElement[] = [];
  function visit(current: XmlElement): void {
    if (predicate(current)) found.push(current);
    for (const child of current.children) if (typeof child !== 'string') visit(child);
  }
  visit(element);
  return found;
}

function textOf(element: XmlElement): string {
  return element.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

function repeatCount(element: XmlElement, local: string): number {
  const raw = attribute(element, local, NS.table);
  if (!raw) return 1;
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_REPEAT) {
    throw new Error(`Spreadsheet repeat count must be between 1 and ${MAX_REPEAT}.`);
  }
  return count;
}

function paragraphText(element: XmlElement): string {
  function inline(current: XmlElement): string {
    if (current.namespace === NS.text && current.local === 's') {
      const raw = attribute(current, 'c', NS.text);
      const count = raw ? Number(raw) : 1;
      if (!Number.isSafeInteger(count) || count < 1 || count > MAX_REPEAT)
        throw new Error('Text space count is outside the supported range.');
      return ' '.repeat(count);
    }
    if (current.namespace === NS.text && current.local === 'tab') return '\t';
    if (current.namespace === NS.text && current.local === 'line-break') return '\n';
    if (current.namespace === NS.text && ['tracked-changes', 'change-marks'].includes(current.local)) return '';
    return current.children.map((child) => (typeof child === 'string' ? child : inline(child))).join('');
  }
  return inline(element);
}

function odfParagraphs(content: XmlElement, budget: TextBudget): string[] {
  const paragraphs = descendants(content, (item) => item.namespace === NS.text && (item.local === 'p' || item.local === 'h'));
  const output: string[] = [];
  for (const paragraph of paragraphs) {
    const text = paragraphText(paragraph);
    if (text.trim().length === 0) continue;
    budget.consume(text);
    output.push(text);
  }
  return output;
}

function odfMathText(content: XmlElement, budget: TextBudget): string[] {
  const annotations = descendants(content, (item) => item.namespace === NS.math && item.local === 'annotation');
  let text: string;
  if (annotations.length > 0) {
    text = annotations
      .map(textOf)
      .filter((item) => item.trim().length > 0)
      .join('\n');
  } else {
    const tokens = descendants(content, (item) => item.namespace === NS.math && ['mi', 'mn', 'mo', 'mtext'].includes(item.local));
    text = tokens
      .map(textOf)
      .filter((item) => item.length > 0)
      .join(' ');
  }
  if (!text.trim()) {
    text = descendants(content, (item) => item.namespace === NS.text && (item.local === 'p' || item.local === 'h'))
      .map(paragraphText)
      .filter((item) => item.trim().length > 0)
      .join('\n');
  }
  if (!text.trim()) return [];
  budget.consume(text);
  return [text];
}

function odfCellValue(cell: XmlElement): string | number | boolean | null {
  const valueType = attribute(cell, 'value-type', NS.office);
  const numeric = attribute(cell, 'value', NS.office);
  if (valueType === 'float' || valueType === 'currency' || valueType === 'percentage') {
    if (numeric !== undefined && Number.isFinite(Number(numeric))) return Number(numeric);
  }
  if (valueType === 'boolean') {
    const value = attribute(cell, 'boolean-value', NS.office);
    if (value !== undefined) return value.toLowerCase() === 'true' || value === '1';
  }
  if (valueType === 'date') return attribute(cell, 'date-value', NS.office) ?? textOf(cell);
  if (valueType === 'time') return attribute(cell, 'time-value', NS.office) ?? textOf(cell);
  const paragraphs = descendants(cell, (item) => item.namespace === NS.text && (item.local === 'p' || item.local === 'h'));
  const paragraphValue = paragraphs.map(paragraphText).join('\n');
  if (paragraphValue !== '') return paragraphValue;
  const stringValue = attribute(cell, 'string-value', NS.office);
  if (stringValue !== undefined) return stringValue;
  if (numeric !== undefined) return Number.isFinite(Number(numeric)) ? Number(numeric) : numeric;
  if (valueType === 'string') return '';
  return null;
}

interface SpreadsheetSheet {
  name: string;
  rows: Array<Array<string | number | boolean | null>>;
}

function spreadsheetSheets(content: XmlElement, budget: TextBudget): SpreadsheetSheet[] {
  const tables = descendants(content, (item) => item.namespace === NS.table && item.local === 'table');
  const sheets: SpreadsheetSheet[] = [];
  let workbookRows = 0;
  let workbookCells = 0;
  for (const table of tables) {
    const rowsXml: XmlElement[] = [];
    function collectRows(parent: XmlElement): void {
      for (const child of parent.children) {
        if (typeof child === 'string' || child.namespace !== NS.table) continue;
        if (child.local === 'table-row') rowsXml.push(child);
        else if (['table-header-rows', 'table-row-group', 'table-rows'].includes(child.local)) collectRows(child);
      }
    }
    collectRows(table);

    const rows: Array<Array<string | number | boolean | null>> = [];
    let cellCount = 0;
    let width = 0;
    for (const rowXml of rowsXml) {
      const rowRepeat = repeatCount(rowXml, 'number-rows-repeated');
      const cellsXml = rowXml.children.filter(
        (child): child is XmlElement =>
          typeof child !== 'string' &&
          child.namespace === NS.table &&
          (child.local === 'table-cell' || child.local === 'covered-table-cell'),
      );
      const values: Array<string | number | boolean | null> = [];
      for (const cell of cellsXml) {
        const columnRepeat = repeatCount(cell, 'number-columns-repeated');
        const value = cell.local === 'covered-table-cell' ? null : odfCellValue(cell);
        if (typeof value === 'string') {
          if (value.length > MAX_CELL_TEXT) throw new Error('Spreadsheet cell text exceeds the 64 KB cell limit.');
          budget.consume(value, rowRepeat * columnRepeat);
        }
        const expandedCells = values.length + columnRepeat;
        if (expandedCells > MAX_CELLS || workbookCells + cellCount + expandedCells * rowRepeat > MAX_CELLS) {
          throw new Error('Spreadsheet exceeds the 100,000 cell extraction limit.');
        }
        for (let i = 0; i < columnRepeat; i++) values.push(value);
      }
      if (workbookRows + rowRepeat > MAX_ROWS) throw new Error('Spreadsheet exceeds the 10,000 row extraction limit.');
      workbookRows += rowRepeat;
      cellCount += values.length * rowRepeat;
      width = Math.max(width, values.length);
      for (let i = 0; i < rowRepeat; i++) rows.push([...values]);
    }
    const padding = rows.reduce((sum, row) => sum + width - row.length, 0);
    if (workbookCells + cellCount + padding > MAX_CELLS) throw new Error('Spreadsheet exceeds the 100,000 cell extraction limit.');
    workbookCells += cellCount + padding;
    for (const row of rows) while (row.length < width) row.push(null);
    sheets.push({ name: attribute(table, 'name', NS.table) || `Sheet ${sheets.length + 1}`, rows });
  }
  return sheets;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function makeHtml(title: string, blocks: string[]): string {
  const body = blocks.map((block) => `<p>${escapeHtml(block)}</p>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;white-space:pre-wrap}table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid #888;padding:.3em .5em;vertical-align:top}caption{text-align:left;font-weight:bold;margin:.4em 0}</style></head><body>${body}</body></html>`;
}

function spreadsheetHtml(title: string, sheets: SpreadsheetSheet[]): string {
  const tables = sheets
    .map((sheet) => {
      const rows = sheet.rows
        .map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value === null ? '' : String(value))}</td>`).join('')}</tr>`)
        .join('\n');
      return `<table><caption>${escapeHtml(sheet.name)}</caption><tbody>${rows}</tbody></table>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;white-space:pre-wrap}table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid #888;padding:.3em .5em;vertical-align:top}caption{text-align:left;font-weight:bold;margin:.4em 0}</style></head><body>${tables}</body></html>`;
}

function spreadsheetJson(sheets: SpreadsheetSheet[]): string {
  return JSON.stringify({ sheets }, null, 2);
}

function delimitedRows(rows: Array<Array<string | number | boolean | null>>, delimiter: ',' | '\t'): string {
  return rows.map((row) => row.map((cell) => `"${(cell === null ? '' : String(cell)).replace(/"/g, '""')}"`).join(delimiter)).join('\r\n');
}

function spreadsheetText(sheets: SpreadsheetSheet[]): string {
  return sheets
    .map(
      (sheet) =>
        `${sheet.name}\n${sheet.rows.map((row) => row.map((value) => (value === null ? '' : String(value))).join('\t')).join('\n')}`,
    )
    .join('\n\n');
}

async function htmlPdf(html: string): Promise<Blob> {
  const [{ htmlToPdf }, { DEFAULT_PAGE_SETUP }] = await Promise.all([
    import('../pdf/html-to-pdf/convert'),
    import('../pdf/_render/render'),
  ]);
  const result = await htmlToPdf(html, DEFAULT_PAGE_SETUP, () => undefined);
  return result.blob;
}

interface ArchiveInfo {
  entries: number;
  declaredUncompressed: number;
}

function inspectZip(buffer: ArrayBuffer): ArchiveInfo {
  if (buffer.byteLength > MAX_PACKAGE_BYTES) throw new Error('Office package exceeds the 32 MB archive limit.');
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const minimumEocd = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minimumEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid or unsupported ZIP package.');
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const entries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (disk || centralDisk || diskEntries !== entries) throw new Error('Multi-disk ZIP packages are not supported.');
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff)
    throw new Error('ZIP64 office packages are not supported.');
  if (entries > MAX_ARCHIVE_ENTRIES) throw new Error(`Office package contains more than ${MAX_ARCHIVE_ENTRIES} entries.`);
  if (centralOffset + centralSize > eocd || centralOffset + centralSize > bytes.length) throw new Error('Corrupt ZIP central directory.');

  let cursor = centralOffset;
  let declaredUncompressed = 0;
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
    const flags = view.getUint16(cursor + 8, true);
    const uncompressed = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    if (flags & 1) throw new Error('Encrypted office packages are not supported.');
    if (uncompressed === 0xffffffff) throw new Error('ZIP64 office packages are not supported.');
    declaredUncompressed += uncompressed;
    if (declaredUncompressed > MAX_PACKAGE_BYTES) throw new Error('Office package declares more than 32 MB of uncompressed data.');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (cursor > centralOffset + centralSize) throw new Error('Corrupt ZIP central directory.');
  }
  if (cursor > centralOffset + centralSize) throw new Error('Corrupt ZIP central directory.');
  return { entries, declaredUncompressed };
}

interface OfficeArchive {
  zip: OfficeZipArchive;
  readText(path: string): Promise<string>;
}

interface OfficeZipEntry {
  async(type: 'uint8array'): Promise<Uint8Array>;
}

interface OfficeZipArchive {
  files: Record<string, unknown>;
  file(path: string): OfficeZipEntry | null;
}

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < CRC32_TABLE.length; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  CRC32_TABLE[i] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const byte of bytes) checksum = (checksum >>> 8) ^ CRC32_TABLE[(checksum ^ byte) & 0xff];
  return (checksum ^ 0xffffffff) >>> 0;
}

async function loadOfficeArchive(file: File): Promise<OfficeArchive> {
  if (file.size > MAX_PACKAGE_BYTES) throw new Error('Office package exceeds the 32 MB archive limit.');
  const buffer = await file.arrayBuffer();
  inspectZip(buffer);
  const { default: JSZip } = await import('jszip');
  let zip: OfficeZipArchive;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw new Error(`Could not read office package: ${error instanceof Error ? error.message : String(error)}.`, { cause: error });
  }
  const cache = new Map<string, string>();
  let decompressedBytes = 0;
  return {
    zip,
    async readText(path: string): Promise<string> {
      if (cache.has(path)) return cache.get(path)!;
      const entry = zip.file(path);
      if (!entry) throw new Error(`Office package is missing ${path}.`);
      let bytes: Uint8Array;
      try {
        bytes = await readZipEntry(entry, MAX_PACKAGE_BYTES, `Office package entry ${path} exceeds the 32 MB uncompressed limit.`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('32 MB uncompressed limit')) throw error;
        throw new Error(`Could not decompress office package entry ${path}: ${error instanceof Error ? error.message : String(error)}.`, {
          cause: error,
        });
      }
      decompressedBytes += bytes.byteLength;
      if (bytes.byteLength > MAX_PACKAGE_BYTES || decompressedBytes > MAX_PACKAGE_BYTES) {
        throw new Error('Office package exceeds the 32 MB uncompressed extraction limit.');
      }
      const expectedCrc = (entry as { _data?: { crc32?: number } })._data?.crc32;
      if (expectedCrc !== undefined && crc32(bytes) !== expectedCrc >>> 0) {
        throw new Error(`Corrupt office package entry ${path}: checksum mismatch.`);
      }
      let value: string;
      try {
        value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new Error(`Office package entry ${path} is not valid UTF-8 XML.`);
      }
      cache.set(path, value);
      return value;
    },
  };
}

type OdfFamily = 'writer' | 'spreadsheet' | 'presentation' | 'drawing' | 'formula';
const ODF_INPUTS: Record<string, OdfFamily> = {
  odt: 'writer',
  ott: 'writer',
  odm: 'writer',
  fodt: 'writer',
  ods: 'spreadsheet',
  ots: 'spreadsheet',
  fods: 'spreadsheet',
  odp: 'presentation',
  otp: 'presentation',
  fodp: 'presentation',
  odg: 'drawing',
  otg: 'drawing',
  fodg: 'drawing',
  odf: 'formula',
};
const FLAT_ODF = new Set(['fodt', 'fods', 'fodp', 'fodg']);

async function odfDocument(file: File, inputId: string): Promise<{ family: OdfFamily; content: XmlElement }> {
  const family = ODF_INPUTS[inputId];
  if (!family) throw new Error(`Unsupported OpenDocument input format: ${inputId}.`);
  let root: XmlElement;
  if (FLAT_ODF.has(inputId)) {
    if (file.size > MAX_PACKAGE_BYTES) throw new Error('Flat OpenDocument XML exceeds the 32 MB limit.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let xml: string;
    try {
      xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('Flat OpenDocument input is not valid UTF-8 XML.');
    }
    root = parseXml(xml, 'flat OpenDocument file');
  } else {
    const archive = await loadOfficeArchive(file);
    const manifest = archive.zip.file('META-INF/manifest.xml');
    if (manifest) {
      const manifestXml = await archive.readText('META-INF/manifest.xml');
      const manifestRoot = parseXml(manifestXml, 'OpenDocument manifest');
      const encrypted = descendants(manifestRoot, (item) => item.local === 'encryption-data');
      if (encrypted.length > 0) throw new Error('Encrypted OpenDocument content is not supported.');
    }
    root = parseXml(await archive.readText('content.xml'), 'OpenDocument content.xml');
  }

  if (root.namespace !== NS.office || !root.local.startsWith('document')) throw new Error('Input is not an OpenDocument XML document.');
  const body = directChildren(root, NS.office, 'body')[0];
  if (!body) throw new Error('OpenDocument content is missing office:body.');
  const contentName: Record<OdfFamily, string> = {
    writer: 'text',
    spreadsheet: 'spreadsheet',
    presentation: 'presentation',
    drawing: 'drawing',
    formula: 'formula',
  };
  const content = directChildren(body, NS.office, contentName[family])[0];
  if (!content) throw new Error(`OpenDocument body does not contain ${family} content.`);
  return { family, content };
}

function csvMime(targetId: string): string {
  return targetId === 'tsv' ? 'text/tab-separated-values' : 'text/csv';
}

async function convertOdf(file: File, inputId: string, targetId: string): Promise<Blob> {
  const { family, content } = await odfDocument(file, inputId);
  const budget = new TextBudget();
  if (family === 'spreadsheet') {
    const sheets = spreadsheetSheets(content, budget);
    if (targetId === 'json') return new Blob([spreadsheetJson(sheets)], { type: 'application/json' });
    if (targetId === 'csv' || targetId === 'tsv')
      return new Blob([delimitedRows(sheets[0]?.rows || [], targetId === 'tsv' ? '\t' : ',')], { type: csvMime(targetId) });
    if (targetId === 'txt') return new Blob([spreadsheetText(sheets)], { type: 'text/plain' });
    if (targetId === 'html') return new Blob([spreadsheetHtml(file.name, sheets)], { type: 'text/html' });
    if (targetId === 'pdf') return htmlPdf(spreadsheetHtml(file.name, sheets));
  } else {
    const paragraphs = family === 'formula' ? odfMathText(content, budget) : odfParagraphs(content, budget);
    const text = paragraphs.join('\n\n');
    if (targetId === 'txt') return new Blob([text], { type: 'text/plain' });
    if (targetId === 'html') return new Blob([makeHtml(file.name, paragraphs)], { type: 'text/html' });
    if (targetId === 'pdf') return htmlPdf(makeHtml(file.name, paragraphs));
  }
  throw new Error(`OpenDocument ${family} cannot be exported to ${targetId}.`);
}

function normalizeArchivePath(path: string, basePath: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path.split(/[?#]/, 1)[0]);
  } catch {
    throw new Error('EPUB contains a malformed resource path.');
  }
  if (!decoded || decoded.startsWith('/') || decoded.startsWith('\\') || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith('//')) {
    throw new Error('EPUB remote and absolute resources are not supported.');
  }
  const parts = basePath.split('/').filter(Boolean);
  for (const component of decoded.replace(/\\/g, '/').split('/')) {
    if (!component || component === '.') continue;
    if (component === '..') {
      if (parts.length === 0) throw new Error('EPUB resource path escapes the package.');
      parts.pop();
    } else {
      parts.push(component);
    }
  }
  return parts.join('/');
}

function xmlElementText(element: XmlElement, budget: TextBudget, skipped: Set<string>, blockNames: Set<string>): string {
  function visit(current: XmlElement): string {
    const name = current.local.toLowerCase();
    if (skipped.has(name) || (current.namespace === NS.math && name === 'math') || name === 'svg') return '';
    if (current.namespace === NS.xhtml && name === 'br') return '\n';
    const block = blockNames.has(name);
    const content = current.children.map((child) => (typeof child === 'string' ? child : visit(child))).join('');
    return block ? `\n${content}\n` : content;
  }
  const result = visit(element)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  budget.consume(result);
  return result;
}

function epubText(root: XmlElement, budget: TextBudget): string {
  const skipped = new Set([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'video',
    'audio',
    'source',
    'link',
    'meta',
    'base',
    'canvas',
    'noscript',
  ]);
  const blocks = new Set([
    'address',
    'article',
    'aside',
    'blockquote',
    'body',
    'caption',
    'dd',
    'div',
    'dl',
    'dt',
    'figcaption',
    'figure',
    'footer',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'li',
    'main',
    'ol',
    'p',
    'section',
    'table',
    'tr',
    'ul',
  ]);
  const body = descendants(root, (item) => item.local.toLowerCase() === 'body')[0] || root;
  return xmlElementText(body, budget, skipped, blocks);
}

async function epubChapters(archive: OfficeArchive, budget: TextBudget): Promise<string[]> {
  const container = parseXml(await archive.readText('META-INF/container.xml'), 'EPUB container.xml');
  const rootfile = descendants(container, (item) => item.local === 'rootfile' && item.namespace === NS.container)[0];
  const rawOpfPath = rootfile && attribute(rootfile, 'full-path');
  if (!rawOpfPath) throw new Error('EPUB container.xml does not identify a package document.');
  const opfPath = normalizeArchivePath(rawOpfPath, '');
  const packageRoot = parseXml(await archive.readText(opfPath), 'EPUB package document');
  const manifestItems = descendants(packageRoot, (item) => item.local === 'item' && item.namespace === NS.opf);
  const itemById = new Map<string, { href: string; mediaType: string }>();
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  for (const item of manifestItems) {
    const id = attribute(item, 'id');
    const href = attribute(item, 'href');
    const mediaType = attribute(item, 'media-type') || '';
    if (id && href) itemById.set(id, { href, mediaType });
  }

  const itemRefs = descendants(packageRoot, (item) => item.local === 'itemref' && item.namespace === NS.opf);
  const chapters: string[] = [];
  for (const itemRef of itemRefs) {
    const idref = attribute(itemRef, 'idref');
    const item = idref ? itemById.get(idref) : undefined;
    if (!item || !['application/xhtml+xml', 'text/html', 'application/x-dtbook+xml'].includes(item.mediaType)) continue;
    const path = normalizeArchivePath(item.href, base);
    const root = parseXml(await archive.readText(path), `EPUB spine resource ${path}`);
    const text = epubText(root, budget);
    if (text) chapters.push(text);
  }
  return chapters;
}

async function rejectEpubDrm(archive: OfficeArchive): Promise<void> {
  if (!archive.zip.file('META-INF/encryption.xml')) return;
  const encryption = parseXml(await archive.readText('META-INF/encryption.xml'), 'EPUB encryption.xml');
  const methods = descendants(encryption, (item) => item.local === 'EncryptionMethod');
  const allowedFontObfuscation = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);
  if (methods.length === 0 || methods.some((item) => !allowedFontObfuscation.has(attribute(item, 'Algorithm') || ''))) {
    throw new Error('DRM-encrypted EPUB content is not supported.');
  }
}

async function convertEpub(file: File, targetId: string): Promise<Blob> {
  const archive = await loadOfficeArchive(file);
  await rejectEpubDrm(archive);
  const chapters = await epubChapters(archive, new TextBudget());
  const text = chapters.join('\n\n');
  if (targetId === 'txt') return new Blob([text], { type: 'text/plain' });
  const html = makeHtml(file.name, chapters);
  if (targetId === 'html') return new Blob([html], { type: 'text/html' });
  if (targetId === 'pdf') return htmlPdf(html);
  throw new Error(`EPUB cannot be exported to ${targetId}.`);
}

function numericPageOrder(path: string): number {
  const match = path.match(/(?:^|\/)page(\d+)\.xml$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function convertVsdx(file: File, targetId: string): Promise<Blob> {
  const archive = await loadOfficeArchive(file);
  const pagePaths = Object.keys(archive.zip.files)
    .filter((path) => /^visio\/pages\/page\d+\.xml$/i.test(path))
    .sort((left, right) => numericPageOrder(left) - numericPageOrder(right) || left.localeCompare(right));
  if (pagePaths.length === 0) throw new Error('VSDX package does not contain Visio pages.');
  if (pagePaths.length > 1_000) throw new Error('VSDX package contains more than 1,000 pages.');
  const budget = new TextBudget();
  const labels: string[] = [];
  for (const path of pagePaths) {
    const root = parseXml(await archive.readText(path), `Visio page ${path}`);
    for (const textElement of descendants(root, (item) => item.local === 'Text')) {
      const label = textOf(textElement).trim();
      if (!label) continue;
      budget.consume(label);
      labels.push(label);
    }
  }
  const text = labels.join('\n');
  if (targetId === 'txt') return new Blob([text], { type: 'text/plain' });
  const html = makeHtml(file.name, labels);
  if (targetId === 'html') return new Blob([html], { type: 'text/html' });
  if (targetId === 'pdf') return htmlPdf(html);
  throw new Error(`VSDX cannot be exported to ${targetId}.`);
}

/** Extracts content from supported OpenDocument, EPUB, and Visio packages in the browser. */
export async function convertOfficeDocument(file: File, inputId: string, targetId: string): Promise<Blob> {
  const normalizedInput = inputId.toLowerCase().replace(/^\./, '');
  const normalizedTarget = targetId.toLowerCase().replace(/^\./, '');
  if (ODF_INPUTS[normalizedInput]) return convertOdf(file, normalizedInput, normalizedTarget);
  if (normalizedInput === 'epub') return convertEpub(file, normalizedTarget);
  if (normalizedInput === 'vsdx') return convertVsdx(file, normalizedTarget);
  const format = OFFICE_FORMATS[normalizedInput];
  if (format?.limitation) throw new Error(format.limitation);
  throw new Error(`Office conversion from ${normalizedInput} to ${normalizedTarget} is not supported.`);
}
