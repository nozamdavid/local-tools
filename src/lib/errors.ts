/**
 * Maps raw error messages (from codecs, wasm, browser APIs, ffmpeg)
 * into actionable, user-friendly failure messages with suggestions.
 */
export function describeError(err: unknown): string {
  if (err === null || err === undefined) {
    return 'An unexpected error occurred.';
  }

  const rawMessage =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : typeof (err as { message?: unknown }).message === 'string'
          ? (err as { message: string }).message
          : String(err);

  const trimmed = rawMessage.trim();
  if (!trimmed) {
    return 'An unexpected error occurred.';
  }

  // 1. AVIF encode unsupported
  // e.g. "This browser cannot encode AVIF images", "AVIF encode unsupported"
  if (
    /cannot encode avif/i.test(trimmed) ||
    /avif.*(?:unsupported|not supported)/i.test(trimmed) ||
    /failed to load avif encoder/i.test(trimmed)
  ) {
    return 'AVIF encoding is unsupported in this browser. Try Chrome or Firefox, or export as WebP or PNG instead.';
  }

  // 2. HEIC/HEIF decode failure
  // e.g. "HEIC/HEIF decode failure", "Failed to decode HEIC image"
  if (/hei[cf].*(?:decode|failure|error|unsupported|corrupt)/i.test(trimmed) || /failed to decode.*hei[cf]/i.test(trimmed)) {
    return 'HEIC/HEIF decode failure: the image could not be decoded. Safari natively supports HEIF, or you can convert the photo to JPEG or PNG before uploading.';
  }

  // 3. JPEG XL decode failure
  // e.g. "JPEG XL decode failure", "Failed to decode JPEG XL image", "Invalid JPEG XL file"
  if (
    /jxl.*(?:decode|failure|error|corrupt)/i.test(trimmed) ||
    /jpeg[ -]?xl.*(?:decode|failure|error|corrupt)/i.test(trimmed) ||
    /failed to decode.*jpeg[ -]?xl/i.test(trimmed) ||
    /invalid jpeg[ -]?xl/i.test(trimmed)
  ) {
    return 'JPEG XL decode failure: the JXL file could not be decoded. Try converting to PNG or WebP in an external image viewer, or view in a browser with JPEG XL enabled.';
  }

  // 4. ffmpeg "Invalid data found" / "could not find codec parameters" / "Unknown decoder"
  if (/invalid data found/i.test(trimmed) || /could not find codec parameters/i.test(trimmed) || /unknown decoder/i.test(trimmed)) {
    return 'Unsupported or corrupt media: FFmpeg could not read this codec or stream. Try converting the media file to standard MP4 (H.264/AAC) using VLC or another desktop tool first.';
  }

  // 5. "Encoder not found" / "Unknown encoder"
  if (/encoder not found/i.test(trimmed) || /unknown encoder/i.test(trimmed)) {
    return 'Encoder not found: the requested output codec is not supported by the in-browser encoder. Try choosing MP4 (H.264) or WebM (VP8/VP9) as your output format.';
  }

  // 6. "Array buffer allocation failed" / out of memory
  if (
    /array buffer allocation failed/i.test(trimmed) ||
    /out of memory/i.test(trimmed) ||
    /\boom\b/i.test(trimmed) ||
    /allocation failed/i.test(trimmed) ||
    /cannot allocate memory/i.test(trimmed)
  ) {
    return 'Out of memory: the browser ran out of memory while processing this file. Try closing other tabs, using a 64-bit desktop browser (Chrome or Firefox), or reducing the file size/resolution.';
  }

  // 7. "Canvas 2D is not available"
  if (/canvas 2d is not available/i.test(trimmed) || /canvas 2d context is not available/i.test(trimmed) || /canvas 2d/i.test(trimmed)) {
    return 'Canvas 2D is not available: your browser could not initialize a 2D canvas context. Check browser hardware acceleration settings or try Chrome or Firefox.';
  }

  // 8. unreadable/corrupt image
  if (
    /could not be decoded/i.test(trimmed) ||
    /corrupt or in an unsupported format/i.test(trimmed) ||
    /unreadable.*image/i.test(trimmed) ||
    /corrupt.*image/i.test(trimmed) ||
    /image.*corrupt/i.test(trimmed) ||
    /failed to load image/i.test(trimmed)
  ) {
    return 'Unreadable or corrupt image: the image file could not be decoded. The file may be damaged or in an unsupported format. Try opening and saving it in an image editor first, or converting to PNG/JPEG.';
  }

  // Preserve original message when nothing matches
  return trimmed;
}
