import { useState, useId, useRef } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, replaceExt } from '../../lib/format';
import { runFFmpeg, runFFmpegWithinMediaJob } from '../../lib/ffmpeg';
import { convertTransparentWebm } from '../../lib/transparentWebm';
import { withMediabunnyFallback, type MediabunnyOptions, type MediabunnyOutput } from '../../lib/mediabunny';
import type { AudioCodec, VideoCodec } from 'mediabunny';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { useI18n } from '../../lib/i18n';
import { SourcePreview } from '../../components/SourcePreview';

type OutputFormat = 'mp4' | 'webm' | 'mov' | 'mkv' | 'avi' | 'gif';
type GifWidth = 'original' | '480' | '320';

const FORMAT_OPTIONS: { value: OutputFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4 (H.264 / AAC)' },
  { value: 'webm', label: 'WebM' },
  { value: 'mov', label: 'MOV (H.264 / AAC)' },
  { value: 'mkv', label: 'MKV' },
  { value: 'avi', label: 'AVI (MPEG-4 / MP3)' },
  { value: 'gif', label: 'GIF (animated image)' },
];

const COPY_FORMATS: OutputFormat[] = ['mp4', 'mov', 'mkv'];

const H264_ARGS = [
  '-vf',
  'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '23',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
];

function buildEncodeArgs(format: OutputFormat, fastCopy: boolean, gifFps: string, gifWidth: GifWidth): string[] {
  if (COPY_FORMATS.includes(format) && fastCopy) {
    return format === 'mp4' ? ['-c', 'copy', '-movflags', '+faststart'] : ['-c', 'copy'];
  }

  switch (format) {
    case 'mp4':
      return [...H264_ARGS, '-movflags', '+faststart'];
    case 'mov':
    case 'mkv':
      return H264_ARGS;
    case 'webm':
      return [
        '-c:v',
        // libvpx-vp9 corrupts memory or crashes the tab in ffmpeg.wasm 0.12, so WebM uses VP8.
        'libvpx',
        '-deadline',
        'good',
        '-cpu-used',
        '4',
        '-b:v',
        '1M',
        '-crf',
        '10',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'libopus',
        '-b:a',
        '96k',
      ];
    case 'avi':
      return ['-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p', '-c:a', 'libmp3lame', '-q:a', '4'];
    case 'gif': {
      const scale = gifWidth === 'original' ? '' : `scale=${gifWidth}:-2:flags=lanczos,`;
      return ['-vf', `fps=${gifFps},${scale}split[a][b];[a]palettegen[p];[b][p]paletteuse`, '-an', '-loop', '0'];
    }
  }
}

