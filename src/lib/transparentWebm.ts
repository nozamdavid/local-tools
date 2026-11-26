import { runFFmpeg, WEBM_AUDIO_ENCODER } from './ffmpeg';

export async function convertTransparentWebm(file: Blob, format: string, onProgress?: (ratio: number) => void): Promise<Blob | null> {
  const header = await file.slice(0, 4).arrayBuffer();
  if (header.byteLength !== 4 || new DataView(header).getUint32(0) !== 0x1a45dfa3) return null;

  const { BlobSource, Input, MATROSKA, WEBM } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: [MATROSKA, WEBM] });
  try {
    if (!(await input.canRead())) return null;
    const tracks = await input.getVideoTracks();
    const transparency = await Promise.all(tracks.map((track) => track.canBeTransparent()));
    if (!transparency.some(Boolean)) return null;

    if (format !== 'webm' && format !== 'mkv') {
      throw new Error('This export cannot preserve the full transparency of this video. Choose WebM or MKV to keep it.');
    }
    if (format === 'webm') {
      const codecs = await Promise.all(tracks.map((track) => track.getCodec()));
      if (codecs.some((codec) => codec !== 'vp8' && codec !== 'vp9' && codec !== 'av1')) {
        throw new Error('WebM cannot copy this video codec with transparency. Choose MKV to keep it.');
      }
    }
  } finally {
    input.dispose();
  }

  const inputName = 'input.mkv';
  const output = `output.${format}`;
  // Stream copy preserves the alpha packets and avoids decoding transparent video in WebCodecs.
  const streams =
    format === 'mkv'
      ? ['-map', '0', '-c', 'copy']
      : ['-map', '0:v', '-map', '0:a?', '-c:v', 'copy', '-c:a', WEBM_AUDIO_ENCODER, '-b:a', '96k'];
  return runFFmpeg({
    inputs: [{ name: inputName, data: file }],
    args: ['-i', inputName, ...streams, output],
    output,
    onProgress,
  });
}
