/**
 * Video container health inspection utilities:
 * - BMFF (MP4/MOV/M4V): Atom boundaries, 32-bit/64-bit sizes, extends-to-end, missing moov/mdat
 * - EBML (WebM/MKV): Root EBML header, Segment boundaries, truncation checks
 * - RIFF (AVI): Declared RIFF header size vs actual file size, chunk boundaries
 * - Bounded chunk scanning with yields
 * - Browser playability test with object URL cleanup and codec-unsupported distinction
 * - JSON and TXT diagnostic report generation
 */

export type ContainerType = 'mp4-bmff' | 'mkv-webm' | 'avi-riff' | 'unknown';

export type HealthStatus = 'healthy' | 'corrupted' | 'codec-unsupported' | 'unknown-format';

export interface AtomSummary {
  type: string;
  offset: number;
  size: number;
  headerSize: number;
}

export interface ContainerCheckResult {
  containerType: ContainerType;
  isValidContainer: boolean;
  issues: string[];
  warnings: string[];
  atoms: AtomSummary[];
  hasMoov?: boolean;
  hasMdat?: boolean;
  declaredSize?: number;
  actualSize: number;
}

export interface VideoHealthReport {
  fileName: string;
  fileSize: number;
  containerType: ContainerType;
  status: HealthStatus;
  statusMessage: string;
  playableInBrowser: boolean;
  playabilityError?: string;
  issues: string[];
  warnings: string[];
  atoms: AtomSummary[];
  hasMoov?: boolean;
  hasMdat?: boolean;
  duration?: number;
  videoWidth?: number;
  videoHeight?: number;
  diagnosticJson: string;
  diagnosticTxt: string;
}

/**
 * Detects container type by inspectable magic bytes independent of filename.
 */