export default function ConvertTool() {
  const { t } = useI18n();
  const meta = getToolMeta('convert');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [format, setFormat] = useState<OutputFormat>('mp4');
  const [fastCopy, setFastCopy] = useState<boolean>(false);
  const [gifFps, setGifFps] = useState<string>('15');
  const [gifWidth, setGifWidth] = useState<GifWidth>('480');
  const metadataRequestRef = useRef(0);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const formatId = useId();
  const fastCopyId = useId();
  const gifFpsId = useId();
  const gifWidthId = useId();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    const requestId = ++metadataRequestRef.current;
    setFile(selected);
    setMetaError(null);
    setVideoMeta(null);
    job.reset();

    try {
      const vMeta = await getVideoMeta(selected);
      if (requestId !== metadataRequestRef.current) return;
      setVideoMeta(vMeta);
    } catch {
      if (requestId !== metadataRequestRef.current) return;
      setMetaError('Could not read video metadata, but you can still attempt conversion.');
    }
  };

  const handleReset = () => {
    metadataRequestRef.current += 1;
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    job.reset();
  };

  const outputFilename = file ? replaceExt(file.name, format) : '';

  const handleConvert = () => {
    if (!file) return;

    job.run(async (setProgress) => {
      const transparent = await convertTransparentWebm(file, format, setProgress);
      if (transparent) return transparent;

      const dot = file.name.lastIndexOf('.');
      const inputExt = dot > 0 ? file.name.slice(dot).replace(/[^\w.]/g, '') : '.mp4';
      const inputName = `input${inputExt}`;
      const outputName = `output.${format}`;

      if (format === 'gif' || format === 'avi') {
        return runFFmpeg({
          inputs: [{ name: inputName, data: file }],
          args: ['-i', inputName, ...buildEncodeArgs(format, fastCopy, gifFps, gifWidth), outputName],
          output: outputName,
          onProgress: setProgress,
        });
      }

      const output = format as MediabunnyOutput;
      const videoCodec: VideoCodec = output === 'webm' ? 'vp8' : 'avc';
      const audioCodec: AudioCodec = output === 'webm' ? 'opus' : 'aac';
      const nativeOptions: Pick<MediabunnyOptions, 'copy' | 'video' | 'audio'> = fastCopy
        ? { copy: { mode: 'forced' as const } }
        : {
            video: {
              codec: videoCodec,
              ...(output === 'webm' ? { bitrate: 1_000_000 } : { quality: 'high' as const }),
              forceTranscode: true,
            },
            audio: {
              codec: audioCodec,
              bitrate: output === 'webm' ? 96_000 : 128_000,
              forceTranscode: true,
            },
          };

      return withMediabunnyFallback(
        {
          input: file,
          output,
          ...nativeOptions,
          tracks: { video: 'all', audio: 'all' },
          requireVideo: true,
          audioEncoderFallback: audioCodec === 'aac' ? 'aac' : undefined,
          onProgress: setProgress,
        },
        (onProgress) =>
          runFFmpegWithinMediaJob({
            inputs: [{ name: inputName, data: file }],
            args: ['-i', inputName, ...buildEncodeArgs(format, fastCopy, gifFps, gifWidth), outputName],
            output: outputName,
            onProgress,
          }),
      );
    });
  };

  const canCopy = COPY_FORMATS.includes(format);

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="convert">
      {!file ? (
        <FileDrop
          accept="video/*"
          label={t('Choose a video or drag it here')}
          hint={t('Supports MP4, MOV, WebM, MKV, AVI and more.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{t(metaError)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          {job.status === 'done' && job.result ? (
            <ResultPanel
              blob={job.result}
              filename={outputFilename}
              kind={format === 'gif' ? 'image' : 'video'}
              originalSize={file.size}
              beforePreview={originalUrl ? <video controls src={originalUrl} className="preview-media" playsInline /> : null}
              onReset={handleReset}
            />
          ) : (
            <div>
              <div className="meta-chips">
                <span className="meta-chip">
                  {t('Name:')} <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  {t('Size:')} <strong>{formatBytes(file.size)}</strong>
                </span>
                {videoMeta && (
                  <>
                    <span className="meta-chip">
                      {t('Duration:')} <strong>{formatDuration(videoMeta.duration)}</strong>
                    </span>
                    <span className="meta-chip">
                      {t('Resolution:')}{' '}
                      <strong>
                        {videoMeta.width}x{videoMeta.height}
                      </strong>
                    </span>
                  </>
                )}
              </div>

              <SourcePreview
                file={file}
                note="Source preview only. The selected output format, codec, and quality are applied during export."
              />

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Converting video...')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field label={t('Output format')} hint={t('Saved as {filename}', { filename: outputFilename })}>
                    <Select
                      id={formatId}
                      value={format}
                      onChange={(e) => setFormat(e.target.value as OutputFormat)}
                      options={FORMAT_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
                    />
                  </Field>

                  {canCopy && (
                    <details className="tool-options">
                      <summary>{t('Advanced encoding options')}</summary>
                      <div className="tool-options-body">
                        <div className="field">
                          <label className="checkbox-label" htmlFor={fastCopyId}>
                            <input id={fastCopyId} type="checkbox" checked={fastCopy} onChange={(e) => setFastCopy(e.target.checked)} />
                            <span>{t('Fast copy (no re-encode)')}</span>
                          </label>
                          <p className="field-hint">
                            {t('Copies the streams as they are. This may fail if the source codecs do not fit the new container.')}
                          </p>
                        </div>
                      </div>
                    </details>
                  )}

                  {format === 'gif' && (
                    <>
                      <Field label={t('Frame rate')}>
                        <Select
                          id={gifFpsId}
                          value={gifFps}
                          onChange={(e) => setGifFps(e.target.value)}
                          options={[
                            { value: '10', label: '10 fps' },
                            { value: '15', label: '15 fps' },
                            { value: '20', label: '20 fps' },
                          ]}
                        />
                      </Field>

                      <Field label={t('Width')} hint={t('GIFs get large quickly; smaller widths keep the file manageable.')}>
                        <Select
                          id={gifWidthId}
                          value={gifWidth}
                          onChange={(e) => setGifWidth(e.target.value as GifWidth)}
                          options={[
                            { value: 'original', label: t('Original width') },
                            { value: '480', label: '480 px' },
                            { value: '320', label: '320 px' },
                          ]}
                        />
                      </Field>
                    </>
                  )}

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different file')}
                    </Button>
                    <Button variant="primary" onClick={handleConvert}>
                      {t('Convert to {format}', { format: format.toUpperCase() })}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
