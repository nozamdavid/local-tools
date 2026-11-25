import { useState, useRef } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { runFFmpegWithinMediaJob } from '../../lib/ffmpeg';
import { withMediabunnyFallback, type MediabunnyOutput } from '../../lib/mediabunny';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { useI18n } from '../../lib/i18n';
import { SourcePreview } from '../../components/SourcePreview';

const KEEP_EXTS = ['mp4', 'mov', 'mkv', 'webm'];

function plan(filename: string): { ext: string; copy: boolean } {
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
  return KEEP_EXTS.includes(ext) ? { ext, copy: true } : { ext: 'mp4', copy: false };
}

export default function RemoveAudioTool() {
  const { t } = useI18n();
  const meta = getToolMeta('remove-audio');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const metadataRequestRef = useRef(0);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

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
      setMetaError('Could not read video metadata, but you can still attempt removal.');
    }
  };

  const handleReset = () => {
    metadataRequestRef.current += 1;
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    job.reset();
  };

  const { ext, copy } = file ? plan(file.name) : { ext: 'mp4', copy: false };
  const outputFilename = file ? withSuffix(file.name, '-muted', ext) : '';

  const handleRemove = () => {
    if (!file) return;

    job.run(async (setProgress) => {
      const dot = file.name.lastIndexOf('.');
      const inputExt = dot > 0 ? file.name.slice(dot).replace(/[^\w.]/g, '') : '.mp4';
      const inputName = `input${inputExt}`;
      const outputName = `output.${ext}`;

      const args = copy
        ? ['-i', inputName, '-c:v', 'copy', '-an', outputName]
        : [
            '-i',
            inputName,
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
            '-an',
            '-movflags',
            '+faststart',
            outputName,
          ];

      const nativeVideo = copy ? undefined : { codec: 'avc' as const, quality: 'high' as const, forceTranscode: true };

      return withMediabunnyFallback(
        {
          input: file,
          output: ext as MediabunnyOutput,
          ...(copy ? { copy: { mode: 'forced' as const } } : { video: nativeVideo }),
          tracks: { video: 'primary', audio: 'none' },
          requireVideo: true,
          allowDiscardedTrackTypes: ['audio', 'subtitle'],
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
    <ToolPage title={meta.title} description={meta.description} currentId="remove-audio">
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

              <SourcePreview file={file} note="Source preview only. Audio removal is applied during export." />

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Removing audio...')} />
              ) : (
                <div className="action-buttons" style={{ marginTop: '2rem' }}>
                  <Button variant="secondary" onClick={handleReset}>
                    {t('Choose different file')}
                  </Button>
                  <Button variant="primary" onClick={handleRemove}>
                    {t('Remove audio')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
