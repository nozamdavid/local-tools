import { runFFmpeg } from '../../lib/ffmpeg';
import { withSuffix } from '../../lib/format';
import { toSrt, type SubtitleCue } from '../_whisper';

export async function embedSoftSubtitles(
  videoFile: File,
  cues: SubtitleCue[],
  onProgress?: (ratio: number) => void
): Promise<Blob> {
  const srtContent = toSrt(cues);
  const srtBytes = new TextEncoder().encode(srtContent);

  const inputExt = videoFile.name.includes('.')
    ? videoFile.name.slice(videoFile.name.lastIndexOf('.'))
    : '.mp4';
  const inputName = `input${inputExt}`;
  const srtName = 'subs.srt';
  const outputName = withSuffix(videoFile.name, '-subtitled-soft', 'mp4');

  const args = [
    '-i',
    inputName,
    '-i',
    srtName,
    '-c',
    'copy',
    '-c:s',
    'mov_text',
    '-movflags',
    '+faststart',
    outputName,
  ];

  return runFFmpeg({
    inputs: [
      { name: inputName, data: videoFile },
      { name: srtName, data: srtBytes },
    ],
    args,
    output: outputName,
    onProgress,
  });
}
