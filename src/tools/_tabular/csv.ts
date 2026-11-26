export interface CsvParseOptions {
  delimiter?: string;
  hasHeader?: boolean;
  trimFields?: boolean;
  maxRows?: number;
}

export interface CsvToRecordsOptions {
  hasHeader?: boolean;
  preserveLeadingZeros?: boolean;
  parseNumbersAndBooleans?: boolean;
}

export interface JsonToCsvOptions {
  delimiter?: string;
  hasHeader?: boolean;
}

const COMMON_DELIMITERS = [',', '\t', ';', '|'] as const;

/**
 * Automatically detects the most likely delimiter from sample text.
 * Analyzes non-empty lines outside quotes.
 */
export function detectDelimiter(text: string, candidates: readonly string[] = COMMON_DELIMITERS): string {
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  if (!text) return ',';

  let bestDelimiter = ',';
  let bestScore = -1;

  for (const delim of candidates) {
    const rows = parseCsv(text, { delimiter: delim, maxRows: 20 });
    const counts = rows.filter((row) => row.length > 1 || row[0].trim()).map((row) => row.length - 1);

    // All sample lines should ideally have the same non-zero count of delimiters
    const nonZeroCounts = counts.filter((c) => c > 0);
    if (nonZeroCounts.length === 0) continue;

    const first = nonZeroCounts[0];
    const consistent = nonZeroCounts.every((c) => c === first);
    const fractionWithDelim = nonZeroCounts.length / counts.length;

    // Score based on consistency and frequency
    const score = (consistent ? 1000 : 0) + fractionWithDelim * 100 + first;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delim;
    }
  }

  return bestDelimiter;
}

/**
 * Robust RFC-4180 compliant CSV parser.
 * Supports arbitrary delimiters, quoted fields, embedded newlines, and escaped quotes.
 */
export function parseCsv(text: string, options: CsvParseOptions = {}): string[][] {
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  if (text.length === 0) {
    return [];
  }

  const delimiter = options.delimiter && options.delimiter.length > 0 ? options.delimiter[0] : ',';
  const trimFields = options.trimFields ?? false;
  const maxRows = options.maxRows ?? Infinity;

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let fieldQuoted = false;
  let rowStarted = false;
  let i = 0;
  const len = text.length;

  while (i < len && rows.length < maxRows) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // Look ahead for escaped quote ""
        if (i + 1 < len && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        // Inside quotes: accumulate everything, including newlines and delimiters
        currentField += char;
        i++;
        continue;
      }
    }

    // Outside quotes
    if (char === '"' && !fieldQuoted && (currentField === '' || (trimFields && currentField.trim() === ''))) {
      currentField = '';
      inQuotes = true;
      fieldQuoted = true;
      rowStarted = true;
      i++;
      continue;
    }

    if (char === delimiter) {
      currentRow.push(trimFields && !fieldQuoted ? currentField.trim() : currentField);
      currentField = '';
      fieldQuoted = false;
      rowStarted = true;
      i++;
      continue;
    }

    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      currentRow.push(trimFields && !fieldQuoted ? currentField.trim() : currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      fieldQuoted = false;
      rowStarted = false;
      i++;
      continue;
    }

    currentField += char;
    rowStarted = true;
    i++;
  }

  // Push last field and row if there's remaining content or an open row
  if (rowStarted || currentRow.length > 0 || currentField.length > 0 || fieldQuoted) {
    currentRow.push(trimFields && !fieldQuoted ? currentField.trim() : currentField);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Validates header list.
 * Throws explicit descriptive error if headers are duplicate or malformed.
 */
export function validateHeaders(headers: string[]): void {
  if (headers.length === 0) {
    throw new Error('CSV has no header row.');
  }

  const seen = new Map<string, number>();

  for (let idx = 0; idx < headers.length; idx++) {
    const rawHeader = headers[idx];
    const trimmed = rawHeader.trim();

    if (trimmed.length === 0) {
      throw new Error(`Malformed header: column ${idx + 1} is empty. All header columns must have names.`);
    }

    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) {
      const priorIdx = seen.get(lower)! + 1;
      throw new Error(
        `Duplicate header column detected: "${trimmed}" at column ${idx + 1} duplicates column ${priorIdx}. All header column names must be unique to prevent data loss.`,
      );
    }
    seen.set(lower, idx);
  }
}

/**
 * Converts parsed CSV rows into JSON records (array of objects).
 * Strictly preserves string cells and leading zeros, and rejects duplicate headers.
 */
