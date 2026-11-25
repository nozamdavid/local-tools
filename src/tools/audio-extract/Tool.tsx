import { useState, useId, useRef } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, replaceExt } from '../../lib/format';
import { runFFmpegWithinMediaJob } from '../../lib/ffmpeg';
import { withMediabunnyFallback } from '../../lib/mediabunny';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { useI18n } from '../../lib/i18n';
import type { AudioCodec } from 'mediabunny';
import { SourcePreview } from '../../components/SourcePreview';

type AudioFormat = 'mp3' | 'aac' | 'wav';

const FORMAT_OPTIONS: { value: AudioFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'aac', label: 'AAC (.m4a)' },
  { value: 'wav', label: 'WAV (lossless, large)' },
];

const EXT: Record<AudioFormat, string> = { mp3: 'mp3', aac: 'm4a', wav: 'wav' };

const NO_AUDIO_PATTERN = /does not contain any stream|matches no streams|no audio/i;

function codecArgs(format: AudioFormat, bitrate: string): string[] {
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', `${bitrate}k`];
    case 'aac':
      return ['-c:a', 'aac', '-b:a', `${bitrate}k`];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
  }
}

export default function AudioExtractTool() {
  const { t } = useI18n();
  const meta = getToolMeta('audio-extract');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [format, setFormat] = useState<AudioFormat>('mp3');
  const [bitrate, setBitrate] = useState<string>('192');
  const metadataRequestRef = useRef(0);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const formatId = useId();
  const bitrateId = useId();

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
      setMetaError('Could not read video metadata, but you can still attempt extraction.');
    }
  };

  const handleReset = () => {
    metadataRequestRef.current += 1;
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    job.reset();
  };

  const outputFilename = file ? replaceExt(file.name, EXT[format]) : '';

  const handleExtract = () => {
    if (!file) return;

    job.run(async (setProgress) => {
      const dot = file.name.lastIndexOf('.');
      const inputExt = dot > 0 ? file.name.slice(dot).replace(/[^\w.]/g, '') : '.mp4';
      const inputName = `input${inputExt}`;
      const outputName = `output.${EXT[format]}`;
      const codec: AudioCodec = format === 'mp3' ? 'mp3' : format === 'aac' ? 'aac' : 'pcm-s16';
      const output = format === 'aac' ? 'm4a' : format;
      const audioOptions = {
        codec,
        ...(format === 'wav' ? {} : { bitrate: Number(bitrate) * 1000 }),
        forceTranscode: true,
      };

      try {
        return await withMediabunnyFallback(
          {
            input: file,
            output,
            audio: audioOptions,
            tracks: { video: 'none', audio: 'primary' },
            requireAudio: true,
            allowDiscardedTrackTypes: ['video'],
            audioEncoderFallback: format === 'wav' ? undefined : (codec as 'aac' | 'mp3'),
            onProgress: setProgress,
          },
          (onProgress) =>
            runFFmpegWithinMediaJob({
              inputs: [{ name: inputName, data: file }],
              args: ['-i', inputName, '-vn', ...codecArgs(format, bitrate), outputName],
              output: outputName,
              onProgress,
            }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (NO_AUDIO_PATTERN.test(message)) {
          throw new Error(t('This video has no audio track, so there is nothing to extract.'), { cause: err });
        }
        throw err;
      }
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="audio-extract">
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
              kind="audio"
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
                  <span className="meta-chip">
                    {t('Duration:')} <strong>{formatDuration(videoMeta.duration)}</strong>
                  </span>
                )}
              </div>

              <SourcePreview file={file} note="Source video preview. Audio encoding settings are applied during export." />

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Extracting audio...')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field label={t('Audio format')}>
                    <Select
                      id={formatId}
                      value={format}
                      onChange={(e) => setFormat(e.target.value as AudioFormat)}
                      options={FORMAT_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
                    />
                  </Field>

                  {format !== 'wav' && (
                    <details className="tool-options">
                      <summary>{t('Audio settings')}</summary>
                      <div className="tool-options-body">
                        <Field label={t('Bitrate')}>
                          <Select
                            id={bitrateId}
                            value={bitrate}
                            onChange={(e) => setBitrate(e.target.value)}
                            options={[
                              { value: '128', label: '128 kbps' },
                              { value: '192', label: '192 kbps' },
                              { value: '320', label: '320 kbps' },
                            ]}
                          />
                        </Field>
                      </div>
                    </details>
                  )}

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different file')}
                    </Button>
                    <Button variant="primary" onClick={handleExtract}>
                      {t('Extract audio')}
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
