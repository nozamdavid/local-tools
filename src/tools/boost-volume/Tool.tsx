import { useState, useId, useRef } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Slider, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { runFFmpeg, runFFmpegWithinMediaJob } from '../../lib/ffmpeg';
import { createAudioGainProcessor, withMediabunnyFallback } from '../../lib/mediabunny';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { useI18n } from '../../lib/i18n';
import { SourcePreview } from '../../components/SourcePreview';

async function detectAudio(file: File, meta?: VideoMeta): Promise<boolean> {
  if (meta?.hasAudio === true) {
    return true;
  }
  try {
    // Phone recordings often keep the MP4 index (moov) at the end, so scan both ends.
    const chunk = 2 * 1024 * 1024;
    const head = await file.slice(0, chunk).arrayBuffer();
    const tail = file.size > chunk ? await file.slice(-chunk).arrayBuffer() : new ArrayBuffer(0);
    const decoder = new TextDecoder('latin1');
    const text = decoder.decode(head) + decoder.decode(tail);
    if (text.includes('soun') || text.includes('mp4a') || text.includes('A_VORBIS') || text.includes('A_OPUS') || text.includes('A_AAC')) {
      return true;
    }
  } catch {
    // fallback
  }
  return false;
}

export default function BoostVolumeTool() {
  const { t } = useI18n();
  const meta = getToolMeta('boost-volume');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [hasAudio, setHasAudio] = useState<boolean | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [gain, setGain] = useState<number>(200);
  const [normalizeLoudness, setNormalizeLoudness] = useState<boolean>(false);
  const metadataRequestRef = useRef(0);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const normalizeId = useId();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    const requestId = ++metadataRequestRef.current;
    setFile(selected);
    setMetaError(null);
    setVideoMeta(null);
    setHasAudio(null);
    job.reset();

    try {
      const vMeta = await getVideoMeta(selected);
      if (requestId !== metadataRequestRef.current) return;
      setVideoMeta(vMeta);
      const audioExists = await detectAudio(selected, vMeta);
      if (requestId !== metadataRequestRef.current) return;
      setHasAudio(audioExists);
      if (!audioExists) {
        setMetaError('This video has no audio track to boost.');
      }
    } catch {
      const audioExists = await detectAudio(selected);
      if (requestId !== metadataRequestRef.current) return;
      setHasAudio(audioExists);
      if (!audioExists) {
        setMetaError('This video has no audio track to boost.');
      }
    }
  };

  const handleReset = () => {
    metadataRequestRef.current += 1;
    setFile(null);
    setVideoMeta(null);
    setHasAudio(null);
    setMetaError(null);
    job.reset();
  };

  const handleBoost = () => {
    if (!file) return;

    if (hasAudio === false) {
      setMetaError('This video does not have an audio track to boost.');
      return;
    }

    job.run(async (setProgress) => {
      const inputExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.mp4';
      const inputName = `input${inputExt}`;
      const outputName = withSuffix(file.name, '-louder', 'mp4');

      let af: string;
      if (normalizeLoudness) {
        af = 'loudnorm=I=-14:TP=-1:LRA=11';
      } else {
        const factor = gain / 100;
        if (gain > 100) {
          af = `volume=${factor.toFixed(2)},alimiter=limit=0.95`;
        } else {
          af = `volume=${factor.toFixed(2)}`;
        }
      }

      const args = [
        '-i',
        inputName,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-c:v',
        'copy',
        '-af',
        af,
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        outputName,
      ];

      try {
        if (normalizeLoudness) {
          return await runFFmpeg({
            inputs: [{ name: inputName, data: file }],
            args,
            output: outputName,
            onProgress: setProgress,
          });
        }

        return await withMediabunnyFallback(
          {
            input: file,
            output: 'mp4',
            video: {},
            audio: {
              codec: 'aac',
              bitrate: 192_000,
              forceTranscode: true,
              process: createAudioGainProcessor(gain / 100, gain > 100 ? 0.95 : null),
            },
            tracks: { video: 'primary', audio: 'primary' },
            requireAudio: true,
            requireVideo: true,
            allowDiscardedTrackTypes: ['subtitle'],
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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('matches no streams') || msg.includes('does not contain any stream')) {
          throw new Error(t('This video does not have an audio track to boost.'), { cause: err });
        }
        throw err;
      }
    });
  };

  const isSilent = hasAudio === false;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="boost-volume">
      {!file ? (
        <FileDrop
          accept="video/*"
          label={t('Choose a video or drag it here')}
          hint={t('Boost volume up to 400% or normalize loudness.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{t(metaError)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          {job.status === 'done' && job.result ? (
            <ResultPanel
              blob={job.result}
              filename={withSuffix(file.name, '-louder', 'mp4')}
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
                {hasAudio !== null && (
                  <span className="meta-chip">
                    {t('Audio:')} <strong>{hasAudio ? t('Audio track detected') : t('No audio track')}</strong>
                  </span>
                )}
              </div>

              <SourcePreview file={file} note="Source preview only. Gain and loudness normalization are applied during export." />

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Boosting volume...')} />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <div className="field">
                    <label className="checkbox-label" htmlFor={normalizeId}>
                      <input
                        id={normalizeId}
                        type="checkbox"
                        checked={normalizeLoudness}
                        onChange={(e) => setNormalizeLoudness(e.target.checked)}
                      />
                      <span>{t('Normalize loudness (EBU R128 standard)')}</span>
                    </label>
                  </div>

                  {!normalizeLoudness && (
                    <Field
                      label={t('Volume gain')}
                      hint={t('Values above 100% boost volume with a limiter to prevent clipping distortion.')}
                    >
                      <Slider value={gain} min={0} max={400} step={5} unit="%" onChange={setGain} disabled={normalizeLoudness} />
                    </Field>
                  )}

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different file')}
                    </Button>
                    <Button variant="primary" onClick={handleBoost} disabled={isSilent}>
                      {t('Boost volume')}
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
