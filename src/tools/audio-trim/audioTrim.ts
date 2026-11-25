import { translate } from '../../lib/i18n';

export const MAX_AUDIO_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_AUDIO_DURATION_SECONDS = 10 * 60;
export const MAX_NATIVE_PCM_BYTES = 256 * 1024 * 1024;
export const MAX_NATIVE_PCM_FLOAT_SAMPLES = MAX_NATIVE_PCM_BYTES / Float32Array.BYTES_PER_ELEMENT;
export const MAX_WAVEFORM_VALUES = 2_000_000;
export const WAVEFORM_BIN_COUNT = 1200;
export const MAX_FALLBACK_WAV_BYTES = 12 * 1024 * 1024;
export const FALLBACK_SAMPLE_RATE = 8000;

export interface TrimRange {
  start: number;
  end: number;
}

export function validateTrimRange(start: number, end: number, duration: number): TrimRange {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError('The audio duration could not be read.');
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new RangeError('Enter a valid start and end time.');
  }
  if (start < 0 || end > duration) {
    throw new RangeError(translate('Choose times between 0 and {duration} seconds.', { duration: Number(duration.toPrecision(10)) }));
  }
  if (start >= end) {
    throw new RangeError('The end time must be after the start time.');
  }
  return { start, end };
}

export function timestampToPeakBin(timestamp: number, duration: number, binCount: number): number {
  if (!Number.isFinite(timestamp) || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(binCount) || binCount <= 0) {
    return -1;
  }
  if (timestamp < 0 || timestamp >= duration) return -1;
  return Math.min(binCount - 1, Math.floor((timestamp / duration) * binCount));
}

export interface PeakChunk {
  timestamp: number;
  sampleRate: number;
  channelCount: number;
  /** Interleaved float samples, one value per channel for each frame. */
  data: Float32Array;
  /** Frame offset within the source stream, used to keep sampling evenly across chunks. */
  firstFrame?: number;
}

/** Adds the loudest channel value at sampled frame timestamps to the matching waveform bin. */
export function aggregatePeakChunk(
  peaks: Float32Array,
  chunk: PeakChunk,
  duration: number,
  stride = 1,
  maxValues = MAX_WAVEFORM_VALUES,
): number {
  if (
    !Number.isFinite(chunk.timestamp) ||
    !Number.isFinite(chunk.sampleRate) ||
    chunk.sampleRate <= 0 ||
    !Number.isInteger(chunk.channelCount) ||
    chunk.channelCount <= 0 ||
    !Number.isInteger(stride) ||
    stride <= 0 ||
    !Number.isInteger(maxValues) ||
    maxValues < 0
  ) {
    throw new RangeError('Invalid decoded audio sample.');
  }

  const frameCount = Math.floor(chunk.data.length / chunk.channelCount);
  const firstFrame = chunk.firstFrame ?? 0;
  let inspectedValues = 0;

  for (let frame = 0; frame < frameCount; frame++) {
    if ((firstFrame + frame) % stride !== 0) continue;
    if (inspectedValues + chunk.channelCount > maxValues) break;

    const timestamp = chunk.timestamp + frame / chunk.sampleRate;
    const bin = timestampToPeakBin(timestamp, duration, peaks.length);
    if (bin < 0) continue;

    let amplitude = 0;
    const offset = frame * chunk.channelCount;
    for (let channel = 0; channel < chunk.channelCount; channel++) {
      const value = chunk.data[offset + channel];
      if (Number.isFinite(value)) amplitude = Math.max(amplitude, Math.abs(value));
    }
    peaks[bin] = Math.max(peaks[bin], amplitude);
    inspectedValues += chunk.channelCount;
  }

  return inspectedValues;
}
