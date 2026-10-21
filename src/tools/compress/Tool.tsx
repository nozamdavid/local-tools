import { useState, useId } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { runFFmpeg } from '../../lib/ffmpeg';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';

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
  const meta = getToolMeta('compress');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [quality, setQuality] = useState<QualityPreset>('balanced');
  const [resolution, setResolution] = useState<MaxResolution>('original');
  const [removeAudio, setRemoveAudio] = useState<boolean>(false);

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const qualityId = useId();
  const resolutionId = useId();
  const removeAudioId = useId();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setMetaError(null);
    setVideoMeta(null);
    job.reset();

    try {
      const vMeta = await getVideoMeta(selected);
      setVideoMeta(vMeta);
    } catch {
      setMetaError('Could not read video metadata, but you can still attempt compression.');
    }
  };

  const handleReset = () => {
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

      return await runFFmpeg({
        inputs: [{ name: inputName, data: file }],
        args,
        output: outputName,
        onProgress: setProgress,
      });
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="compress">
      {!file ? (
        <FileDrop
          accept="video/*"
          label="Choose a video or drag it here"
          hint="Supports MP4, MOV, WebM, MKV, AVI and more."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{metaError}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

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
                  Name: <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  Size: <strong>{formatBytes(file.size)}</strong>
                </span>
                {videoMeta && (
                  <>
                    <span className="meta-chip">
                      Duration: <strong>{formatDuration(videoMeta.duration)}</strong>
                    </span>
                    <span className="meta-chip">
                      Resolution:{' '}
                      <strong>
                        {videoMeta.width}x{videoMeta.height}
                      </strong>
                    </span>
                  </>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Compressing video..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field label="Quality preset" hint="Balanced offers high visual fidelity with significant size reduction.">
                    <Select
                      id={qualityId}
                      value={quality}
                      onChange={(e) => setQuality(e.target.value as QualityPreset)}
                      options={[
                        { value: 'high', label: 'High (CRF 23 - larger file, best quality)' },
                        { value: 'balanced', label: 'Balanced (CRF 28 - recommended)' },
                        { value: 'small', label: 'Small (CRF 32 - smallest file)' },
                      ]}
                    />
                  </Field>

                  <Field label="Max resolution" hint="Downscales if video exceeds target; never upscales.">
                    <Select
                      id={resolutionId}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value as MaxResolution)}
                      options={[
                        { value: 'original', label: 'Original resolution' },
                        { value: '1080p', label: '1080p (Full HD)' },
                        { value: '720p', label: '720p (HD)' },
                        { value: '480p', label: '480p (SD)' },
                      ]}
                    />
                  </Field>

                  <div className="field">
                    <label className="checkbox-label" htmlFor={removeAudioId}>
                      <input id={removeAudioId} type="checkbox" checked={removeAudio} onChange={(e) => setRemoveAudio(e.target.checked)} />
                      <span>Remove audio track</span>
                    </label>
                  </div>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different file
                    </Button>
                    <Button variant="primary" onClick={handleCompress}>
                      Compress video
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
