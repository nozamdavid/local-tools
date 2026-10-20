import { useState } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { runFFmpeg } from '../../lib/ffmpeg';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';

const KEEP_EXTS = ['mp4', 'mov', 'mkv', 'webm'];

function plan(filename: string): { ext: string; copy: boolean } {
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
  return KEEP_EXTS.includes(ext) ? { ext, copy: true } : { ext: 'mp4', copy: false };
}

export default function RemoveAudioTool() {
  const meta = getToolMeta('remove-audio');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

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
      setMetaError('Could not read video metadata, but you can still attempt removal.');
    }
  };

  const handleReset = () => {
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

      return await runFFmpeg({
        inputs: [{ name: inputName, data: file }],
        args,
        output: outputName,
        onProgress: setProgress,
      });
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="remove-audio">
      {!file ? (
        <FileDrop
          accept="video/*"
          label="Choose a video or drag it here"
          hint="Supports MP4, MOV, WebM, MKV, AVI and more. 100% on-device."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {metaError && <div className="error-banner">{metaError}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.status === 'done' && job.result ? (
            <ResultPanel
              blob={job.result}
              filename={outputFilename}
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
                      Resolution: <strong>{videoMeta.width}x{videoMeta.height}</strong>
                    </span>
                  </>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Removing audio..." />
              ) : (
                <div className="action-buttons" style={{ marginTop: '2rem' }}>
                  <Button variant="secondary" onClick={handleReset}>
                    Choose different file
                  </Button>
                  <Button variant="primary" onClick={handleRemove}>
                    Remove audio
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