export function detectVideoContainer(firstBytes: Uint8Array): ContainerType {
  if (firstBytes.length < 12) return 'unknown';

  // 1. RIFF / AVI check: 'RIFF' .... 'AVI ' or 'AVIX'
  const r0 = String.fromCharCode(firstBytes[0], firstBytes[1], firstBytes[2], firstBytes[3]);
  const r8 = String.fromCharCode(firstBytes[8], firstBytes[9], firstBytes[10], firstBytes[11]);
  if (r0 === 'RIFF' && (r8 === 'AVI ' || r8 === 'AVIX')) {
    return 'avi-riff';
  }

  // 2. EBML / WebM / MKV check: 1A 45 DF A3
  if (
    firstBytes[0] === 0x1a &&
    firstBytes[1] === 0x45 &&
    firstBytes[2] === 0xdf &&
    firstBytes[3] === 0xa3
  ) {
    return 'mkv-webm';
  }

  // 3. BMFF / MP4 / MOV check: bytes 4..7 contains 'ftyp', 'moov', 'mdat', 'free', 'skip', 'wide'
  const boxType = String.fromCharCode(firstBytes[4], firstBytes[5], firstBytes[6], firstBytes[7]);
  const commonBmffBoxes = ['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'uuid', 'meta'];
  if (commonBmffBoxes.includes(boxType)) {
    return 'mp4-bmff';
  }

  return 'unknown';
}

/**
 * Inspects BMFF (MP4, MOV) atom boundaries.
 */
export async function inspectBmff(
  file: Blob | File | { size: number; slice: (s: number, e: number) => Blob | { arrayBuffer: () => Promise<ArrayBuffer> } }
): Promise<ContainerCheckResult> {
  const fileSize = file.size;
  const issues: string[] = [];
  const warnings: string[] = [];
  const atoms: AtomSummary[] = [];

  let offset = 0;
  let hasMoov = false;
  let hasMdat = false;
  let count = 0;
  const maxAtoms = 5000;

  while (offset < fileSize && count < maxAtoms) {
    count++;
    const remaining = fileSize - offset;
    if (remaining < 8) {
      issues.push(`Incomplete atom header at byte offset ${offset}: expected 8 bytes, only ${remaining} available.`);
      break;
    }

    const headerSlice = file.slice(offset, Math.min(offset + 16, fileSize));
    const headerBuf = await headerSlice.arrayBuffer();
    const view = new DataView(headerBuf);

    const size32 = view.getUint32(0, false);
    const type = String.fromCharCode(
      view.getUint8(4),
      view.getUint8(5),
      view.getUint8(6),
      view.getUint8(7)
    );

    let atomSize = size32;
    let headerSize = 8;

    if (size32 === 1) {
      // 64-bit size
      if (headerBuf.byteLength < 16) {
        issues.push(`Truncated 64-bit atom header for '${type}' at offset ${offset}.`);
        break;
      }
      const high = view.getUint32(8, false);
      const low = view.getUint32(12, false);
      atomSize = high * 4294967296 + low;
      headerSize = 16;

      if (atomSize < 16) {
        issues.push(`Invalid 64-bit size (${atomSize} bytes) for box '${type}' at offset ${offset}.`);
        break;
      }
    } else if (size32 === 0) {
      // Extends to end of file
      atomSize = fileSize - offset;
      headerSize = 8;
    } else if (size32 < 8) {
      issues.push(`Invalid 32-bit atom size (${size32} bytes) for box '${type}' at offset ${offset}. Minimum is 8 bytes.`);
      break;
    }

    // Boundary check
    if (offset + atomSize > fileSize) {
      issues.push(
        `Box '${type}' at offset ${offset} declares size ${atomSize} bytes (extending to ${offset + atomSize}), which exceeds total file size (${fileSize} bytes). File is truncated!`
      );
      atoms.push({ type, offset, size: atomSize, headerSize });
      break;
    }

    atoms.push({ type, offset, size: atomSize, headerSize });

    if (type === 'moov') hasMoov = true;
    if (type === 'mdat') hasMdat = true;

    offset += atomSize;

    // Yield periodically
    if (count % 25 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  if (!hasMoov) {
    issues.push("Missing 'moov' atom (movie header index). Video player cannot locate audio/video tracks or decode samples; typical of an incomplete or interrupted recording.");
  }
  if (!hasMdat) {
    issues.push("Missing 'mdat' atom (media data payload). Video contains no media samples.");
  }

  return {
    containerType: 'mp4-bmff',
    isValidContainer: issues.length === 0,
    issues,
    warnings,
    atoms,
    hasMoov,
    hasMdat,
    actualSize: fileSize,
  };
}

/**
 * Helper to parse EBML variable length integer (VINT).
 */
export function readEbmlVint(bytes: Uint8Array, offset: number): { value: number; length: number; isUnknown: boolean } | null {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  if (first === 0) return null;

  let length = 1;
  let mask = 0x80;
  while ((first & mask) === 0 && length <= 8) {
    length++;
    mask >>>= 1;
  }

  if (offset + length > bytes.length) return null;

  let value = first & ~mask;
  let isAllOnes = (first & ~mask) === ~mask;

  for (let i = 1; i < length; i++) {
    const b = bytes[offset + i];
    value = value * 256 + b;
    if (b !== 0xff) isAllOnes = false;
  }

  return { value, length, isUnknown: isAllOnes };
}

/**
 * Inspects EBML (WebM, MKV) root and Segment boundaries.
 */
export async function inspectEbml(
  file: Blob | File | { size: number; slice: (s: number, e: number) => Blob | { arrayBuffer: () => Promise<ArrayBuffer> } }
): Promise<ContainerCheckResult> {
  const fileSize = file.size;
  const issues: string[] = [];
  const warnings: string[] = [];
  const atoms: AtomSummary[] = [];

  const initialSlice = file.slice(0, Math.min(4096, fileSize));
  const initialBuf = await initialSlice.arrayBuffer();
  const bytes = new Uint8Array(initialBuf);

  if (bytes.length < 4 || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) {
    issues.push('Invalid EBML signature: File does not start with 1A 45 DF A3.');
    return {
      containerType: 'mkv-webm',
      isValidContainer: false,
      issues,
      warnings,
      atoms,
      actualSize: fileSize,
    };
  }

  let offset = 4;
  const ebmlHeaderSizeVint = readEbmlVint(bytes, offset);
  if (!ebmlHeaderSizeVint) {
    issues.push('Truncated EBML header size field.');
    return {
      containerType: 'mkv-webm',
      isValidContainer: false,
      issues,
      warnings,
      atoms,
      actualSize: fileSize,
    };
  }

  const ebmlHeaderSize = ebmlHeaderSizeVint.value;
  offset += ebmlHeaderSizeVint.length;
  atoms.push({ type: 'EBML_HEADER', offset: 0, size: 4 + ebmlHeaderSizeVint.length + ebmlHeaderSize, headerSize: 4 + ebmlHeaderSizeVint.length });

  // Move past EBML header to Segment
  const segmentStart = offset + ebmlHeaderSize;
  if (segmentStart >= fileSize) {
    issues.push(`File truncated inside or immediately after EBML header (size ${fileSize} bytes <= header end ${segmentStart}).`);
    return {
      containerType: 'mkv-webm',
      isValidContainer: false,
      issues,
      warnings,
      atoms,
      actualSize: fileSize,
    };
  }

  // Read Segment ID and Size
  const segmentSlice = file.slice(segmentStart, Math.min(segmentStart + 64, fileSize));
  const segmentBuf = await segmentSlice.arrayBuffer();
  const segBytes = new Uint8Array(segmentBuf);

  if (segBytes.length >= 4) {
    // Segment ID is 0x18 0x53 0x80 0x67
    if (segBytes[0] === 0x18 && segBytes[1] === 0x53 && segBytes[2] === 0x80 && segBytes[3] === 0x67) {
      const segSizeVint = readEbmlVint(segBytes, 4);
      if (segSizeVint) {
        atoms.push({
          type: 'Segment',
          offset: segmentStart,
          size: segSizeVint.isUnknown ? fileSize - segmentStart : segSizeVint.value,
          headerSize: 4 + segSizeVint.length,
        });

        if (!segSizeVint.isUnknown) {
          const totalDeclaredSegmentEnd = segmentStart + 4 + segSizeVint.length + segSizeVint.value;
          if (totalDeclaredSegmentEnd > fileSize) {
            issues.push(
              `Declared EBML Segment end (${totalDeclaredSegmentEnd} bytes) exceeds total file size (${fileSize} bytes). File is truncated by ${totalDeclaredSegmentEnd - fileSize} bytes!`
            );
          }
        }
      }
    } else {
      warnings.push(`Expected Segment ID 0x18538067 at offset ${segmentStart}, found ${Array.from(segBytes.slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join(' ')}.`);
    }
  }

  return {
    containerType: 'mkv-webm',
    isValidContainer: issues.length === 0,
    issues,
    warnings,
    atoms,
    actualSize: fileSize,
  };
}

/**
 * Inspects RIFF / AVI container boundaries and declared size.
 */
export async function inspectRiff(
  file: Blob | File | { size: number; slice: (s: number, e: number) => Blob | { arrayBuffer: () => Promise<ArrayBuffer> } }
): Promise<ContainerCheckResult> {
  const fileSize = file.size;
  const issues: string[] = [];
  const warnings: string[] = [];
  const atoms: AtomSummary[] = [];

  const headerSlice = file.slice(0, Math.min(1024, fileSize));
  const headerBuf = await headerSlice.arrayBuffer();
  if (headerBuf.byteLength < 12) {
    issues.push('File smaller than RIFF header (12 bytes).');
    return {
      containerType: 'avi-riff',
      isValidContainer: false,
      issues,
      warnings,
      atoms,
      actualSize: fileSize,
    };
  }

  const view = new DataView(headerBuf);
  const declaredRiffSize = view.getUint32(4, true); // little-endian
  const totalExpectedSize = declaredRiffSize + 8;

  atoms.push({ type: 'RIFF_AVI', offset: 0, size: totalExpectedSize, headerSize: 12 });

  if (fileSize < totalExpectedSize) {
    issues.push(
      `File truncated: Actual file size (${fileSize} bytes) is smaller than declared RIFF container size (${totalExpectedSize} bytes). Missing ${totalExpectedSize - fileSize} bytes.`
    );
  } else if (fileSize > totalExpectedSize + 1024) {
    warnings.push(
      `File contains trailing bytes: Actual file size (${fileSize} bytes) exceeds declared RIFF container size (${totalExpectedSize} bytes) by ${fileSize - totalExpectedSize} bytes.`
    );
  }

  return {
    containerType: 'avi-riff',
    isValidContainer: issues.length === 0,
    issues,
    warnings,
    atoms,
    declaredSize: totalExpectedSize,
    actualSize: fileSize,
  };
}

/**
 * Tests browser native video playability with a strict timeout and guaranteed Object URL cleanup.
 */
export async function testBrowserPlayability(
  file: Blob | File
): Promise<{ playable: boolean; error?: string; errorCode?: number; duration?: number; width?: number; height?: number }> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { playable: false, error: 'Video playability probe not available in non-browser environment' };
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;

  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };

    const finish = (res: { playable: boolean; error?: string; errorCode?: number; duration?: number; width?: number; height?: number }) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(res);
    };

    const timer = setTimeout(() => {
      finish({
        playable: false,
        error: 'Native video playback probe timed out after 6000ms (browser was unable to decode video metadata).',
      });
    }, 6000);

    video.onloadedmetadata = () => {
      clearTimeout(timer);
      finish({
        playable: true,
        duration: Number.isFinite(video.duration) ? video.duration : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      });
    };

    video.onerror = () => {
      clearTimeout(timer);
      const code = video.error?.code;
      let msg = video.error?.message || 'Failed to decode media';
      if (code === 4) {
        msg = 'MEDIA_ERR_SRC_NOT_SUPPORTED: Format or codec not supported by browser.';
      } else if (code === 3) {
        msg = 'MEDIA_ERR_DECODE: Decoding error occurred.';
      } else if (code === 2) {
        msg = 'MEDIA_ERR_NETWORK: Network or file read error.';
      } else if (code === 1) {
        msg = 'MEDIA_ERR_ABORTED: Playback aborted.';
      }
      finish({ playable: false, error: msg, errorCode: code });
    };

    video.src = url;
  });
}

