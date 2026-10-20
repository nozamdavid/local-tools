import {
  parseCsv,
  serializeCsv,
  csvToRecords,
  jsonToCsv,
  validateHeaders,
  detectDelimiter,
} from './csv';

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
          `Cell [${r}, ${c}] mismatch:\nExpected: ${JSON.stringify(originalRows[r][c])}\nGot:      ${JSON.stringify(parsed[r][c])}`
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
      throw new Error(`Unexpected error message for duplicate headers: ${msg}`);
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
      throw new Error(`Unexpected error message for empty header: ${msg}`);
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

  // 5. JSON -> CSV with Stable Union Headers and Nested Objects
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

  // 6. Delimiter auto-detection
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
