import { useState, useId, useRef } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { runFFmpegWithinMediaJob } from '../../lib/ffmpeg';
import { withMediabunnyFallback } from '../../lib/mediabunny';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { useI18n } from '../../lib/i18n';
import { SourcePreview } from '../../components/SourcePreview';

type QualityPreset = 'high' | 'balanced' | 'small';
type MaxResolution = 'original' | '1080p' | '720p' | '480p';

const CRF_MAP: Record<QualityPreset, string> = {
  high: '23',
  balanced: '28',
  small: '32',
};

const RES_MAP: Record<Exclude<MaxResolution, 'original'>, { w: number; h: number }> = {
  '1080p': { w: 1920, h: 1080 },
  '720p': { w: 1280, h: 720 },
  '480p': { w: 854, h: 480 },
};

export default function CompressTool() {
  const { t } = useI18n();
  const meta = getToolMeta('compress');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [quality, setQuality] = useState<QualityPreset>('balanced');
  const [resolution, setResolution] = useState<MaxResolution>('original');
  const [removeAudio, setRemoveAudio] = useState<boolean>(false);
  const metadataRequestRef = useRef(0);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const qualityId = useId();
  const resolutionId = useId();
  const removeAudioId = useId();

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
      setMetaError('Could not read video metadata, but you can still attempt compression.');
    }
  };

  const handleReset = () => {
    metadataRequestRef.current += 1;
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    job.reset();
  };

  const handleCompress = () => {
    if (!file) return;

    job.run(async (setProgress) => {
      const inputExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.mp4';
      const inputName = `input${inputExt}`;
      const outputName = withSuffix(file.name, '-compressed', 'mp4');

      let vf = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
      if (resolution !== 'original') {
        const target = RES_MAP[resolution];
        vf = `scale='min(${target.w},iw)':'min(${target.h},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
      }

      const args = [
        '-i',
        inputName,
        '-vf',
        vf,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        CRF_MAP[quality],
        '-pix_fmt',
        'yuv420p',
        ...(removeAudio ? ['-an'] : ['-c:a', 'aac', '-b:a', '128k']),
        '-movflags',
        '+faststart',
        outputName,
      ];

      const qualityLevel = quality === 'high' ? 'high' : quality === 'balanced' ? 'medium' : 'low';
      const target = resolution === 'original' ? null : RES_MAP[resolution];

      return withMediabunnyFallback(
        {
          input: file,
          output: 'mp4',
          video: async (track) => {
            const width = await track.getDisplayWidth();
            const height = await track.getDisplayHeight();
            if (!target) return { codec: 'avc', quality: qualityLevel, forceTranscode: true };
            const scale = Math.min(1, target.w / width, target.h / height);
            const outputWidth = Math.max(2, Math.floor((width * scale) / 2) * 2);
            const outputHeight = Math.max(2, Math.floor((height * scale) / 2) * 2);
            return { codec: 'avc', quality: qualityLevel, forceTranscode: true, width: outputWidth, height: outputHeight, fit: 'fill' };
          },
          audio: removeAudio ? { discard: true } : { codec: 'aac', bitrate: 128_000, forceTranscode: true },
          copy: false,
          tracks: { video: 'all', audio: removeAudio ? 'none' : 'all' },
          requireVideo: true,
          audioEncoderFallback: 'aac',
          onProgress: setProgress,
        },
        (onProgress) =>
          runFFmpegWithinMediaJob({
            inputs: [{ name: inputName, data: file }],
            args,
            output: outputName,
            onProgress,
          }),
      );
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="compress">
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
              filename={withSuffix(file.name, '-compressed', 'mp4')}
              kind="video"
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

              <SourcePreview file={file} note="Source preview only. Compression quality and final file size depend on export settings." />

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Compressing video...')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field label={t('Quality')} hint={t('Balanced is a good fit for most videos.')}>
                    <Select
                      id={qualityId}
                      value={quality}
                      onChange={(e) => setQuality(e.target.value as QualityPreset)}
                      options={[
                        { value: 'high', label: t('High quality') },
                        { value: 'balanced', label: t('Balanced (recommended)') },
                        { value: 'small', label: t('Smaller file') },
                      ]}
                    />
                  </Field>

                  <details className="tool-options">
                    <summary>{t('Advanced compression settings')}</summary>
                    <div className="tool-options-body">
                      <Field label={t('Max resolution')} hint={t('Downscales if the video exceeds this size; never upscales.')}>
                        <Select
                          id={resolutionId}
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value as MaxResolution)}
                          options={[
                            { value: 'original', label: t('Original resolution') },
                            { value: '1080p', label: '1080p' },
                            { value: '720p', label: '720p' },
                            { value: '480p', label: '480p' },
                          ]}
                        />
                      </Field>

                      <div className="field">
                        <label className="checkbox-label" htmlFor={removeAudioId}>
                          <input
                            id={removeAudioId}
                            type="checkbox"
                            checked={removeAudio}
                            onChange={(e) => setRemoveAudio(e.target.checked)}
                          />
                          <span>{t('Remove audio track')}</span>
                        </label>
                      </div>
                    </div>
                  </details>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different file')}
                    </Button>
                    <Button variant="primary" onClick={handleCompress}>
                      {t('Compress video')}
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
