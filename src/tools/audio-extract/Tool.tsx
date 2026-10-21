import { useState, useId } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, replaceExt } from '../../lib/format';
import { runFFmpeg } from '../../lib/ffmpeg';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';

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
  const meta = getToolMeta('audio-extract');
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [format, setFormat] = useState<AudioFormat>('mp3');
  const [bitrate, setBitrate] = useState<string>('192');

  const job = useJob();
  const originalUrl = useObjectUrl(file);

  const formatId = useId();
  const bitrateId = useId();

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
      setMetaError('Could not read video metadata, but you can still attempt extraction.');
    }
  };

  const handleReset = () => {
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

      try {
        return await runFFmpeg({
          inputs: [{ name: inputName, data: file }],
          args: ['-i', inputName, '-vn', ...codecArgs(format, bitrate), outputName],
          output: outputName,
          onProgress: setProgress,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (NO_AUDIO_PATTERN.test(message)) {
          throw new Error('This video has no audio track, so there is nothing to extract.', { cause: err });
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
              filename={outputFilename}
              kind="audio"
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
                  <span className="meta-chip">
                    Duration: <strong>{formatDuration(videoMeta.duration)}</strong>
                  </span>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Extracting audio..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field label="Audio format" hint={`Saved as ${outputFilename}`}>
                    <Select
                      id={formatId}
                      value={format}
                      onChange={(e) => setFormat(e.target.value as AudioFormat)}
                      options={FORMAT_OPTIONS}
                    />
                  </Field>

                  {format !== 'wav' && (
                    <Field label="Bitrate">
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
                  )}

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Choose different file
                    </Button>
                    <Button variant="primary" onClick={handleExtract}>
                      Extract audio
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
