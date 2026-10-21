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

export default function LoopTool() {
  const meta = getToolMeta('loop');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [loopCount, setLoopCount] = useState<number>(2);

  const loopId = useId();
  const job = useJob();
  const originalUrl = useObjectUrl(file);

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
      setMetaError('Could not read video metadata, but you can still attempt looping.');
    }
  };

  const handleReset = () => {
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    job.reset();
  };

  const handleLoop = () => {
    if (!file) return;

    job.run(async (setProgress) => {
      const inputExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.mp4';
      const inputName = `input${inputExt}`;
      const outputSuffix = `-loop${loopCount}x`;
      const outputName = withSuffix(file.name, outputSuffix, 'mp4');
      const streamLoopArg = String(loopCount - 1);

      // Attempt 1: fast stream copy
      try {
        const copyArgs = ['-stream_loop', streamLoopArg, '-i', inputName, '-c', 'copy', '-movflags', '+faststart', outputName];

        return await runFFmpeg({
          inputs: [{ name: inputName, data: file }],
          args: copyArgs,
          output: outputName,
          onProgress: setProgress,
        });
      } catch {
        // Attempt 2: fallback to re-encode
        const encodeArgs = [
          '-stream_loop',
          streamLoopArg,
          '-i',
          inputName,
          '-map',
          '0:v:0',
          '-map',
          '0:a?',
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
          '-movflags',
          '+faststart',
          outputName,
        ];

        return await runFFmpeg({
          inputs: [{ name: inputName, data: file }],
          args: encodeArgs,
          output: outputName,
          onProgress: setProgress,
        });
      }
    });
  };

  const resultingDuration = videoMeta ? videoMeta.duration * loopCount : 0;
  const loopOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => ({
    value: String(num),
    label: `${num} times (${num}x)`,
  }));

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="loop">
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
              filename={withSuffix(file.name, `-loop${loopCount}x`, 'mp4')}
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
                <ProgressBar value={job.progress} label="Looping video..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <div className={styles.videoContainer}>
                    {originalUrl && <video src={originalUrl} controls playsInline className="preview-media" />}
                  </div>

                  {resultingDuration > 0 && (
                    <div className={styles.durationBadge}>
                      <span>Resulting duration:</span>
                      <strong>{formatDuration(resultingDuration)}</strong>
                      <span>({resultingDuration.toFixed(1)}s)</span>
                    </div>
                  )}

                  <Field
                    label="Loop count"
                    hint="Number of times to repeat the video. Tries fast bitstream concatenation first, with automatic re-encode fallback."
                  >
                    <Select
                      id={loopId}
                      value={String(loopCount)}
                      onChange={(e) => setLoopCount(parseInt(e.target.value, 10))}
                      options={loopOptions}
                    />
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different file
                    </Button>
                    <Button variant="primary" onClick={handleLoop}>
                      Loop video
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
