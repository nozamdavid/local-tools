import { describe, it, expect } from 'vitest';
import { describeError } from './errors';

describe('describeError', () => {
  it('returns a generic message for empty input', () => {
    expect(describeError(null)).toBe('An unexpected error occurred.');
    expect(describeError(undefined)).toBe('An unexpected error occurred.');
    expect(describeError('   ')).toBe('An unexpected error occurred.');
  });

  it('maps an AVIF encoder failure', () => {
    expect(describeError('This browser cannot encode AVIF images')).toContain('AVIF encoding is unsupported');
  });

  it('maps a HEIC decode failure', () => {
    expect(describeError('HEIC/HEIF decode failure: could not decode "photo.HEIC"')).toContain('HEIC/HEIF decode failure');
  });

  it('maps a JPEG XL decode failure', () => {
    expect(describeError('Failed to decode JPEG XL image: corrupted codestream')).toContain('JPEG XL decode failure');
  });

  it('maps unreadable media and missing encoders', () => {
    expect(describeError('[mov,mp4 @ 0x1] Invalid data found when processing input')).toContain('Unsupported or corrupt media');
    expect(describeError('Encoder not found: libx265')).toContain('Encoder not found');
  });

  it('maps memory and canvas failures', () => {
    expect(describeError('RangeError: Array buffer allocation failed')).toContain('Out of memory');
    expect(describeError('Canvas 2D is not available in this browser.')).toContain('Canvas 2D is not available');
  });

  it('maps corrupt image errors', () => {
    expect(describeError('This image could not be decoded. The file may be corrupt.')).toContain('Unreadable or corrupt image');
  });

  it('reads a message property from non-Error objects', () => {
    expect(describeError({ message: 'custom failure' })).toBe('custom failure');
  });

  it('preserves an unmapped message', () => {
    expect(describeError(new Error('Special custom error occurred.'))).toBe('Special custom error occurred.');
  });
});
