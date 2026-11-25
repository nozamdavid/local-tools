import { describe, expect, it } from 'vitest';
import { aggregatePeakChunk, timestampToPeakBin, validateTrimRange } from './audioTrim';

describe('audio trim range validation', () => {
  it('accepts valid endpoints without rounding them', () => {
    expect(validateTrimRange(0.125, 2.875, 3)).toEqual({ start: 0.125, end: 2.875 });
  });

  it.each([
    [Number.NaN, 1, 2],
    [0, Number.POSITIVE_INFINITY, 2],
    [-0.01, 1, 2],
    [0, 2.01, 2],
    [1, 1, 2],
    [1.5, 1, 2],
  ])('rejects invalid range %s to %s within %s seconds', (start, end, duration) => {
    expect(() => validateTrimRange(start, end, duration)).toThrow(RangeError);
  });
});

describe('waveform peak aggregation', () => {
  it('maps timestamped stereo frames to bins using the loudest channel', () => {
    const peaks = new Float32Array(4);
    const inspected = aggregatePeakChunk(
      peaks,
      {
        timestamp: 0,
        sampleRate: 2,
        channelCount: 2,
        data: new Float32Array([0.1, -0.8, 0.2, -0.3, 0.9, 0.05, -0.4, 0.6]),
      },
      2,
    );

    expect(inspected).toBe(8);
    expect(peaks[0]).toBeCloseTo(0.8);
    expect(peaks[1]).toBeCloseTo(0.3);
    expect(peaks[2]).toBeCloseTo(0.9);
    expect(peaks[3]).toBeCloseTo(0.6);
  });

  it('ignores negative and end-boundary timestamps and returns no bin for invalid bounds', () => {
    const peaks = new Float32Array(2);
    aggregatePeakChunk(
      peaks,
      {
        timestamp: -0.5,
        sampleRate: 2,
        channelCount: 1,
        data: new Float32Array([0.9, 0.2, 0.7, 1]),
      },
      1,
    );

    expect(peaks[0]).toBeCloseTo(0.2);
    expect(peaks[1]).toBeCloseTo(0.7);
    expect(timestampToPeakBin(-0.01, 1, 2)).toBe(-1);
    expect(timestampToPeakBin(1, 1, 2)).toBe(-1);
    expect(timestampToPeakBin(Number.NaN, 1, 2)).toBe(-1);
  });

  it('caps the number of channel values inspected', () => {
    const peaks = new Float32Array(2);
    const inspected = aggregatePeakChunk(
      peaks,
      { timestamp: 0, sampleRate: 4, channelCount: 2, data: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) },
      1,
      1,
      4,
    );

    expect(inspected).toBe(4);
    expect(peaks[0]).toBeCloseTo(0.4);
    expect(peaks[1]).toBe(0);
  });
});
