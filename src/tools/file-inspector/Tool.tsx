import { useState, useEffect, useMemo, useRef } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button } from '../../components/Controls';
import { ProgressBar } from '../../components/ProgressBar';
import { getToolMeta } from '../registry';
import { downloadBlob } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { computeFileDigests, type FileDigests } from '../_file-utility/hash';
import { detectFormat, type DetectedFormat } from '../file-converter/detect';
import exifr from 'exifr';
import styles from './Tool.module.css';

interface FileInspection {
  file: File;
  name: string;
  size: number;
  type: string;
  lastModified: string;
  detectedFormat: DetectedFormat | null;
  extensionMismatch: boolean;
  first256Bytes: Uint8Array;
  hexDump: string;
  digests: FileDigests | null;
  exif: Record<string, any> | null;
  mediaDimensions?: { width: number; height: number; duration?: number };
  imagePreviewUrl?: string;
}

export default function FileInspectorTool() {
  const meta = getToolMeta('file-inspector');
  const title = meta.title !== 'file-inspector' ? meta.title : 'File Inspector & Checksum Verifier';
  const description =
    meta.description ||
    'Inspect file signatures, hex byte offsets, metadata, EXIF, and verify MD5/SHA checksums completely in your browser.';

  const [inspection, setInspection] = useState<FileInspection | null>(null);
  const [hashing, setHashing] = useState<boolean>(false);
  const [hashProgress, setHashProgress] = useState<number>(0);
  const [expectedChecksum, setExpectedChecksum] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Clean up object URL when component unmounts or inspection changes
  useEffect(() => {
    return () => {
      if (inspection?.imagePreviewUrl) {
        URL.revokeObjectURL(inspection.imagePreviewUrl);
      }
    };
  }, [inspection?.imagePreviewUrl]);

  const generateHexDump = (bytes: Uint8Array): string => {
    const lines: string[] = [];
    const len = Math.min(bytes.length, 256);

    for (let i = 0; i < len; i += 16) {
      const offset = i.toString(16).padStart(8, '0');
      const chunk = bytes.subarray(i, Math.min(i + 16, len));

      const hexPart: string[] = [];
      let asciiPart = '';

      for (let j = 0; j < 16; j++) {
        if (j < chunk.length) {
          hexPart.push(chunk[j].toString(16).padStart(2, '0'));
          // ASCII representation
          const c = chunk[j];
          asciiPart += c >= 32 && c <= 126 ? String.fromCharCode(c) : '.';
        } else {
          hexPart.push('  ');
        }
      }

      // Group into 8 and 8
      const formattedHex = `${hexPart.slice(0, 8).join(' ')}  ${hexPart.slice(8).join(' ')}`;
      lines.push(`${offset}  ${formattedHex}  |${asciiPart}|`);
    }

    return lines.join('\n');
  };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];

    // Cancel any previous hashing
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    // Read first 4096 bytes for signature detection and first 256 for hex dump
    const slice4k = await file.slice(0, 4096).arrayBuffer();
    const bytes4k = new Uint8Array(slice4k);
    const bytes256 = bytes4k.subarray(0, 256);
    const hexDump = generateHexDump(bytes256);

    // Format detection
    let detected: DetectedFormat | null;
    try {
      detected = await detectFormat(file);
    } catch {
      detected = null;
    }

    // Extension comparison
    const extensionMismatch = detected ? detected.extensionMismatch : false;

    // Optional EXIF extraction
    let exifData: Record<string, any> | null;
    try {
      exifData = await exifr.parse(file, { tiff: true, xmp: true, icc: false });
    } catch {
      exifData = null;
    }

    // Media dimensions / preview if image
    let previewUrl: string | undefined = undefined;
    let mediaDims: { width: number; height: number; duration?: number } | undefined = undefined;

    if (file.type.startsWith('image/') || detected?.family === 'image') {
      previewUrl = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = previewUrl;
        await new Promise((res) => {
          img.onload = () => {
            mediaDims = { width: img.naturalWidth, height: img.naturalHeight };
            res(true);
          };
          img.onerror = () => res(false);
        });
      } catch {
        // Ignore dimension probe errors
      }
    }

    setInspection({
      file,
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      lastModified: new Date(file.lastModified).toISOString(),
      detectedFormat: detected,
      extensionMismatch,
      first256Bytes: bytes256,
      hexDump,
      digests: null,
      exif: exifData,
      mediaDimensions: mediaDims,
      imagePreviewUrl: previewUrl,
    });

    // Compute cryptographic hashes
    setHashing(true);
    setHashProgress(0.05);

    try {
      const digests = await computeFileDigests(file, (progress) => setHashProgress(progress), abortCtrl.signal);
      setInspection((prev) => (prev ? { ...prev, digests } : null));
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Hashing failed:', err);
      }
    } finally {
      setHashing(false);
      setHashProgress(0);
    }
  };

  const handleCancelHash = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setHashing(false);
      setHashProgress(0);
    }
  };

  const handleCopyDigest = async (key: string, val: string) => {
    await navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Expected digest match checking
  const matchResult = useMemo(() => {
    if (!expectedChecksum.trim() || !inspection?.digests) return null;
    const cleanExpected = expectedChecksum.trim().toLowerCase();
    const digests = inspection.digests;

    if (cleanExpected === digests.md5.toLowerCase()) return { match: true, algo: 'MD5' };
    if (cleanExpected === digests.sha1.toLowerCase()) return { match: true, algo: 'SHA-1' };
    if (cleanExpected === digests.sha256.toLowerCase()) return { match: true, algo: 'SHA-256' };
    if (cleanExpected === digests.sha384.toLowerCase()) return { match: true, algo: 'SHA-384' };
    if (cleanExpected === digests.sha512.toLowerCase()) return { match: true, algo: 'SHA-512' };

    // Detect if length corresponds to known hash but value differs
    let expectedAlgo = 'Unknown Hash';
    if (cleanExpected.length === 32) expectedAlgo = 'MD5';
    else if (cleanExpected.length === 40) expectedAlgo = 'SHA-1';
    else if (cleanExpected.length === 64) expectedAlgo = 'SHA-256';
    else if (cleanExpected.length === 96) expectedAlgo = 'SHA-384';
    else if (cleanExpected.length === 128) expectedAlgo = 'SHA-512';

    return { match: false, algo: expectedAlgo };
  }, [expectedChecksum, inspection?.digests]);

  // Export functions
  const handleExportJson = () => {
    if (!inspection) return;
    const data = {
      file: {
        name: inspection.name,
        size: inspection.size,
        type: inspection.type,
        lastModified: inspection.lastModified,
      },
      detection: {
        detectedFormat: inspection.detectedFormat?.label,
        apparentExtension: inspection.name.slice(inspection.name.lastIndexOf('.') + 1),
        actualExtension: inspection.detectedFormat?.ext,
        extensionMismatch: inspection.extensionMismatch,
      },
      checksums: inspection.digests,
      metadata: {
        dimensions: inspection.mediaDimensions,
        exif: inspection.exif,
      },
      disclaimer: 'Integrity and structure inspection only. Does not guarantee safety or detect malware.',
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${inspection.name}-inspection.json`);
  };

  const handleExportTxt = () => {
    if (!inspection) return;
    const lines = [
      '==================================================',
      '           FILE INSPECTION REPORT',
      '==================================================',
      `File Name:          ${inspection.name}`,
      `File Size:          ${formatBytes(inspection.size)} (${inspection.size} bytes)`,
      `MIME Type:          ${inspection.type}`,
      `Last Modified:      ${inspection.lastModified}`,
      `Detected Format:    ${inspection.detectedFormat?.label || 'Unknown'}`,
      `Signature Ext:      ${inspection.detectedFormat?.ext || 'N/A'}`,
      `Extension Mismatch: ${inspection.extensionMismatch ? 'YES (WARNING)' : 'NO'}`,
      '',
      '---------------- CHECKSUMS -----------------------',
      `MD5:     ${inspection.digests?.md5 || 'Computing...'}`,
      `SHA-1:   ${inspection.digests?.sha1 || 'Computing...'}`,
      `SHA-256: ${inspection.digests?.sha256 || 'Computing...'}`,
      `SHA-384: ${inspection.digests?.sha384 || 'Computing...'}`,
      `SHA-512: ${inspection.digests?.sha512 || 'Computing...'}`,
      '',
      '------------- FIRST 256 BYTES HEX ----------------',
      inspection.hexDump,
      '',
      '==================================================',
      'DISCLAIMER: Non-destructive integrity inspection only.',
      'No antivirus or malware safety verification is made.',
      '==================================================',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `${inspection.name}-inspection.txt`);
  };

  const handleExportHtml = () => {
    if (!inspection) return;
    const escapeHtml = (str: string) =>
      str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>File Inspection - ${escapeHtml(inspection.name)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 900px; margin: 0 auto; line-height: 1.5; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .card { background: #1e293b; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; border: 1px solid #334155; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .stat-label { font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; }
    .stat-val { font-size: 1rem; font-weight: 600; margin-top: 0.2rem; }
    pre { background: #020617; padding: 1rem; border-radius: 6px; overflow-x: auto; font-family: ui-monospace, monospace; font-size: 0.8rem; color: #cbd5e1; border: 1px solid #1e293b; }
    .hash-item { margin-bottom: 0.75rem; font-family: ui-monospace, monospace; font-size: 0.85rem; word-break: break-all; }
    .hash-key { color: #94a3b8; font-weight: bold; margin-right: 0.5rem; }
    .badge-match { color: #34d399; font-weight: bold; }
    .badge-mismatch { color: #f87171; font-weight: bold; }
    .disclaimer { font-size: 0.8rem; color: #94a3b8; border-top: 1px solid #334155; padding-top: 1rem; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>File Inspection Report</h1>
  <div class="card">
    <div class="grid">
      <div>
        <div class="stat-label">File Name</div>
        <div class="stat-val">${escapeHtml(inspection.name)}</div>
      </div>
      <div>
        <div class="stat-label">File Size</div>
        <div class="stat-val">${escapeHtml(formatBytes(inspection.size))} (${inspection.size} bytes)</div>
      </div>
      <div>
        <div class="stat-label">MIME Type</div>
        <div class="stat-val">${escapeHtml(inspection.type)}</div>
      </div>
      <div>
        <div class="stat-label">Detected Format</div>
        <div class="stat-val">${escapeHtml(inspection.detectedFormat?.label || 'Unknown')}</div>
      </div>
      <div>
        <div class="stat-label">Extension Match</div>
        <div class="stat-val ${inspection.extensionMismatch ? 'badge-mismatch' : 'badge-match'}">
          ${inspection.extensionMismatch ? '⚠️ Mismatch Warning' : '✓ Matching Signature'}
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Cryptographic Checksums</h2>
    <div class="hash-item"><span class="hash-key">MD5:</span>${escapeHtml(inspection.digests?.md5 || 'N/A')}</div>
    <div class="hash-item"><span class="hash-key">SHA-1:</span>${escapeHtml(inspection.digests?.sha1 || 'N/A')}</div>
    <div class="hash-item"><span class="hash-key">SHA-256:</span>${escapeHtml(inspection.digests?.sha256 || 'N/A')}</div>
    <div class="hash-item"><span class="hash-key">SHA-384:</span>${escapeHtml(inspection.digests?.sha384 || 'N/A')}</div>
    <div class="hash-item"><span class="hash-key">SHA-512:</span>${escapeHtml(inspection.digests?.sha512 || 'N/A')}</div>
  </div>

  <div class="card">
    <h2>First 256 Bytes Hex & ASCII Dump</h2>
    <pre>${escapeHtml(inspection.hexDump)}</pre>
  </div>

  <div class="disclaimer">
    <strong>Notice:</strong> This document was generated securely inside the browser via client-side inspection. It is intended for integrity and structure diagnosis only; no claims of malware detection or antivirus guarantees are made.
  </div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, `${inspection.name}-inspection.html`);
  };

  return (
    <ToolPage title={title} description={description} currentId="file-inspector">
      <div className={styles.container}>
        <FileDrop
          multiple={false}
          label="Choose or drop any file to inspect"
          hint="Calculates MD5/SHA checksums, examines byte signatures, and extracts metadata locally. No uploads."
          onFiles={handleFiles}
        />

        {hashing && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.85rem' }}>
              <span style={{ color: '#9ca3af' }}>Calculating cryptographic digests (MD5, SHA-1, SHA-256, SHA-384, SHA-512)...</span>
              <button
                type="button"
                onClick={handleCancelHash}
                style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.82rem' }}
              >
                Cancel
              </button>
            </div>
            <ProgressBar value={hashProgress} />
          </div>
        )}

        {inspection && (
          <>
            {/* Overview Card */}
            <div className={styles.card}>
              <div className={styles.headerRow}>
                <div>
                  <h2 className={styles.fileNameTitle}>{inspection.name}</h2>
                  <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: '0.2rem' }}>
                    {formatBytes(inspection.size)} &bull; {inspection.lastModified}
                  </div>
                </div>

                <div>
                  {inspection.extensionMismatch ? (
                    <span className={styles.badgeMismatch}>
                      ⚠️ Extension Mismatch: Apparent extension does not match file signature ({inspection.detectedFormat?.ext || 'unknown'}
                      )
                    </span>
                  ) : (
                    <span className={styles.badgeMatch}>✓ File Extension Matches Detected Signature</span>
                  )}
                </div>
              </div>

              <div className={styles.gridStats}>
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>Detected Signature</div>
                  <div className={styles.statValue}>{inspection.detectedFormat?.label || 'Unknown Signature'}</div>
                </div>
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>Format Family</div>
                  <div className={styles.statValue}>
                    {inspection.detectedFormat?.family ? inspection.detectedFormat.family.toUpperCase() : 'UNKNOWN'}
                  </div>
                </div>
                <div className={styles.statItem}>
                  <div className={styles.statLabel}>MIME Type</div>
                  <div className={styles.statValue}>{inspection.type}</div>
                </div>
                {inspection.mediaDimensions && (
                  <div className={styles.statItem}>
                    <div className={styles.statLabel}>Dimensions</div>
                    <div className={styles.statValue}>
                      {inspection.mediaDimensions.width} x {inspection.mediaDimensions.height} px
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Checksums & Compare Card */}
            <div className={styles.card}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Cryptographic Checksums</h3>

              {/* Compare input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '0.8rem', color: '#9ca3af', fontWeight: 600 }}>Compare with Expected Checksum / Digest:</label>
                <input
                  type="text"
                  className={styles.compareInput}
                  placeholder="Paste expected MD5, SHA-1, SHA-256, SHA-384, or SHA-512 hash..."
                  value={expectedChecksum}
                  onChange={(e) => setExpectedChecksum(e.target.value)}
                />
                {matchResult && (
                  <div>
                    {matchResult.match ? (
                      <span className={styles.compareStatusMatch}>✓ MATCH! Digest exactly matches {matchResult.algo} checksum.</span>
                    ) : (
                      <span className={styles.compareStatusMismatch}>
                        ✗ MISMATCH: Input does not match any computed checksum ({matchResult.algo} length expected).
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Hashes Table */}
              <div className={styles.hashesList}>
                {(['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const).map((algoKey) => {
                  const val = inspection.digests ? inspection.digests[algoKey] : 'Computing...';
                  const isMatch = expectedChecksum.trim().toLowerCase() === val.toLowerCase();

                  return (
                    <div key={algoKey} className={styles.hashRow}>
                      <div className={styles.hashHeader}>
                        <span className={styles.hashName}>{algoKey.toUpperCase()}</span>
                        {isMatch && <span className={styles.compareStatusMatch}>✓ Match</span>}
                      </div>
                      <div className={styles.hashValueRow}>
                        <span className={styles.hashValue}>{val}</span>
                        {inspection.digests && (
                          <button type="button" className={styles.hashCopyBtn} onClick={() => handleCopyDigest(algoKey, val)}>
                            {copiedKey === algoKey ? '✓ Copied' : 'Copy'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* First 256 Bytes Hex & ASCII Dump */}
            <div className={styles.card}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>First 256 Bytes (Offset / Hex / ASCII)</h3>
              <div className={styles.hexViewer}>{inspection.hexDump}</div>
            </div>

            {/* Safe Inert Media Preview */}
            {inspection.imagePreviewUrl && (
              <div className={styles.card}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Inert Image Preview</h3>
                <div className={styles.previewContainer}>
                  <img src={inspection.imagePreviewUrl} alt={inspection.name} className={styles.imagePreview} />
                </div>
              </div>
            )}

            {/* If Document / Text preview */}
            {(inspection.type.includes('html') || inspection.type.includes('pdf') || inspection.name.endsWith('.pdf')) && (
              <div className={styles.card}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Document Security Isolation</h3>
                <div className={styles.inertDocNotice}>
                  🔒 HTML and PDF document previews are kept inert to prevent arbitrary script execution and plugin vulnerabilities.
                  Inspection was performed strictly on binary structures.
                </div>
              </div>
            )}

            {/* EXIF Metadata Card if present */}
            {inspection.exif && Object.keys(inspection.exif).length > 0 && (
              <div className={styles.card}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>EXIF Metadata</h3>
                <div className={styles.gridStats}>
                  {Object.entries(inspection.exif)
                    .slice(0, 8)
                    .map(([key, val]) => (
                      <div key={key} className={styles.statItem}>
                        <div className={styles.statLabel}>{key}</div>
                        <div className={styles.statValue}>{typeof val === 'object' ? JSON.stringify(val) : String(val)}</div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Export and Action Buttons */}
            <div className={styles.card}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Export Diagnostic Report</h3>
              <div className={styles.btnGroup}>
                <Button variant="primary" onClick={handleExportJson}>
                  Export JSON
                </Button>
                <Button variant="secondary" onClick={handleExportTxt}>
                  Export TXT
                </Button>
                <Button variant="secondary" onClick={handleExportHtml}>
                  Export HTML
                </Button>
              </div>

              {/* No Antivirus / Safety Claim Disclaimer */}
              <div className={styles.disclaimer}>
                <strong>Security Notice:</strong> This tool performs cryptographic checksum calculation and structural header/signature
                inspection. It does NOT provide antivirus scanning, vulnerability assessments, or malware safety guarantees.
              </div>
            </div>
          </>
        )}
      </div>
    </ToolPage>
  );
}
