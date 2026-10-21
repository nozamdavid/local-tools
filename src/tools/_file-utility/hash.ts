/**
 * Cryptographic hashing utilities for MD5, SHA-1, SHA-256, SHA-384, and SHA-512.
 * MD5 is implemented in pure TypeScript according to RFC 1321 (streaming-capable).
 * SHA variants use the standard Web Crypto API (crypto.subtle), available in all modern browsers and Node.
 */

export interface FileDigests {
  md5: string;
  sha1: string;
  sha256: string;
  sha384: string;
  sha512: string;
}

/**
 * Pure TypeScript RFC 1321 MD5 Implementation.
 * Supports streaming chunk-by-chunk updates without allocating full files in memory.
 */
export class MD5 {
  private a = 0x67452301;
  private b = 0xefcdab89;
  private c = 0x98badcfe;
  private d = 0x10325476;
  private buffer = new Uint8Array(64);
  private bufferLength = 0;
  private totalBytes = 0;
  private finalized = false;

  private static readonly S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4,
    11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  private static readonly K = new Uint32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1,
    0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453,
    0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942,
    0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d,
    0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);

  public update(bytes: Uint8Array): this {
    if (this.finalized) throw new Error('MD5 already finalized');
    let offset = 0;
    const len = bytes.length;
    this.totalBytes += len;

    while (offset < len) {
      const needed = 64 - this.bufferLength;
      const toCopy = Math.min(needed, len - offset);
      this.buffer.set(bytes.subarray(offset, offset + toCopy), this.bufferLength);
      this.bufferLength += toCopy;
      offset += toCopy;

      if (this.bufferLength === 64) {
        this.processBlock(this.buffer);
        this.bufferLength = 0;
      }
    }
    return this;
  }

  private processBlock(block: Uint8Array): void {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      M[i] = block[i * 4] | (block[i * 4 + 1] << 8) | (block[i * 4 + 2] << 16) | (block[i * 4 + 3] << 24);
    }

    let a = this.a;
    let b = this.b;
    let c = this.c;
    let d = this.d;

    const S = MD5.S;
    const K = MD5.K;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const temp = d;
      d = c;
      c = b;
      const sum = (a + f + K[i] + M[g]) >>> 0;
      const rot = (sum << S[i]) | (sum >>> (32 - S[i]));
      b = (b + rot) >>> 0;
      a = temp;
    }

    this.a = (this.a + a) >>> 0;
    this.b = (this.b + b) >>> 0;
    this.c = (this.c + c) >>> 0;
    this.d = (this.d + d) >>> 0;
  }

  public digest(): Uint8Array {
    if (this.finalized) throw new Error('MD5 already finalized');
    this.finalized = true;

    const bitLength = this.totalBytes * 8;
    this.buffer[this.bufferLength++] = 0x80;

    if (this.bufferLength > 56) {
      while (this.bufferLength < 64) {
        this.buffer[this.bufferLength++] = 0;
      }
      this.processBlock(this.buffer);
      this.bufferLength = 0;
    }

    while (this.bufferLength < 56) {
      this.buffer[this.bufferLength++] = 0;
    }

    const lowBits = (bitLength >>> 0) & 0xffffffff;
    const highBits = Math.floor(this.totalBytes / 0x20000000);
    this.buffer[56] = lowBits & 0xff;
    this.buffer[57] = (lowBits >>> 8) & 0xff;
    this.buffer[58] = (lowBits >>> 16) & 0xff;
    this.buffer[59] = (lowBits >>> 24) & 0xff;
    this.buffer[60] = highBits & 0xff;
    this.buffer[61] = (highBits >>> 8) & 0xff;
    this.buffer[62] = (highBits >>> 16) & 0xff;
    this.buffer[63] = (highBits >>> 24) & 0xff;

    this.processBlock(this.buffer);

    const out = new Uint8Array(16);
    const words = [this.a, this.b, this.c, this.d];
    for (let w = 0; w < 4; w++) {
      out[w * 4] = words[w] & 0xff;
      out[w * 4 + 1] = (words[w] >>> 8) & 0xff;
      out[w * 4 + 2] = (words[w] >>> 16) & 0xff;
      out[w * 4 + 3] = (words[w] >>> 24) & 0xff;
    }
    return out;
  }

  public digestHex(): string {
    const raw = this.digest();
    let hex = '';
    for (let i = 0; i < raw.length; i++) {
      hex += raw[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  public static hash(bytes: Uint8Array): string {
    return new MD5().update(bytes).digestHex();
  }

  public static hashString(str: string): string {
    return new MD5().update(new TextEncoder().encode(str)).digestHex();
  }
}

/** Converts an ArrayBuffer to a lowercase hex string. */
export function bufToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** Compute SHA-1 digest (hex). */
export async function sha1(data: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', data as unknown as BufferSource);
  return bufToHex(digest);
}

/** Compute SHA-256 digest (hex). */
export async function sha256(data: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return bufToHex(digest);
}

/** Compute SHA-384 digest (hex). */
export async function sha384(data: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-384', data as unknown as BufferSource);
  return bufToHex(digest);
}

/** Compute SHA-512 digest (hex). */
export async function sha512(data: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-512', data as unknown as BufferSource);
  return bufToHex(digest);
}

/** Computes all 5 digests for a Uint8Array. */
export async function computeAllDigests(data: Uint8Array): Promise<FileDigests> {
  const [md5Hex, sha1Hex, sha256Hex, sha384Hex, sha512Hex] = await Promise.all([
    Promise.resolve(MD5.hash(data)),
    sha1(data),
    sha256(data),
    sha384(data),
    sha512(data),
  ]);

  return {
    md5: md5Hex,
    sha1: sha1Hex,
    sha256: sha256Hex,
    sha384: sha384Hex,
    sha512: sha512Hex,
  };
}

/**
 * Computes all 5 digests for a Blob or File.
 * Streams in chunks with yield to allow UI responsiveness, progress reporting, and cancellation.
 */
export async function computeFileDigests(
  file: Blob | File,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<FileDigests> {
  const size = file.size;
  const chunkSize = 2 * 1024 * 1024; // 2MB chunks

  // For small to medium files (<= 64MB), read whole buffer for subtle.digest and stream MD5
  if (size <= 64 * 1024 * 1024) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onProgress?.(0.1);

    const buffer = await file.arrayBuffer();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onProgress?.(0.4);

    const uint8 = new Uint8Array(buffer);
    const md5Hex = MD5.hash(uint8);
    onProgress?.(0.6);

    const [sha1Hex, sha256Hex, sha384Hex, sha512Hex] = await Promise.all([sha1(uint8), sha256(uint8), sha384(uint8), sha512(uint8)]);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onProgress?.(1.0);

    return {
      md5: md5Hex,
      sha1: sha1Hex,
      sha256: sha256Hex,
      sha384: sha384Hex,
      sha512: sha512Hex,
    };
  }

  // For larger files, stream MD5 across chunks first, and then subtle crypto
  const md5State = new MD5();
  let offset = 0;

  while (offset < size) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const end = Math.min(offset + chunkSize, size);
    const slice = file.slice(offset, end);
    const chunkBuffer = await slice.arrayBuffer();
    md5State.update(new Uint8Array(chunkBuffer));
    offset = end;
    onProgress?.((offset / size) * 0.4);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const md5Hex = md5State.digestHex();

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(0.45);
  const fullBuffer = await file.arrayBuffer();
  const fullUint8 = new Uint8Array(fullBuffer);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(0.6);
  const sha1Hex = await sha1(fullUint8);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(0.75);
  const sha256Hex = await sha256(fullUint8);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(0.85);
  const sha384Hex = await sha384(fullUint8);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(0.95);
  const sha512Hex = await sha512(fullUint8);

  onProgress?.(1.0);

  return {
    md5: md5Hex,
    sha1: sha1Hex,
    sha256: sha256Hex,
    sha384: sha384Hex,
    sha512: sha512Hex,
  };
}
