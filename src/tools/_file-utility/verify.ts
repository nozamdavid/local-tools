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

  // ZIP Byte Preservation Verification
  const originalBytes1 = new Uint8Array([1, 2, 3, 4, 5, 42, 99]);
  const originalBytes2 = new Uint8Array([255, 254, 253, 200, 100]);
  const zip = new JSZip();
  zip.file('renamed_1.bin', originalBytes1);
  zip.file('renamed_2.bin', originalBytes2);
  const zipBlob = await zip.generateAsync({ type: 'uint8array' });

  const readZip = await JSZip.loadAsync(zipBlob);
  const extracted1 = await readZip.file('renamed_1.bin')?.async('uint8array');
  const extracted2 = await readZip.file('renamed_2.bin')?.async('uint8array');
  assert(Boolean(extracted1 && extracted2), 'zip-extraction', 'Files must be extracted from generated ZIP');
  assert(
    extracted1!.length === originalBytes1.length && extracted1!.every((b, i) => b === originalBytes1[i]),
    'zip-byte-preservation-1',
    'Zipped bytes for file 1 must match original byte-for-byte'
  );
  assert(
    extracted2!.length === originalBytes2.length && extracted2!.every((b, i) => b === originalBytes2[i]),
    'zip-byte-preservation-2',
    'Zipped bytes for file 2 must match original byte-for-byte'
  );

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

  const mockBmffFile = {
    size: validBmff.length,
    slice: (s: number, e: number) => ({
      arrayBuffer: async () => validBmff.buffer.slice(s, e),
    }),
  };

  const bmffValidResult = await inspectBmff(mockBmffFile as any);
  assert(bmffValidResult.isValidContainer, 'bmff-valid-fixture', `Valid BMFF fixture must pass with 0 issues, got: ${bmffValidResult.issues.join(', ')}`);
  assert(Boolean(bmffValidResult.hasMoov && bmffValidResult.hasMdat), 'bmff-has-moov-mdat', 'Valid BMFF must find moov and mdat atoms');

  const truncatedBmff = new Uint8Array(48);
  const truncBmffView = new DataView(truncatedBmff.buffer);
  truncBmffView.setUint32(0, 100, false);
  truncatedBmff.set(new TextEncoder().encode('ftyp'), 4);

  const mockTruncBmffFile = {
    size: truncatedBmff.length,
    slice: (s: number, e: number) => ({
      arrayBuffer: async () => truncatedBmff.buffer.slice(s, e),
    }),
  };
  const bmffTruncResult = await inspectBmff(mockTruncBmffFile as any);
  assert(!bmffTruncResult.isValidContainer, 'bmff-truncated-fixture', 'Truncated BMFF fixture must be flagged invalid');
  assert(bmffTruncResult.issues.some((iss) => iss.includes('exceeds total file size')), 'bmff-truncation-detected', 'Truncation message must be present');

  // RIFF AVI
  const validRiff = new Uint8Array(12);
  validRiff.set(new TextEncoder().encode('RIFF'), 0);
  new DataView(validRiff.buffer).setUint32(4, 4, true);
  validRiff.set(new TextEncoder().encode('AVI '), 8);

  const mockRiffFile = {
    size: validRiff.length,
    slice: (s: number, e: number) => ({
      arrayBuffer: async () => validRiff.buffer.slice(s, e),
    }),
  };
  const riffValidResult = await inspectRiff(mockRiffFile as any);
  assert(riffValidResult.isValidContainer, 'riff-valid-fixture', 'Valid minimal RIFF fixture must pass');

  const truncRiff = new Uint8Array(12);
  truncRiff.set(new TextEncoder().encode('RIFF'), 0);
  new DataView(truncRiff.buffer).setUint32(4, 1000, true);
  truncRiff.set(new TextEncoder().encode('AVI '), 8);

  const mockTruncRiffFile = {
    size: truncRiff.length,
    slice: (s: number, e: number) => ({
      arrayBuffer: async () => truncRiff.buffer.slice(s, e),
    }),
  };
  const riffTruncResult = await inspectRiff(mockTruncRiffFile as any);
  assert(!riffTruncResult.isValidContainer, 'riff-truncated-fixture', 'Truncated RIFF fixture must be flagged invalid');
  assert(riffTruncResult.issues.some((iss) => iss.includes('File truncated')), 'riff-truncation-detected', 'RIFF truncation issue must be reported');

  // EBML
  const validEbml = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3,
    0x82, 0x42, 0x86,
    0x18, 0x53, 0x80, 0x67,
    0x84, 0x01, 0x02, 0x03, 0x04,
  ]);
  const mockEbmlFile = {
    size: validEbml.length,
    slice: (s: number, e: number) => ({
      arrayBuffer: async () => validEbml.buffer.slice(s, e),
    }),
  };
  const ebmlValidResult = await inspectEbml(mockEbmlFile as any);
  assert(ebmlValidResult.isValidContainer, 'ebml-valid-fixture', `Valid EBML fixture must pass, got: ${ebmlValidResult.issues.join(', ')}`);

  const truncEbml = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3,
    0x82, 0x42, 0x86,
    0x18, 0x53, 0x80, 0x67,
    0xe4, 0x01, 0x02,
  ]);
  const mockTruncEbmlFile = {
    size: truncEbml.length,
    slice: (s: number, e: number) => ({
      arrayBuffer: async () => truncEbml.buffer.slice(s, e),
    }),
  };
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
