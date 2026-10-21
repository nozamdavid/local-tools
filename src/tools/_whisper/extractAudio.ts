import { runFFmpeg } from '../../lib/ffmpeg';

export async function extractAudioPCM(file: File | Blob, onProgress?: (ratio: number) => void): Promise<Float32Array> {
  const fileName = 'name' in file ? file.name : 'input.bin';
  const dotIndex = fileName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '.mp4';
  const inputName = `input_audio_extract${ext}`;
  const outputName = 'out.pcm';

  let pcmBlob: Blob;

  try {
    pcmBlob = await runFFmpeg({
      inputs: [{ name: inputName, data: file }],
      args: ['-i', inputName, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', outputName],
      output: outputName,
      onProgress,
    });
  } catch (err: unknown) {
    const errorText = err instanceof Error ? err.message : String(err);
    if (
      errorText.includes('Output file does not contain any stream') ||
      errorText.includes('matches no streams') ||
      errorText.includes('does not contain any stream') ||
      errorText.includes('no streams')
    ) {
      throw new Error('No audio track was found in this file. Please select a file with audio.', { cause: err });
    }
    throw err;
  }

  if (pcmBlob.size === 0) {
    throw new Error('No audio track was found in this file. Please select a file with audio.');
  }

  const arrayBuffer = await pcmBlob.arrayBuffer();
  // Ensure the byte offset and length are 4-byte aligned for Float32Array
  const sampleCount = Math.floor(arrayBuffer.byteLength / 4);
  return new Float32Array(arrayBuffer, 0, sampleCount);
}
