import { parseCsv, serializeCsv, csvToRecords, jsonToCsv, validateHeaders, detectDelimiter } from './csv';

export async function runVerification(): Promise<void> {
  console.log('--- Starting _tabular Verification ---');

  // 1. Quoted Multiline CSV Roundtrip
  const originalRows = [
    ['Header1', 'Header2', 'Header3', 'Header4'],
    ['Simple text', 'Line 1\nLine 2\r\nLine 3', 'He said "Hello, world!"', 'Tab\there;delim'],
    ['Leading zero "0123"', 'Multiple ""quotes"" inside', 'End\nof\nfile', 'Done'],
  ];

  const serialized = serializeCsv(originalRows);
  const parsed = parseCsv(serialized);

  if (parsed.length !== originalRows.length) {
    throw new Error(`Roundtrip row count mismatch: expected ${originalRows.length}, got ${parsed.length}`);
  }

  for (let r = 0; r < originalRows.length; r++) {
    if (parsed[r].length !== originalRows[r].length) {
      throw new Error(`Row ${r} length mismatch: expected ${originalRows[r].length}, got ${parsed[r].length}`);
    }
    for (let c = 0; c < originalRows[r].length; c++) {
      if (parsed[r][c] !== originalRows[r][c]) {
        throw new Error(
          `Cell [${r}, ${c}] mismatch:\nExpected: ${JSON.stringify(originalRows[r][c])}\nGot:      ${JSON.stringify(parsed[r][c])}`,
        );
      }
    }
  }
  console.log('✓ Quoted multiline CSV roundtrip passed.');

  // 2. Duplicate Header Rejection
  const duplicateHeaderCsv = 'name,age,email,name\nAlice,30,alice@example.com,Alice2';
  const duplicateRows = parseCsv(duplicateHeaderCsv);
  let duplicateRejected = false;
  try {
    csvToRecords(duplicateRows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Duplicate header column detected: "name"')) {
      duplicateRejected = true;
    } else {
      throw new Error(`Unexpected error message for duplicate headers: ${msg}`, { cause: err });
    }
  }
  if (!duplicateRejected) {
    throw new Error('Duplicate headers were not rejected!');
  }
  console.log('✓ Duplicate header rejection verified.');

  // 3. Malformed (Empty) Header Rejection
  const emptyHeaderCsv = 'col1,,col3\n1,2,3';
  const emptyHeaderRows = parseCsv(emptyHeaderCsv);
  let emptyRejected = false;
  try {
    validateHeaders(emptyHeaderRows[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Malformed header: column 2 is empty')) {
      emptyRejected = true;
    } else {
      throw new Error(`Unexpected error message for empty header: ${msg}`, { cause: err });
    }
  }
  if (!emptyRejected) {
    throw new Error('Empty header was not rejected!');
  }
  console.log('✓ Malformed empty header rejection verified.');

  // 4. Leading Zeros and String Preservation on CSV -> JSON
  const zerosCsv = 'id,zipcode,quantity,active\n00123,02138,42,true';
  const records = csvToRecords(parseCsv(zerosCsv), {
    hasHeader: true,
    preserveLeadingZeros: true,
    parseNumbersAndBooleans: true,
  });

  if (records.length !== 1) {
    throw new Error(`Expected 1 record, got ${records.length}`);
  }
  const rec = records[0];
  if (rec.id !== '00123') {
    throw new Error(`Leading zero corrupted on id: expected "00123", got ${JSON.stringify(rec.id)}`);
  }
  if (rec.zipcode !== '02138') {
    throw new Error(`Leading zero corrupted on zipcode: expected "02138", got ${JSON.stringify(rec.zipcode)}`);
  }
  if (rec.quantity !== 42) {
    throw new Error(`Numeric value not parsed: expected 42, got ${JSON.stringify(rec.quantity)}`);
  }
  if (rec.active !== true) {
    throw new Error(`Boolean value not parsed: expected true, got ${JSON.stringify(rec.active)}`);
  }
  console.log('✓ Leading zeros and string preservation verified.');

  // 5. Safe Object Property Creation: __proto__, constructor, prototype in untyped and typed mode
  const specialHeadersCsv = '__proto__,constructor,prototype\ncustomProto,customCtor,customProtoVal';
  const untypedRecords = csvToRecords(parseCsv(specialHeadersCsv), {
    hasHeader: true,
    parseNumbersAndBooleans: false,
  });
  if (untypedRecords.length !== 1) {
    throw new Error(`Expected 1 untyped record, got ${untypedRecords.length}`);
  }
  const uRec = untypedRecords[0];
  if (!Object.prototype.hasOwnProperty.call(uRec, '__proto__') || uRec['__proto__'] !== 'customProto') {
    throw new Error('__proto__ was not created as an enumerable own property in untyped mode');
  }
  if (!Object.prototype.hasOwnProperty.call(uRec, 'constructor') || uRec['constructor'] !== 'customCtor') {
    throw new Error('constructor was not preserved as an own property in untyped mode');
  }
  if (!Object.prototype.hasOwnProperty.call(uRec, 'prototype') || uRec['prototype'] !== 'customProtoVal') {
    throw new Error('prototype was not preserved as an own property in untyped mode');
  }
  const uSerialized = JSON.stringify(uRec);
  if (!uSerialized.includes('"__proto__":"customProto"')) {
    throw new Error(`JSON.stringify did not preserve __proto__ own property: ${uSerialized}`);
  }

  // Typed mode with null __proto__ must not alter object prototype
  const typedSpecialCsv = '__proto__,val\nnull,123';
  const typedRecords = csvToRecords(parseCsv(typedSpecialCsv), {
    hasHeader: true,
    parseNumbersAndBooleans: true,
  });
  const tRec = typedRecords[0];
  if (Object.getPrototypeOf(tRec) !== Object.prototype) {
    throw new Error('Object prototype was corrupted by typed null on __proto__ column!');
  }
  if (!Object.prototype.hasOwnProperty.call(tRec, '__proto__') || tRec['__proto__'] !== null) {
    throw new Error('Typed null was not assigned as own property to __proto__');
  }
  if (tRec.val !== 123) {
    throw new Error(`Expected numeric 123 for val, got ${tRec.val}`);
  }
  const tSerialized = JSON.stringify(tRec);
  if (!tSerialized.includes('"__proto__":null')) {
    throw new Error(`JSON.stringify did not roundtrip typed null __proto__: ${tSerialized}`);
  }
  console.log('✓ Safe property assignment for __proto__, constructor, and prototype verified.');

  // 6. Quoted Empty Rows and Trailing Newline Policy
  const singleQuotedEmpty = parseCsv('""');
  if (singleQuotedEmpty.length !== 1 || singleQuotedEmpty[0].length !== 1 || singleQuotedEmpty[0][0] !== '') {
    throw new Error(`Expected [[""]] for parseCsv('""'), got: ${JSON.stringify(singleQuotedEmpty)}`);
  }

  const headerQuotedEmpty = parseCsv('header\n""');
  if (headerQuotedEmpty.length !== 2 || headerQuotedEmpty[0][0] !== 'header' || headerQuotedEmpty[1][0] !== '') {
    throw new Error(`Expected [["header"], [""]] for parseCsv('header\\n""'), got: ${JSON.stringify(headerQuotedEmpty)}`);
  }

  const headerQuotedEmptyWithTrailingNewline = parseCsv('header\n""\n');
  if (
    headerQuotedEmptyWithTrailingNewline.length !== 2 ||
    headerQuotedEmptyWithTrailingNewline[0][0] !== 'header' ||
    headerQuotedEmptyWithTrailingNewline[1][0] !== ''
  ) {
    throw new Error(
      `Expected [["header"], [""]] for parseCsv('header\\n""\\n'), got: ${JSON.stringify(headerQuotedEmptyWithTrailingNewline)}`,
    );
  }

  const singleQuotedEmptyWithNewline = parseCsv('""\n');
  if (
    singleQuotedEmptyWithNewline.length !== 1 ||
    singleQuotedEmptyWithNewline[0].length !== 1 ||
    singleQuotedEmptyWithNewline[0][0] !== ''
  ) {
    throw new Error(`Expected [[""]] for parseCsv('""\\n'), got: ${JSON.stringify(singleQuotedEmptyWithNewline)}`);
  }

  // Trailing newline on normal data should not create phantom trailing row
  const normalTrailingNewline = parseCsv('header\nval\n');
  if (normalTrailingNewline.length !== 2) {
    throw new Error(`Trailing newline should not produce extra empty row: got ${JSON.stringify(normalTrailingNewline)}`);
  }

  // Blank lines in between should be preserved according to intended blank-line policy
  const blankLineInBetween = parseCsv('header\n\nfooter');
  if (blankLineInBetween.length !== 3 || blankLineInBetween[1][0] !== '') {
    throw new Error(`Blank line between rows should be preserved: got ${JSON.stringify(blankLineInBetween)}`);
  }
  console.log('✓ Quoted empty row and newline policies verified.');

  // 7. Escaped Quotes and Trailing Empty Fields
  const escapedQuotes = parseCsv('""""');
  if (escapedQuotes.length !== 1 || escapedQuotes[0][0] !== '"') {
    throw new Error(`Expected [["\\""]] for parseCsv('""""'), got: ${JSON.stringify(escapedQuotes)}`);
  }

  const complexEscaped = parseCsv('header\n"a""b"');
  if (complexEscaped.length !== 2 || complexEscaped[1][0] !== 'a"b') {
    throw new Error(`Expected escaped quote in field: got ${JSON.stringify(complexEscaped)}`);
  }

  const trailingEmptyFieldNoNewline = parseCsv('a,');
  if (trailingEmptyFieldNoNewline.length !== 1 || trailingEmptyFieldNoNewline[0].length !== 2 || trailingEmptyFieldNoNewline[0][1] !== '') {
    throw new Error(`Expected [["a", ""]] for parseCsv('a,'), got: ${JSON.stringify(trailingEmptyFieldNoNewline)}`);
  }

  const trailingEmptyFieldWithNewline = parseCsv('a,\nb,');
  if (
    trailingEmptyFieldWithNewline.length !== 2 ||
    trailingEmptyFieldWithNewline[0].length !== 2 ||
    trailingEmptyFieldWithNewline[0][1] !== '' ||
    trailingEmptyFieldWithNewline[1].length !== 2 ||
    trailingEmptyFieldWithNewline[1][1] !== ''
  ) {
    throw new Error(`Expected trailing empty fields preserved with newline: got ${JSON.stringify(trailingEmptyFieldWithNewline)}`);
  }
  console.log('✓ Escaped quotes and trailing empty fields verified.');

  // 8. UTF-8 BOM Stripping: Strip leading once, preserve embedded
  const bomCsv = '\uFEFFheader,col2\nval1,embedded\uFEFFbom';
  const bomParsed = parseCsv(bomCsv);
  if (bomParsed[0][0] !== 'header') {
    throw new Error(`Leading BOM was not stripped: expected "header", got ${JSON.stringify(bomParsed[0][0])}`);
  }
  if (bomParsed[1][1] !== 'embedded\uFEFFbom') {
    throw new Error(`Embedded BOM was corrupted: expected "embedded\\uFEFFbom", got ${JSON.stringify(bomParsed[1][1])}`);
  }

  // Detect delimiter with BOM
  const bomTsv = '\uFEFFa\tb\tc\n1\t2\t3';
  if (detectDelimiter(bomTsv) !== '\t') {
    throw new Error('detectDelimiter failed to handle leading UTF-8 BOM');
  }
  console.log('✓ Leading UTF-8 BOM stripping and embedded BOM preservation verified.');

  // 9. JSON -> CSV with Stable Union Headers and Nested Objects
  const jsonData = [
    { name: 'Alpha', details: { role: 'admin', level: 1 } },
    { name: 'Beta', tags: ['fast', 'stable'], count: 10 },
  ];
  const convertedCsv = jsonToCsv(jsonData);
  const parsedJsonCsv = parseCsv(convertedCsv);

  // Headers should be union: name, details, tags, count
  if (parsedJsonCsv[0].join(',') !== 'name,details,tags,count') {
    throw new Error(`Union headers mismatch: got ${JSON.stringify(parsedJsonCsv[0])}`);
  }
  // Nested object in Alpha row
  const alphaDetails = parsedJsonCsv[1][1];
  if (alphaDetails !== '{"role":"admin","level":1}') {
    throw new Error(`Nested object not properly JSON-stringified: got ${alphaDetails}`);
  }
  // Nested array in Beta row
  const betaTags = parsedJsonCsv[2][2];
  if (betaTags !== '["fast","stable"]') {
    throw new Error(`Nested array not properly JSON-stringified: got ${betaTags}`);
  }
  console.log('✓ JSON to CSV stable union headers & nested serialization verified.');

  // 10. Delimiter auto-detection
  const tsvText = 'col1\tcol2\tcol3\nval1\tval2\tval3\nval4\tval5\tval6';
  const detectedTsv = detectDelimiter(tsvText);
  if (detectedTsv !== '\t') {
    throw new Error(`Delimiter autodetection failed: expected "\\t", got ${JSON.stringify(detectedTsv)}`);
  }
  console.log('✓ Delimiter auto-detection verified.');

  console.log('--- ALL _TABULAR CHECKS PASSED SUCCESSFULLY ---');
}

// Self-run when executed directly
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('verify')) {
  runVerification().catch((err) => {
    console.error('Tabular verification failed:', err);
    process.exit(1);
  });
}
