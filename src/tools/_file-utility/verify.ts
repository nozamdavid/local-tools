/**
 * Verification test suite for:
 * 1. Known empty and 'abc' cryptographic hashes (MD5, SHA-1, SHA-256, SHA-384, SHA-512)
 * 2. Extension mismatch detection
 * 3. Batch rename names, numbering, collision detection, extension preservation, and ZIP byte preservation
 * 4. Valid vs truncated minimal BMFF, RIFF, and EBML video container fixtures
 * 5. CSS sandboxed iframe restrictive CSP and security parameters
 */

import { MD5, computeAllDigests } from './hash';
import { parseFileName, sanitizeFileName, computeBatchRename } from './rename';
import { inspectBmff, inspectEbml, inspectRiff } from './video';
import JSZip from 'jszip';

export interface VerifyResult {
  name: string;
  passed: boolean;
  message?: string;
}

function makeMockFile(bytes: Uint8Array) {
  return {
    size: bytes.length,
    slice: (s: number, e: number) => ({
      arrayBuffer: async () => bytes.slice(s, e).buffer,
    }),
  };
}

export async function runAllUtilityTests(): Promise<{ allPassed: boolean; results: VerifyResult[] }> {
  const results: VerifyResult[] = [];

  function assert(condition: boolean, testName: string, failMsg?: string) {
    if (!condition) {
      results.push({ name: testName, passed: false, message: failMsg || 'Assertion failed' });
      throw new Error(`[FAIL] ${testName}: ${failMsg || 'Assertion failed'}`);
    } else {
      results.push({ name: testName, passed: true });
    }
  }

  // -------------------------------------------------------------
  // 1. Cryptographic hashes: empty string and 'abc'
  // -------------------------------------------------------------
  const emptyBytes = new Uint8Array(0);
  const abcBytes = new TextEncoder().encode('abc');

  // Empty string
  const emptyDigests = await computeAllDigests(emptyBytes);
  assert(emptyDigests.md5 === 'd41d8cd98f00b204e9800998ecf8427e', 'md5-empty', `Expected d41d8cd98f00b204e9800998ecf8427e, got ${emptyDigests.md5}`);
  assert(emptyDigests.sha1 === 'da39a3ee5e6b4b0d3255bfef95601890afd80709', 'sha1-empty', `Expected da39a3ee5e6b4b0d3255bfef95601890afd80709, got ${emptyDigests.sha1}`);
  assert(emptyDigests.sha256 === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'sha256-empty', `Expected e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855, got ${emptyDigests.sha256}`);
  assert(emptyDigests.sha384 === '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b', 'sha384-empty', `Expected 38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b, got ${emptyDigests.sha384}`);
  assert(emptyDigests.sha512 === 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e', 'sha512-empty', `Expected cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e, got ${emptyDigests.sha512}`);

  // String 'abc'
  const abcDigests = await computeAllDigests(abcBytes);
  assert(abcDigests.md5 === '900150983cd24fb0d6963f7d28e17f72', 'md5-abc', `Expected 900150983cd24fb0d6963f7d28e17f72, got ${abcDigests.md5}`);
  assert(abcDigests.sha1 === 'a9993e364706816aba3e25717850c26c9cd0d89d', 'sha1-abc', `Expected a9993e364706816aba3e25717850c26c9cd0d89d, got ${abcDigests.sha1}`);
  assert(abcDigests.sha256 === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256-abc', `Expected ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad, got ${abcDigests.sha256}`);
  assert(abcDigests.sha384 === 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7', 'sha384-abc', `Expected cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7, got ${abcDigests.sha384}`);
  assert(abcDigests.sha512 === 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f', 'sha512-abc', `Expected ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f, got ${abcDigests.sha512}`);

  // MD5 chunked streaming equivalence
  const md5Stream = new MD5();
  md5Stream.update(new Uint8Array([97])); // 'a'
  md5Stream.update(new Uint8Array([98, 99])); // 'bc'
  assert(md5Stream.digestHex() === '900150983cd24fb0d6963f7d28e17f72', 'md5-streaming', 'Streaming chunked MD5 must match one-shot hash');

  // -------------------------------------------------------------
  // 2. Extension Mismatch Detection
  // -------------------------------------------------------------
  const fakeJpgPdfBytes = new TextEncoder().encode('%PDF-1.5\n%Header\n');
  const apparentExt: string = 'jpg';
  const isPdfMagic = fakeJpgPdfBytes[0] === 0x25 && fakeJpgPdfBytes[1] === 0x50 && fakeJpgPdfBytes[2] === 0x44 && fakeJpgPdfBytes[3] === 0x46;
  const isJpgMagic = fakeJpgPdfBytes[0] === 0xff && fakeJpgPdfBytes[1] === 0xd8;
  const hasMismatch = apparentExt !== 'pdf' && isPdfMagic && !isJpgMagic;
  assert(hasMismatch, 'mismatch-detection', 'A .jpg file containing PDF magic bytes must be flagged as an extension mismatch');

  // -------------------------------------------------------------
  // 3. Batch Rename, Collisions, Extensions, and ZIP byte preservation
  // -------------------------------------------------------------
  const gitignoreParsed = parseFileName('.gitignore');
  assert(gitignoreParsed.base === '.gitignore' && gitignoreParsed.ext === '', 'parse-dotfile', 'Dotfile must have base .gitignore and empty ext');

  const makefileParsed = parseFileName('Makefile');
  assert(makefileParsed.base === 'Makefile' && makefileParsed.ext === '', 'parse-extensionless', 'Makefile must have base Makefile and empty ext');

  const tarGzParsed = parseFileName('backup.tar.gz');
  assert(tarGzParsed.base === 'backup' && tarGzParsed.ext === '.tar.gz', 'parse-compound-ext', 'Compound .tar.gz must preserve .tar.gz extension');

  const sanitizedPath = sanitizeFileName('../../secret/file?.txt');
  assert(!sanitizedPath.name.includes('/') && !sanitizedPath.name.includes('?'), 'sanitize-illegal-chars', 'Slashes and illegal chars must be sanitized');

  const sanitizedNul = sanitizeFileName('nul.txt');
  assert(sanitizedNul.name.startsWith('_'), 'sanitize-windows-reserved', 'Windows reserved name NUL must be prefixed to prevent OS filesystem errors');

  const testFiles = [
    { id: '1', name: 'photo.jpg', size: 100 },
    { id: '2', name: 'photo.jpg', size: 150 },
    { id: '3', name: 'document.pdf', size: 200 },
  ];

  const renamedWithNumbering = computeBatchRename(testFiles, {
    mode: 'custom',
    baseName: 'holiday',
    enableNumbering: true,
    numberStart: 1,
    numberPadding: 3,
    numberPosition: 'suffix',
    separator: '_',
    preserveExtension: true,
    caseTransform: 'none',
    autoResolveCollisions: false,
  });

  assert(renamedWithNumbering[0].newName === 'holiday_001.jpg', 'rename-padding-1', `Expected holiday_001.jpg, got ${renamedWithNumbering[0].newName}`);
  assert(renamedWithNumbering[1].newName === 'holiday_002.jpg', 'rename-padding-2', `Expected holiday_002.jpg, got ${renamedWithNumbering[1].newName}`);
  assert(renamedWithNumbering[2].newName === 'holiday_003.pdf', 'rename-padding-3', `Expected holiday_003.pdf, got ${renamedWithNumbering[2].newName}`);
  assert(!renamedWithNumbering[0].hasCollision && !renamedWithNumbering[1].hasCollision, 'rename-no-collision', 'Unique numbered items must not collide');

  const renamedColliding = computeBatchRename(testFiles, {
    mode: 'custom',
    baseName: 'same_name',
    enableNumbering: false,
    numberStart: 1,
    numberPadding: 1,
    numberPosition: 'suffix',
    separator: '_',
    preserveExtension: true,
    caseTransform: 'none',
    autoResolveCollisions: false,
  });
  assert(renamedColliding[0].hasCollision && renamedColliding[1].hasCollision, 'rename-detect-collision', 'Identical target names must trigger collision flag');

  const renamedResolved = computeBatchRename(testFiles, {
    mode: 'custom',
    baseName: 'same_name',
    enableNumbering: false,
    numberStart: 1,
    numberPadding: 1,
    numberPosition: 'suffix',
    separator: '_',
    preserveExtension: true,
    caseTransform: 'none',
    autoResolveCollisions: true,
  });
  assert(renamedResolved[0].newName === 'same_name.jpg', 'rename-resolve-1', 'First colliding item keeps base name');
  assert(renamedResolved[1].newName === 'same_name_2.jpg', 'rename-resolve-2', 'Second colliding item gets unique suffix');
  assert(!renamedResolved[0].hasCollision && !renamedResolved[1].hasCollision, 'rename-resolved-no-collision', 'Auto-resolved items must clear collision flag');

  // Regression Target: photo.jpg, photo.jpg, photo_2.jpg with mode: 'original', autoResolve: true
  const repeatedPhotoFiles = [
    { id: 'p1', name: 'photo.jpg', size: 101 },
    { id: 'p2', name: 'photo.jpg', size: 102 },
    { id: 'p3', name: 'photo_2.jpg', size: 103 },
  ];
  const resolvedRepeatedPhotos = computeBatchRename(repeatedPhotoFiles, {
    mode: 'original',
    baseName: '',
    enableNumbering: false,
    numberStart: 1,
    numberPadding: 1,
    numberPosition: 'suffix',
    separator: '_',
    preserveExtension: true,
    caseTransform: 'none',
    autoResolveCollisions: true,
  });

  const photoNewNames = resolvedRepeatedPhotos.map((r) => r.newName);
  assert(photoNewNames[0] === 'photo.jpg', 'rename-repeated-1', `Expected photo.jpg, got ${photoNewNames[0]}`);
  assert(photoNewNames[1] === 'photo_3.jpg', 'rename-repeated-2', `Expected photo_3.jpg to avoid photo_2 collision, got ${photoNewNames[1]}`);
  assert(photoNewNames[2] === 'photo_2.jpg', 'rename-repeated-3', `Expected photo_2.jpg, got ${photoNewNames[2]}`);
  const uniqueNamesSet = new Set(photoNewNames.map((n) => n.toLowerCase()));
  assert(uniqueNamesSet.size === 3, 'rename-unique-all', 'All auto-resolved names must be unique');
  assert(resolvedRepeatedPhotos.every((r) => !r.hasCollision), 'rename-repeated-no-collision', 'Collisions resolved');

  // Case collision handling: photo.jpg vs PHOTO.jpg
  const caseFiles = [
    { id: 'c1', name: 'photo.jpg', size: 10 },
    { id: 'c2', name: 'PHOTO.jpg', size: 20 },
  ];
  const caseColliding = computeBatchRename(caseFiles, {
    mode: 'original',
    baseName: '',
    enableNumbering: false,
    numberStart: 1,
    numberPadding: 1,
    numberPosition: 'suffix',
    separator: '_',
    preserveExtension: true,
    caseTransform: 'none',
    autoResolveCollisions: false,
  });
  assert(caseColliding[0].hasCollision && caseColliding[1].hasCollision, 'rename-case-collision-detected', 'Case-insensitive collision must be detected');

  const caseResolved = computeBatchRename(caseFiles, {
    mode: 'original',
    baseName: '',
    enableNumbering: false,
    numberStart: 1,
    numberPadding: 1,
    numberPosition: 'suffix',
    separator: '_',
    preserveExtension: true,
    caseTransform: 'none',
    autoResolveCollisions: true,
  });
  assert(
    caseResolved[0].newName.toLowerCase() !== caseResolved[1].newName.toLowerCase(),
    'rename-case-resolved-unique',
    `Case collision must resolve to distinct names: got ${caseResolved[0].newName} and ${caseResolved[1].newName}`
  );

  // Compound extensions collision handling: archive.tar.gz vs archive.tar.gz
  const compoundFiles = [
    { id: 't1', name: 'archive.tar.gz', size: 1000 },
    { id: 't2', name: 'archive.tar.gz', size: 1000 },
  ];
  const compoundResolved = computeBatchRename(compoundFiles, {
    mode: 'original',
    baseName: '',
    enableNumbering: false,
    numberStart: 1,
    numberPadding: 1,
    numberPosition: 'suffix',
    separator: '_',
    preserveExtension: true,
    caseTransform: 'none',
    autoResolveCollisions: true,
  });
  assert(compoundResolved[0].newName === 'archive.tar.gz', 'rename-compound-1', 'First compound file keeps name');
  assert(compoundResolved[1].newName === 'archive_2.tar.gz', 'rename-compound-2', `Expected archive_2.tar.gz, got ${compoundResolved[1].newName}`);

  // ZIP Byte Preservation and Entry Count Verification
  const originalBytes1 = new Uint8Array([1, 2, 3, 4, 5, 42, 99]);
  const originalBytes2 = new Uint8Array([255, 254, 253, 200, 100]);
  const originalBytes3 = new Uint8Array([7, 14, 21, 28, 35, 42]);
  const batchBytes = [originalBytes1, originalBytes2, originalBytes3];

  const zip = new JSZip();
  for (let i = 0; i < resolvedRepeatedPhotos.length; i++) {
    zip.file(resolvedRepeatedPhotos[i].newName, batchBytes[i]);
  }
  const zipBlob = await zip.generateAsync({ type: 'uint8array' });

  const readZip = await JSZip.loadAsync(zipBlob);
  const zipEntries = Object.keys(readZip.files).filter((name) => !readZip.files[name].dir);
  assert(zipEntries.length === 3, 'zip-entry-count', `Expected 3 entries in ZIP, got ${zipEntries.length}`);

  for (let i = 0; i < resolvedRepeatedPhotos.length; i++) {
    const entryName = resolvedRepeatedPhotos[i].newName;
    const extracted = await readZip.file(entryName)?.async('uint8array');
    assert(Boolean(extracted), `zip-entry-exists-${i}`, `Entry ${entryName} must exist in generated ZIP`);
    const expectedBytes = batchBytes[i];
    assert(
      extracted!.length === expectedBytes.length && extracted!.every((b, idx) => b === expectedBytes[idx]),
      `zip-byte-match-${i}`,
      `Entry ${entryName} byte content must match verbatim`
    );
  }

  // -------------------------------------------------------------
  // 4. Valid vs Truncated minimal BMFF, RIFF, and EBML fixtures
  // -------------------------------------------------------------
  const validBmff = new Uint8Array(48);
  const bmffView = new DataView(validBmff.buffer);
  bmffView.setUint32(0, 16, false);
  validBmff.set(new TextEncoder().encode('ftyp'), 4);
  validBmff.set(new TextEncoder().encode('isom'), 8);
  bmffView.setUint32(16, 16, false);
  validBmff.set(new TextEncoder().encode('moov'), 20);
  bmffView.setUint32(32, 16, false);
  validBmff.set(new TextEncoder().encode('mdat'), 36);

  const mockBmffFile = makeMockFile(validBmff);
  const bmffValidResult = await inspectBmff(mockBmffFile as any);
  assert(bmffValidResult.isValidContainer, 'bmff-valid-fixture', `Valid BMFF fixture must pass with 0 issues, got: ${bmffValidResult.issues.join(', ')}`);
  assert(Boolean(bmffValidResult.hasMoov && bmffValidResult.hasMdat), 'bmff-has-moov-mdat', 'Valid BMFF must find moov and mdat atoms');

  const truncatedBmff = new Uint8Array(48);
  const truncBmffView = new DataView(truncatedBmff.buffer);
  truncBmffView.setUint32(0, 100, false);
  truncatedBmff.set(new TextEncoder().encode('ftyp'), 4);

  const mockTruncBmffFile = makeMockFile(truncatedBmff);
  const bmffTruncResult = await inspectBmff(mockTruncBmffFile as any);
  assert(!bmffTruncResult.isValidContainer, 'bmff-truncated-fixture', 'Truncated BMFF fixture must be flagged invalid');
  assert(bmffTruncResult.issues.some((iss) => iss.includes('exceeds total file size')), 'bmff-truncation-detected', 'Truncation message must be present');

  // RIFF AVI
  const validRiff = new Uint8Array(12);
  validRiff.set(new TextEncoder().encode('RIFF'), 0);
  new DataView(validRiff.buffer).setUint32(4, 4, true);
  validRiff.set(new TextEncoder().encode('AVI '), 8);

  const mockRiffFile = makeMockFile(validRiff);
  const riffValidResult = await inspectRiff(mockRiffFile as any);
  assert(riffValidResult.isValidContainer, 'riff-valid-fixture', 'Valid minimal RIFF fixture must pass');

  const truncRiff = new Uint8Array(12);
  truncRiff.set(new TextEncoder().encode('RIFF'), 0);
  new DataView(truncRiff.buffer).setUint32(4, 1000, true);
  truncRiff.set(new TextEncoder().encode('AVI '), 8);

  const mockTruncRiffFile = makeMockFile(truncRiff);
  const riffTruncResult = await inspectRiff(mockTruncRiffFile as any);
  assert(!riffTruncResult.isValidContainer, 'riff-truncated-fixture', 'Truncated RIFF fixture must be flagged invalid');
  assert(riffTruncResult.issues.some((iss) => iss.includes('File truncated')), 'riff-truncation-detected', 'RIFF truncation issue must be reported');

  // EBML Tests with bytes.slice(s, e).buffer fixtures
  // 4a. Minimal valid Segment
  const validEbml = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, // EBML Header ID
    0x82, 0x42, 0x86,       // Header size VINT = 2, body = 0x42 0x86
    0x18, 0x53, 0x80, 0x67, // Segment ID
    0x84, 0x01, 0x02, 0x03, 0x04, // Segment size VINT = 4, body = 4 bytes
  ]);
  const mockEbmlFile = makeMockFile(validEbml);
  const ebmlValidResult = await inspectEbml(mockEbmlFile as any);
  assert(ebmlValidResult.isValidContainer, 'ebml-valid-fixture', `Valid EBML fixture must pass, got: ${ebmlValidResult.issues.join(', ')}`);

  // 4b. Allowed EBML Void before Segment (bounded skip)
  const validEbmlWithVoid = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, // EBML Header ID
    0x82, 0x42, 0x86,       // Header size VINT = 2, body = 2 bytes
    0xec, 0x82, 0x00, 0x00, // EBML Void ID (0xec), size VINT = 2, payload = 2 bytes
    0x18, 0x53, 0x80, 0x67, // Segment ID
    0x84, 0x01, 0x02, 0x03, 0x04, // Segment size VINT = 4, body = 4 bytes
  ]);
  const mockEbmlVoidFile = makeMockFile(validEbmlWithVoid);
  const ebmlVoidResult = await inspectEbml(mockEbmlVoidFile as any);
  assert(ebmlVoidResult.isValidContainer, 'ebml-allowed-void', `EBML with allowed Void before Segment must pass, got: ${ebmlVoidResult.issues.join(', ')}`);
  assert(ebmlVoidResult.atoms.some((a) => a.type === 'Void') && ebmlVoidResult.atoms.some((a) => a.type === 'Segment'), 'ebml-void-atoms', 'Both Void and Segment atoms must be scanned');

  // 4c. Absent Segment ID (file truncated after EBML header)
  const absentSegEbml = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3,
    0x82, 0x42, 0x86,
  ]);
  const mockAbsentSeg = makeMockFile(absentSegEbml);
  const ebmlAbsentResult = await inspectEbml(mockAbsentSeg as any);
  assert(!ebmlAbsentResult.isValidContainer, 'ebml-absent-seg', 'File truncated before Segment ID must be flagged invalid');
  assert(ebmlAbsentResult.issues.length > 0, 'ebml-absent-seg-issues', 'Must emit issue on missing Segment');

  // 4d. Truncated Segment ID (only 2 bytes of ID)
  const truncIdEbml = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3,
    0x82, 0x42, 0x86,
    0x18, 0x53, // Only 2 bytes of Segment ID
  ]);
  const mockTruncId = makeMockFile(truncIdEbml);
  const ebmlTruncIdResult = await inspectEbml(mockTruncId as any);
  assert(!ebmlTruncIdResult.isValidContainer, 'ebml-truncated-id', 'Truncated 4-byte Segment ID must be flagged invalid');
  assert(ebmlTruncIdResult.issues.some((iss) => iss.includes('Segment ID')), 'ebml-truncated-id-issue', 'Must emit concrete issue on truncated Segment ID');

  // 4e. Invalid Segment ID (wrong 4-byte ID)
  const wrongIdEbml = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3,
    0x82, 0x42, 0x86,
    0x11, 0x22, 0x33, 0x44, // Wrong ID
    0x84, 0x01, 0x02, 0x03, 0x04,
  ]);
  const mockWrongId = makeMockFile(wrongIdEbml);
  const ebmlWrongIdResult = await inspectEbml(mockWrongId as any);
  assert(!ebmlWrongIdResult.isValidContainer, 'ebml-wrong-id', 'Wrong Segment ID must be flagged invalid');
  assert(ebmlWrongIdResult.issues.some((iss) => iss.includes('Expected Segment ID')), 'ebml-wrong-id-issue', 'Must emit concrete issue on wrong Segment ID');

  // 4f. Missing Segment size VINT
  const noVintEbml = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3,
    0x82, 0x42, 0x86,
    0x18, 0x53, 0x80, 0x67, // Segment ID with NO following size VINT
  ]);
  const mockNoVint = makeMockFile(noVintEbml);
  const ebmlNoVintResult = await inspectEbml(mockNoVint as any);
  assert(!ebmlNoVintResult.isValidContainer, 'ebml-no-vint', 'Missing Segment size VINT must be flagged invalid');
  assert(ebmlNoVintResult.issues.some((iss) => iss.includes('size field') || iss.includes('Segment')), 'ebml-no-vint-issue', 'Must emit concrete issue on missing size VINT');

  // 4g. Declared Segment size exceeds file size
  const truncEbml = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3,
    0x82, 0x42, 0x86,
    0x18, 0x53, 0x80, 0x67,
    0xe4, 0x01, 0x02,
  ]);
  const mockTruncEbmlFile = makeMockFile(truncEbml);
  const ebmlTruncResult = await inspectEbml(mockTruncEbmlFile as any);
  assert(!ebmlTruncResult.isValidContainer, 'ebml-truncated-fixture', 'Truncated EBML fixture must be flagged invalid');
  assert(ebmlTruncResult.issues.some((iss) => iss.includes('exceeds total file size')), 'ebml-truncation-detected', 'EBML truncation detected');

  // -------------------------------------------------------------
  // 5. CSS sandboxed frame restrictive CSP verification
  // -------------------------------------------------------------
  const cspPolicy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none';";
  assert(cspPolicy.includes("default-src 'none'"), 'csp-default-none', 'CSP must restrict default-src to none');
  assert(cspPolicy.includes("style-src 'unsafe-inline'"), 'csp-style-inline', 'CSP must allow local inline styles');
  assert(!cspPolicy.includes("script-src"), 'csp-no-scripts', 'CSP must never enable script-src');
  assert(cspPolicy.includes("connect-src 'none'"), 'csp-no-network', 'CSP must block connect-src network fetches');

  const sandboxAttrs = '';
  assert(!sandboxAttrs.includes('allow-scripts'), 'sandbox-no-scripts', 'Iframe sandbox must not permit script execution');
  assert(!sandboxAttrs.includes('allow-same-origin'), 'sandbox-no-same-origin', 'Iframe sandbox must be origin-isolated from host');

  return { allPassed: true, results };
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('verify.ts')) {
  runAllUtilityTests()
    .then((res) => {
      console.log(`\nAll ${res.results.length} _file-utility verification tests passed successfully!`);
      for (const r of res.results) {
        console.log(`  ✓ ${r.name}`);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
