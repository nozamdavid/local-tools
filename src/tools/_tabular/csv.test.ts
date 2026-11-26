import { expect, it } from 'vitest';
import { csvToRecords, detectDelimiter, parseCsv, serializeCsv } from './csv';

it('detects tabs and preserves empty columns in whitespace-only input', () => {
  const text = '\t\r\n \t\r\n\t';
  expect(detectDelimiter(text)).toBe('\t');
  expect(serializeCsv(parseCsv(text, { delimiter: '\t' }))).toBe(',\r\n" ",\r\n,');
});

it('preserves blank rows and embedded line endings when normalizing record separators', () => {
  const rows = parseCsv('"a\r\nb",c\r\n\rd,e\nf,g\r');
  expect(rows).toEqual([['a\r\nb', 'c'], [''], ['d', 'e'], ['f', 'g']]);
  expect(serializeCsv(rows)).toBe('"a\r\nb",c\r\n""\r\nd,e\r\nf,g');
});

it('preserves significant header spaces and signed or padded zero-prefixed IDs in JSON', () => {
  const rows = parseCsv('" ID ",count\r\n" 007 ",4\r\n-008,5');
  const records = csvToRecords(rows, { parseNumbersAndBooleans: true });
  expect(JSON.stringify(records)).toBe('[{" ID ":" 007 ","count":4},{" ID ":"-008","count":5}]');
});