/**
 * Runs complete video health diagnostic.
 */
export async function diagnoseVideoFile(file: File): Promise<VideoHealthReport> {
  const initialSlice = file.slice(0, Math.min(1024, file.size));
  const initialBuf = await initialSlice.arrayBuffer();
  const containerType = detectVideoContainer(new Uint8Array(initialBuf));

  let containerCheck: ContainerCheckResult;

  if (containerType === 'mp4-bmff') {
    containerCheck = await inspectBmff(file);
  } else if (containerType === 'mkv-webm') {
    containerCheck = await inspectEbml(file);
  } else if (containerType === 'avi-riff') {
    containerCheck = await inspectRiff(file);
  } else {
    containerCheck = {
      containerType: 'unknown',
      isValidContainer: false,
      issues: ['Unrecognized video container signature. File does not match MP4/MOV (BMFF), MKV/WebM (EBML), or AVI (RIFF) signatures.'],
      warnings: [],
      atoms: [],
      actualSize: file.size,
    };
  }

  // Native playback probe
  const playProbe = await testBrowserPlayability(file);

  // Status classification: identify unknown or codec-unsupported separately from corruption
  let status: HealthStatus;
  let statusMessage: string;

  if (containerType === 'unknown') {
    status = 'unknown-format';
    statusMessage = 'Unknown or unsupported container format.';
  } else if (containerCheck.issues.length > 0) {
    status = 'corrupted';
    statusMessage = 'Container corruption or truncation detected.';
  } else if (!playProbe.playable) {
    status = 'codec-unsupported';
    statusMessage = 'Container structure is valid, but the video/audio codec is not natively supported by this browser (e.g. HEVC/H.265, AV1, ProRes).';
  } else {
    status = 'healthy';
    statusMessage = 'Video container is intact and natively playable in this browser.';
  }

  const report: VideoHealthReport = {
    fileName: file.name,
    fileSize: file.size,
    containerType,
    status,
    statusMessage,
    playableInBrowser: playProbe.playable,
    playabilityError: playProbe.error,
    issues: containerCheck.issues,
    warnings: containerCheck.warnings,
    atoms: containerCheck.atoms,
    hasMoov: containerCheck.hasMoov,
    hasMdat: containerCheck.hasMdat,
    duration: playProbe.duration,
    videoWidth: playProbe.width,
    videoHeight: playProbe.height,
    diagnosticJson: '',
    diagnosticTxt: '',
  };

  // Generate TXT and JSON exports
  report.diagnosticJson = JSON.stringify(
    {
      fileName: report.fileName,
      fileSize: report.fileSize,
      containerType: report.containerType,
      status: report.status,
      statusMessage: report.statusMessage,
      playableInBrowser: report.playableInBrowser,
      playabilityError: report.playabilityError,
      issues: report.issues,
      warnings: report.warnings,
      atoms: report.atoms.slice(0, 50),
      hasMoov: report.hasMoov,
      hasMdat: report.hasMdat,
      duration: report.duration,
      videoWidth: report.videoWidth,
      videoHeight: report.videoHeight,
      disclaimer: 'Diagnostic inspection only. No guarantee of repairability or security.',
    },
    null,
    2
  );

  const lines = [
    '==================================================',
    '       VIDEO HEALTH DIAGNOSTIC REPORT',
    '==================================================',
    `File Name:      ${report.fileName}`,
    `File Size:      ${report.fileSize} bytes`,
    `Container:      ${report.containerType}`,
    `Overall Status: ${report.status.toUpperCase()}`,
    `Summary:        ${report.statusMessage}`,
    `Playable:       ${report.playableInBrowser ? 'YES' : 'NO'}`,
    report.playabilityError ? `Probe Error:    ${report.playabilityError}` : '',
    report.duration ? `Duration:       ${report.duration.toFixed(2)} seconds` : '',
    report.videoWidth && report.videoHeight ? `Dimensions:     ${report.videoWidth}x${report.videoHeight}` : '',
    '',
    '---------------- ISSUES FOUND ----------------',
    report.issues.length === 0 ? 'None detected.' : report.issues.map((iss, i) => `[${i + 1}] ${iss}`).join('\n'),
    '',
    '--------------- WARNINGS ---------------------',
    report.warnings.length === 0 ? 'None.' : report.warnings.map((w, i) => `[${i + 1}] ${w}`).join('\n'),
    '',
    '------------- ATOMS / BOXES SCANNED ----------',
    ...report.atoms.slice(0, 30).map((a) => ` - ${a.type.padEnd(8)} @ 0x${a.offset.toString(16).padStart(8, '0')} (${a.size} bytes)`),
    report.atoms.length > 30 ? ` ... and ${report.atoms.length - 30} more boxes.` : '',
    '',
    '==================================================',
    'DISCLAIMER: Diagnostic only. No repair or security',
    'guarantees are implied.',
    '==================================================',
  ].filter(Boolean);

  report.diagnosticTxt = lines.join('\n');

  return report;
}
