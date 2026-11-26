import { getFFmpeg, runFFmpegWithinMediaJob, WEBM_AUDIO_ENCODER } from '../../lib/ffmpeg';
import { withMediaJobLock } from '../../lib/mediaQueue';
import { getRotatedFrame, type FrameSize } from './timeline';

export type Segment = { start: number; end: number; sourceIndex?: number };

export type VideoEdit = {
  segments: Segment[];
  speed: number;
  crop: { x: number; y: number; width: number; height: number } | null;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  audioOffset: number;
  audioVolume: number;
};

type ProbeStream = {
  index: number;
  codec_type: string;
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  side_data_list?: { rotation?: number }[];
  start_time?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
};

const sourceName = 'video-editor-source';
const probeName = 'video-editor-probe.json';
const musicName = 'video-editor-soundtrack';
const sampleRate = 48000;

function seconds(value: number): string {
  return value.toFixed(6);
}

function tempoFilters(speed: number): string[] {
  const filters: string[] = [];
  while (speed > 2) {
    filters.push('atempo=2');
    speed /= 2;
  }
  while (speed < 0.5) {
    filters.push('atempo=0.5');
    speed *= 2;
  }
  if (speed !== 1) filters.push(`atempo=${speed}`);
  return filters;
}

async function probeSource(ffmpeg: Awaited<ReturnType<typeof getFFmpeg>>, name: string) {
  const exitCode = await ffmpeg.ffprobe([
    '-hide_banner',
    '-show_entries',
    'stream=index,codec_type,start_time,duration,width,height,sample_aspect_ratio:stream_disposition=attached_pic:stream_side_data=rotation:format=start_time,duration',
    '-of',
    'json',
    '-o',
    probeName,
    name,
  ]);
  // Some builds leave the return code unset (-1) when ffprobe writes its report.
  if (exitCode > 0) throw new Error('FFmpeg could not read the source video metadata.');
  const result = await ffmpeg.readFile(probeName, 'utf8').catch(() => {
    throw new Error('FFmpeg could not read the source video metadata.');
  });
  await ffmpeg.deleteFile(probeName);
  const probe = JSON.parse(String(result)) as {
    streams?: ProbeStream[];
    format?: { start_time?: string; duration?: string };
  };
  const video = probe.streams?.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  if (!video) throw new Error('The source file has no video track.');
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  const videoDuration = Number(video.duration);
  const startOffset = Number(video.start_time ?? 0) - Number(probe.format?.start_time ?? 0);
  const duration = videoDuration > 0 ? videoDuration + Math.max(0, startOffset) : Number(probe.format?.duration);
  return { name, video, audio, duration };
}

function displaySize(video: ProbeStream): FrameSize {
  const [numerator, denominator] = (video.sample_aspect_ratio ?? '').split(':').map(Number);
  const pixelAspect = numerator > 0 && denominator > 0 ? numerator / denominator : 1;
  const width = Math.round(Number(video.width) * Math.max(1, pixelAspect));
  const height = Math.round(Number(video.height) * Math.max(1, 1 / pixelAspect));
  const rotation = video.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? 0;
  return Math.abs(rotation) % 180 === 90 ? { width: height, height: width } : { width, height };
}

async function readAnchorSize(file: File): Promise<FrameSize> {
  // When source 0 has no ranges, read its metadata without copying it into WASM.
  const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('The project anchor has no video track.');
    const [width, height] = await Promise.all([video.getDisplayWidth(), video.getDisplayHeight()]);
    return { width, height };
  } finally {
    input.dispose();
  }
}

function fitFilters({ width, height }: FrameSize): string[] {
  // Use display aspect ratio after FFmpeg's automatic orientation. Full chroma resolution keeps padding aligned to pixels.
  return [
    `scale=w='max(1,round(min(${width},${height}*dar)))':h='max(1,round(min(${height},${width}/dar)))'`,
    'format=yuv444p',
    'setsar=1',
    `pad=${width}:${height}:floor((ow-iw)/2):floor((oh-ih)/2):black`,
  ];
}

function videoFilters(edit: VideoEdit, frame: FrameSize): string[] {
  const output = getRotatedFrame(edit.crop ?? frame, edit.rotation);
  const rescale = output.contentWidth !== output.width || output.contentHeight !== output.height;
  const filters: string[] = [];
  if (!output.cardinal || rescale) filters.push('format=yuv444p');
  if (edit.crop) {
    const { x, y, width, height } = edit.crop;
    filters.push(`crop=${Math.round(width)}:${Math.round(height)}:${Math.round(x)}:${Math.round(y)}:exact=1`);
  }
  if (output.rotation === 90) filters.push('transpose=clock');
  if (output.rotation === -180) filters.push('hflip', 'vflip');
  if (output.rotation === -90) filters.push('transpose=cclock');
  if (!output.cardinal) filters.push(`rotate=${output.radians}:ow=${output.contentWidth}:oh=${output.contentHeight}`);
  if (edit.flipH) filters.push('hflip');
  if (edit.flipV) filters.push('vflip');
  if (rescale) filters.push(`scale=${output.width}:${output.height}:flags=bilinear`, 'setsar=1');
  filters.push('format=yuv420p');
  return filters;
}