export function csvToRecords(rows: string[][], options: CsvToRecordsOptions = {}): Record<string, unknown>[] {
  if (rows.length === 0) return [];

  const hasHeader = options.hasHeader ?? true;
  const preserveLeadingZeros = options.preserveLeadingZeros ?? true;
  const parseNumbersAndBooleans = options.parseNumbersAndBooleans ?? false;

  let headers: string[];
  let dataRows: string[][];

  if (hasHeader) {
    headers = rows[0];
    validateHeaders(headers);
    dataRows = rows.slice(1);
  } else {
    const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
    headers = Array.from({ length: maxCols }, (_, i) => `column_${i + 1}`);
    dataRows = rows;
  }

  return dataRows.map((row, index) => {
    if (row.length > headers.length) {
      throw new Error(`CSV data row ${index + 1} has more fields than the header row.`);
    }
    const record: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      const colName = headers[c];
      const cellVal = c < row.length ? row[c] : '';

      let value: unknown;
      if (cellVal === '') {
        value = '';
      } else if (!parseNumbersAndBooleans) {
        // Keep string verbatim
        value = cellVal;
      } else {
        // If user enabled parseNumbersAndBooleans:
        // Check for leading zero: e.g. "0123", "007", "00"
        const hasLeadingZero = preserveLeadingZeros && /^[+-]?0\d/.test(cellVal.trim());

        if (hasLeadingZero) {
          // Always preserve strings with leading zeros (postal codes, phone numbers, IDs)
          value = cellVal;
        } else if (cellVal.toLowerCase() === 'true') {
          value = true;
        } else if (cellVal.toLowerCase() === 'false') {
          value = false;
        } else if (cellVal.toLowerCase() === 'null') {
          value = null;
        } else {
          const num = Number(cellVal);
          if (Number.isFinite(num) && (!Number.isInteger(num) || Number.isSafeInteger(num)) && cellVal.trim() !== '') {
            value = num;
          } else {
            value = cellVal;
          }
        }
      }

      Object.defineProperty(record, colName, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return record;
  });
}

/**
 * Escapes a single cell value for CSV output according to RFC 4180.
 */
export function escapeCsvField(value: unknown, delimiter = ','): string {
  if (value === undefined || value === null) {
    return '';
  }

  let str: string;
  if (typeof value === 'object') {
    // Nested values JSON-stringified with clear policy
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }

  const needsQuotes =
    str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r') || str.startsWith(' ') || str.endsWith(' ');

  if (needsQuotes) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serializes rows of values into a CSV string.
 */
export function serializeCsv(rows: unknown[][], delimiter = ','): string {
  return rows
    .map((row) => {
      const line = row.map((cell) => escapeCsvField(cell, delimiter)).join(delimiter);
      return row.length === 1 && line === '' ? '""' : line;
    })
    .join('\r\n');
}

/**
 * Converts JSON data (array of objects, array of arrays, or single object) into a CSV string.
 * Uses stable union headers for array of objects.
 */
export function jsonToCsv(json: unknown, options: JsonToCsvOptions = {}): string {
  const delimiter = options.delimiter && options.delimiter.length > 0 ? options.delimiter[0] : ',';

  if (json === null || json === undefined) {
    return '';
  }

  let items: unknown[];
  if (Array.isArray(json)) {
    items = json;
  } else if (typeof json === 'object') {
    items = [json];
  } else {
    // primitive value
    return serializeCsv([[json]], delimiter);
  }

  if (items.length === 0) return '';

  // Case 1: Array of Arrays
  if (items.every(Array.isArray)) {
    return serializeCsv(items, delimiter);
  }

  // Case 2: Array of Objects
  if (items.every((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))) {
    // Stable union headers: maintain first-seen order across all objects
    const headerSet = new Set<string>();
    for (const obj of items) {
      for (const key of Object.keys(obj)) {
        headerSet.add(key);
      }
    }

    const headers = Array.from(headerSet);
    const rows: unknown[][] = [];

    // Header row
    if (options.hasHeader ?? true) rows.push(headers);

    // Data rows
    for (const obj of items) {
      const row: unknown[] = [];
      for (const h of headers) {
        const val = Object.hasOwn(obj, h) ? obj[h] : '';
        row.push(val);
      }
      rows.push(row);
    }

    return serializeCsv(rows, delimiter);
  }

  // Case 3: Primitive or mixed array, with one cell per item
  const rows = items.map((item) => [item]);
  return serializeCsv(rows, delimiter);
}
