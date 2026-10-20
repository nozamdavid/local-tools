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
import styles from './Tool.module.css';

type PresetOption = '2160p' | '1440p' | '1080p' | '720p' | '480p' | '360p' | 'custom';
type FitMode = 'stretch' | 'fit' | 'fill';

const PRESET_HEIGHTS: Record<Exclude<PresetOption, 'custom'>, number> = {
  '2160p': 2160,
  '1440p': 1440,
  '1080p': 1080,
  '720p': 720,
  '480p': 480,
  '360p': 360,
};

function ensureEven(num: number): number {
  const rounded = Math.round(num);
  const even = Math.floor(rounded / 2) * 2;
  return Math.max(2, even);
}

export default function ResizeTool() {
  const meta = getToolMeta('resize');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [preset, setPreset] = useState<PresetOption>('1080p');
  const [customWidth, setCustomWidth] = useState<number>(1920);
  const [customHeight, setCustomHeight] = useState<number>(1080);
  const [lockAspect, setLockAspect] = useState<boolean>(true);
  const [fitMode, setFitMode] = useState<FitMode>('fit');

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const presetId = useId();
  const fitModeId = useId();
  const lockAspectId = useId();

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
      if (vMeta.width && vMeta.height) {
        setCustomWidth(ensureEven(vMeta.width));
        setCustomHeight(ensureEven(vMeta.height));
      }
    } catch {
      setMetaError('Could not read video metadata, but you can still attempt resizing.');
    }
  };

  const handleReset = () => {
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    job.reset();
  };

  // Sync custom dimensions with preset or aspect ratio
  const srcW = videoMeta?.width || 1920;
  const srcH = videoMeta?.height || 1080;
  const aspect = srcW / srcH;

  const handleCustomWidthChange = (val: number) => {
    setCustomWidth(val);
    if (lockAspect && aspect > 0) {
      setCustomHeight(ensureEven(val / aspect));
    }
  };

  const handleCustomHeightChange = (val: number) => {
    setCustomHeight(val);
    if (lockAspect && aspect > 0) {
      setCustomWidth(ensureEven(val * aspect));
    }
  };

  // Calculate target dimensions
  let targetW = 1920;
  let targetH = 1080;

  if (preset === 'custom') {
    targetW = ensureEven(customWidth || 2);
    targetH = ensureEven(customHeight || 2);
  } else {
    targetH = PRESET_HEIGHTS[preset];
    targetW = ensureEven(targetH * aspect);
  }

  const handleResize = () => {
    if (!file) return;

    job.run(async (setProgress) => {
      const inputExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.mp4';
      const inputName = `input${inputExt}`;
      const outputName = withSuffix(file.name, `-${targetW}x${targetH}`, 'mp4');

      let vf: string;
      if (preset !== 'custom' || lockAspect) {
        vf = `scale=${targetW}:${targetH}`;
      } else {
        // Custom with unlocked aspect ratio
        if (fitMode === 'stretch') {
          vf = `scale=${targetW}:${targetH}`;
        } else if (fitMode === 'fit') {
          vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2`;
        } else {
          // Fill: scale + center crop
          vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}`;
        }
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
        '23',
        '-pix_fmt',
        'yuv420p',
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-c:a',
        'copy',
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
    <ToolPage title={meta.title} description={meta.description} currentId="resize">
      {!file ? (
        <FileDrop
          accept="video/*"
          label="Choose a video or drag it here"
          hint="Resize to standard presets or custom dimensions. 100% on-device."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{metaError}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.status === 'done' && job.result ? (
            <ResultPanel
              blob={job.result}
              filename={withSuffix(file.name, `-${targetW}x${targetH}`, 'mp4')}
              kind="video"
              originalSize={file.size}
              beforePreview={
                originalUrl ? (
                  <video controls src={originalUrl} className="preview-media" playsInline />
                ) : null
              }
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
                      Source size: <strong>{videoMeta.width}x{videoMeta.height}</strong>
                    </span>
                  </>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Resizing video..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field label="Resolution preset" hint="Choose a standard resolution or enter custom dimensions.">
                    <Select
                      id={presetId}
                      value={preset}
                      onChange={(e) => setPreset(e.target.value as PresetOption)}
                      options={[
                        { value: '2160p', label: '2160p (4K UHD)' },
                        { value: '1440p', label: '1440p (QHD)' },
                        { value: '1080p', label: '1080p (Full HD)' },
                        { value: '720p', label: '720p (HD)' },
                        { value: '480p', label: '480p (SD)' },
                        { value: '360p', label: '360p (Low)' },
                        { value: 'custom', label: 'Custom dimensions' },
                      ]}
                    />
                  </Field>

                  {preset === 'custom' && (
                    <>
                      <div className={styles.row}>
                        <Field label="Width (px)">
                          <input
                            type="number"
                            min="2"
                            step="2"
                            className={styles.dimensionInput}
                            value={customWidth}
                            onChange={(e) => handleCustomWidthChange(parseInt(e.target.value, 10) || 0)}
                            onBlur={() => setCustomWidth(ensureEven(customWidth))}
                          />
                        </Field>

                        <Field label="Height (px)">
                          <input
                            type="number"
                            min="2"
                            step="2"
                            className={styles.dimensionInput}
                            value={customHeight}
                            onChange={(e) => handleCustomHeightChange(parseInt(e.target.value, 10) || 0)}
                            onBlur={() => setCustomHeight(ensureEven(customHeight))}
                          />
                        </Field>
                      </div>

                      <div className="field">
                        <label className="checkbox-label" htmlFor={lockAspectId}>
                          <input
                            id={lockAspectId}
                            type="checkbox"
                            checked={lockAspect}
                            onChange={(e) => setLockAspect(e.target.checked)}
                          />
                          <span>Lock aspect ratio</span>
                        </label>
                      </div>

                      {!lockAspect && (
                        <Field
                          label="Fit mode"
                          hint="How to adapt the video to the target resolution when aspect ratio changes."
                        >
                          <Select
                            id={fitModeId}
                            value={fitMode}
                            onChange={(e) => setFitMode(e.target.value as FitMode)}
                            options={[
                              { value: 'stretch', label: 'Stretch (distort to fill target)' },
                              { value: 'fit', label: 'Fit (letterbox with black pad)' },
                              { value: 'fill', label: 'Fill (scale + center crop)' },
                            ]}
                          />
                        </Field>
                      )}
                    </>
                  )}

                  <div className={styles.targetBox}>
                    <span className={styles.targetLabel}>Target size</span>
                    <span className={styles.targetDimensions}>{targetW}x{targetH}</span>
                  </div>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different file
                    </Button>
                    <Button variant="primary" onClick={handleResize}>
                      Resize video
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