function validateEdit(edit: VideoEdit) {
  const { segments, speed, crop, volume, fadeIn, fadeOut, audioOffset, audioVolume } = edit;
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Video speed must be greater than zero.');
  if (!Number.isFinite(edit.rotation)) throw new Error('Select a valid rotation angle.');
  if (
    !segments.length ||
    segments.some(({ start, end }) => !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)
  ) {
    throw new Error('Select at least one valid video range.');
  }
  if (
    crop &&
    (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1)
  ) {
    throw new Error('Select a valid crop rectangle.');
  }
  if (![volume, fadeIn, fadeOut, audioVolume].every((value) => Number.isFinite(value) && value >= 0) || !Number.isFinite(audioOffset)) {
    throw new Error('Invalid audio settings.');
  }
}

export async function exportVideoEdit(
  file: File | readonly File[],
  edit: VideoEdit,
  soundtrack: File | null,
  format: 'mp4' | 'webm',
  onProgress: (value: number) => void,
  signal: AbortSignal,
  projectSize?: FrameSize,
): Promise<Blob> {
  signal.throwIfAborted();
  validateEdit(edit);
  const files: readonly File[] = Array.isArray(file) ? file : [file as File];
  const ranges = edit.segments.map(({ start, end, sourceIndex = 0 }) => ({ start, end, sourceIndex }));
  if (ranges.some(({ sourceIndex }) => !Number.isInteger(sourceIndex) || sourceIndex < 0 || !files[sourceIndex])) {
    throw new Error('A video range refers to an invalid source index.');
  }

  return withMediaJobLock(async () => {
    signal.throwIfAborted();
    const ffmpeg = await getFFmpeg();
    signal.throwIfAborted();
    const stagedFiles = new Set([probeName]);
    onProgress(0);
    try {
      const sources = new Map<number, Awaited<ReturnType<typeof probeSource>>>();
      const segments = [];
      for (const { start, end, sourceIndex } of ranges) {
        let source = sources.get(sourceIndex);
        if (!source) {
          signal.throwIfAborted();
          const name = `${sourceName}-${sourceIndex}`;
          const bytes = new Uint8Array(await files[sourceIndex].arrayBuffer());
          signal.throwIfAborted();
          stagedFiles.add(name);
          await ffmpeg.writeFile(name, bytes);
          signal.throwIfAborted();
          source = await probeSource(ffmpeg, name);
          signal.throwIfAborted();
          sources.set(sourceIndex, source);
        }
        segments.push({ start, end: source.duration > 0 ? Math.min(end, source.duration) : end, source });
      }
      if (segments.some(({ start, end }) => end - start < 0.000001)) throw new Error('A video range falls outside the source.');
      const duration = segments.reduce((total, { start, end }) => total + (end - start) / edit.speed, 0);
      if (!Number.isFinite(duration) || duration < 0.000001) throw new Error('Invalid output duration.');

      const anchor = sources.get(0);
      const size = projectSize ?? (anchor ? displaySize(anchor.video) : await readAnchorSize(files[0]));
      signal.throwIfAborted();
      if (![size.width, size.height].every((value) => Number.isSafeInteger(value) && value > 0)) {
        throw new Error('Invalid project frame size.');
      }

      const args: string[] = ['-hide_banner', '-loglevel', 'info'];
      const graph: string[] = [];
      const videoLabels: string[] = [];
      const audioLabels: string[] = [];
      const audioFormat = `aformat=sample_rates=${sampleRate}:channel_layouts=stereo`;
      const activeSoundtrack = edit.audioOffset < duration ? soundtrack : null;
      const hasSourceAudio = segments.some(({ source }) => source.audio);
      let outputStart = 0;

      // Give each range a separate input seek so reordering does not buffer decoded frames from other ranges.
      for (const [index, { start, end, source }] of segments.entries()) {
        const { name, video, audio } = source;
        const native = displaySize({ ...video, sample_aspect_ratio: '1:1' });
        const fit = files.length > 1 || native.width !== size.width || native.height !== size.height ? fitFilters(size) : [];
        const length = seconds(end - start);
        args.push('-ss', seconds(start), '-i', name);
        const videoLabel = `[v${index}]`;
        videoLabels.push(videoLabel);
        const rangeVideoFilters = [
          `trim=end=${length}`,
          'settb=AVTB',
          `setpts=(PTS-STARTPTS)/${edit.speed}+${seconds(outputStart)}/TB`,
          ...fit,
        ];
        graph.push(`[${index}:${video.index}]${rangeVideoFilters.join(',')}${videoLabel}`);
        if (hasSourceAudio) {
          const audioLabel = `[a${index}]`;
          audioLabels.push(audioLabel);
          const rangeAudio = audio
            ? `[${index}:${audio.index}]aresample=${sampleRate}:async=1:first_pts=0,${audioFormat},apad`
            : `anullsrc=sample_rate=${sampleRate}:channel_layout=stereo`;
          graph.push(`${rangeAudio},atrim=duration=${length}${audioLabel}`);
        }
        outputStart += (end - start) / edit.speed;
      }

      const videoJoin = videoLabels.length > 1 ? `interleave=nb_inputs=${videoLabels.length},` : '';
      graph.push(`${videoLabels.join('')}${videoJoin}${videoFilters(edit, size).join(',')}[video]`);

      const mixLabels: string[] = [];
      const durationArg = seconds(duration);
      if (hasSourceAudio) {
        const sourceFilters = [
          ...(audioLabels.length > 1 ? [`concat=n=${audioLabels.length}:v=0:a=1`] : []),
          ...tempoFilters(edit.speed),
          `volume=${edit.volume}`,
          'apad',
          `atrim=duration=${durationArg}`,
        ];
        if (edit.fadeIn > 0) sourceFilters.push(`afade=t=in:d=${seconds(Math.min(duration, edit.fadeIn))}`);
        if (edit.fadeOut > 0) {
          const fadeLength = Math.min(duration, edit.fadeOut);
          sourceFilters.push(`afade=t=out:st=${seconds(duration - fadeLength)}:d=${seconds(fadeLength)}`);
        }
        graph.push(`${audioLabels.join('')}${sourceFilters.join(',')}[sourceAudio]`);
        mixLabels.push('[sourceAudio]');
      }
      if (activeSoundtrack) {
        args.push('-i', musicName);
        const musicFilters = [audioFormat];
        if (edit.audioOffset < 0) musicFilters.push(`atrim=start=${seconds(-edit.audioOffset)}`);
        musicFilters.push('asetpts=PTS-STARTPTS');
        if (edit.audioOffset > 0) musicFilters.push(`adelay=${Math.round(edit.audioOffset * sampleRate)}S:all=1`);
        musicFilters.push(`volume=${edit.audioVolume}`, 'apad', `atrim=duration=${durationArg}`, 'asetpts=N/SR/TB');
        graph.push(`[${segments.length}:a:0]${musicFilters.join(',')}[music]`);
        mixLabels.push('[music]');
      }
      if (mixLabels.length === 2) graph.push(`${mixLabels.join('')}amix=inputs=2:duration=first:normalize=0[audio]`);

      const output = `video-editor-export.${format}`;
      // VP9 can trap in the bundled WASM build.
      const videoCodec =
        format === 'mp4'
          ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart']
          : ['-c:v', 'libvpx', '-deadline', 'good', '-cpu-used', '4', '-crf', '10', '-b:v', '1M'];
      const audioCodec = format === 'mp4' ? 'aac' : WEBM_AUDIO_ENCODER;
      const audioMap = mixLabels.length === 2 ? '[audio]' : mixLabels[0];
      let progress = 0;
      const reportProgress = ({ time }: { time: number }) => {
        const ratio = Math.min(0.99, time / (duration * 1_000_000));
        if (ratio > progress) {
          progress = ratio;
          onProgress(ratio);
        }
      };
      ffmpeg.on('progress', reportProgress);
      try {
        const blob = await runFFmpegWithinMediaJob({
          inputs: activeSoundtrack ? [{ name: musicName, data: activeSoundtrack }] : [],
          args: [
            ...args,
            '-filter_complex',
            graph.join(';'),
            '-map',
            '[video]',
            ...videoCodec,
            '-fps_mode',
            'vfr',
            '-enc_time_base:v',
            '1:1000',
            ...(audioMap ? ['-map', audioMap, '-c:a', audioCodec, '-b:a', '128k'] : []),
            '-t',
            durationArg,
            output,
          ],
          output,
          signal,
        });
        signal.throwIfAborted();
        onProgress(1);
        return blob;
      } finally {
        ffmpeg.off('progress', reportProgress);
      }
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      if (ffmpeg.loaded) {
        for (const name of stagedFiles) {
          await ffmpeg.deleteFile(name).catch(() => undefined);
        }
      }
    }
  }, signal);
}
