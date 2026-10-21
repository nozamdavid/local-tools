import { useState, useId } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { runFFmpeg } from '../../lib/ffmpeg';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import styles from './Tool.module.css';

type OriginalAudioMode = 'keep' | 'replace';

async function detectAudio(file: File, meta?: VideoMeta): Promise<boolean> {
  if (meta?.hasAudio === true) {
    return true;
  }
  try {
    const slice = await file.slice(0, 2 * 1024 * 1024).arrayBuffer();
    const bytes = new Uint8Array(slice);
    const text = new TextDecoder('latin1').decode(bytes);
    if (text.includes('soun') || text.includes('mp4a') || text.includes('A_VORBIS') || text.includes('A_OPUS') || text.includes('A_AAC')) {
      return true;
    }
  } catch {
    // fallback
  }
  return false;
}

export default function AddSoundtrackTool() {
  const meta = getToolMeta('add-soundtrack');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [hasAudio, setHasAudio] = useState<boolean | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [musicVolume, setMusicVolume] = useState<number>(100);
  const [originalAudioMode, setOriginalAudioMode] = useState<OriginalAudioMode>('keep');
  const [loopMusic, setLoopMusic] = useState<boolean>(true);
  const [fadeOut, setFadeOut] = useState<boolean>(false);

  const job = useJob();
  const videoUrl = useObjectUrl(videoFile);

  const originalAudioId = useId();
  const loopMusicId = useId();
  const fadeOutId = useId();

  const handleVideoFile = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setVideoFile(selected);
    setMetaError(null);
    setVideoMeta(null);
    setHasAudio(null);
    job.reset();

    try {
      const vMeta = await getVideoMeta(selected);
      setVideoMeta(vMeta);
      const audioExists = await detectAudio(selected, vMeta);
      setHasAudio(audioExists);
    } catch {
      const audioExists = await detectAudio(selected);
      setHasAudio(audioExists);
      setMetaError('Could not read video metadata, but you can still attempt processing.');
    }
  };

  const handleAudioFile = (files: File[]) => {
    if (files.length === 0) return;
    setAudioFile(files[0]);
    job.reset();
  };

  const handleReset = () => {
    setVideoFile(null);
    setAudioFile(null);
    setVideoMeta(null);
    setHasAudio(null);
    setMetaError(null);
    job.reset();
  };

  const handleAddSoundtrack = () => {
    if (!videoFile || !audioFile) return;

    job.run(async (setProgress) => {
      const vExt = videoFile.name.includes('.') ? videoFile.name.slice(videoFile.name.lastIndexOf('.')) : '.mp4';
      const aExt = audioFile.name.includes('.') ? audioFile.name.slice(audioFile.name.lastIndexOf('.')) : '.mp3';

      const inputVideoName = `input_video${vExt}`;
      const inputAudioName = `input_audio${aExt}`;
      const outputName = withSuffix(videoFile.name, '-soundtrack', 'mp4');

      const videoDuration = videoMeta?.duration && videoMeta.duration > 0 ? videoMeta.duration : 10;
      const fadeStart = Math.max(0, videoDuration - 2);

      const volFilter = `volume=${(musicVolume / 100).toFixed(2)}`;
      const fadeFilter = fadeOut ? `,afade=t=out:st=${fadeStart.toFixed(2)}:d=2` : '';
      const musicFilters = `${volFilter}${fadeFilter}`;

      const audioTrackPresent = hasAudio !== false;
      const shouldMix = audioTrackPresent && originalAudioMode === 'keep';

      let filterComplex: string;
      if (shouldMix) {
        filterComplex = `[1:a]${musicFilters}[mus];[0:a:0][mus]amix=inputs=2:duration=first:normalize=0[aout]`;
      } else {
        filterComplex = `[1:a]${musicFilters}[aout]`;
      }

      const args: string[] = ['-i', inputVideoName];

      if (loopMusic) {
        args.push('-stream_loop', '-1');
      }
      args.push('-i', inputAudioName);

      args.push(
        '-filter_complex',
        filterComplex,
        '-map',
        '0:v:0',
        '-map',
        '[aout]',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        '-movflags',
        '+faststart',
        outputName,
      );

      return await runFFmpeg({
        inputs: [
          { name: inputVideoName, data: videoFile },
          { name: inputAudioName, data: audioFile },
        ],
        args,
        output: outputName,
        onProgress: setProgress,
      });
    });
  };

  const isRelevantOriginalAudio = hasAudio !== false;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="add-soundtrack">
      {!videoFile ? (
        <div>
          <div className={styles.sectionTitle}>Step 1: Select Video</div>
          <FileDrop
            accept="video/*"
            label="Choose a video or drag it here"
            hint="Supports MP4, WebM, MOV, and more."
            onFiles={handleVideoFile}
          />
        </div>
      ) : (
        <div>
          {metaError && <div className="error-banner">{metaError}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.status === 'done' && job.result ? (
            <ResultPanel
              blob={job.result}
              filename={withSuffix(videoFile.name, '-soundtrack', 'mp4')}
              kind="video"
              originalSize={videoFile.size}
              beforePreview={videoUrl ? <video controls src={videoUrl} className="preview-media" playsInline /> : null}
              onReset={handleReset}
            />
          ) : (
            <div>
              <div className={styles.fileCard}>
                <div className={styles.fileDetails}>
                  <div className={styles.fileTitle}>Video: {videoFile.name}</div>
                  <div className={styles.fileSub}>
                    {formatBytes(videoFile.size)}
                    {videoMeta && ` • ${formatDuration(videoMeta.duration)} • ${videoMeta.width}x${videoMeta.height}`}
                    {hasAudio === false && ' • (No audio)'}
                  </div>
                </div>
                <Button variant="secondary" onClick={() => setVideoFile(null)}>
                  Change video
                </Button>
              </div>

              {!audioFile ? (
                <div style={{ marginTop: '1.5rem' }}>
                  <div className={styles.sectionTitle}>Step 2: Select Audio / Soundtrack</div>
                  <FileDrop
                    accept="audio/*"
                    label="Choose an audio track or drag it here"
                    hint="Supports MP3, WAV, AAC, OGG, and more."
                    onFiles={handleAudioFile}
                  />
                </div>
              ) : (
                <div>
                  <div className={styles.fileCard}>
                    <div className={styles.fileDetails}>
                      <div className={styles.fileTitle}>Soundtrack: {audioFile.name}</div>
                      <div className={styles.fileSub}>{formatBytes(audioFile.size)}</div>
                    </div>
                    <Button variant="secondary" onClick={() => setAudioFile(null)}>
                      Change audio
                    </Button>
                  </div>

                  {job.status === 'running' ? (
                    <ProgressBar value={job.progress} label="Adding soundtrack..." />
                  ) : (
                    <div style={{ marginTop: '1.5rem' }}>
                      <Field label="Music volume" hint="Adjust volume level of the added soundtrack.">
                        <Slider value={musicVolume} min={0} max={200} step={5} unit="%" onChange={setMusicVolume} />
                      </Field>

                      {isRelevantOriginalAudio && (
                        <Field
                          label="Original audio"
                          hint="Choose whether to keep and mix the video's original sound or replace it entirely."
                        >
                          <Select
                            id={originalAudioId}
                            value={originalAudioMode}
                            onChange={(e) => setOriginalAudioMode(e.target.value as OriginalAudioMode)}
                            options={[
                              { value: 'keep', label: 'Keep and mix original audio' },
                              { value: 'replace', label: 'Replace original audio' },
                            ]}
                          />
                        </Field>
                      )}

                      <div className="field">
                        <label className="checkbox-label" htmlFor={loopMusicId}>
                          <input id={loopMusicId} type="checkbox" checked={loopMusic} onChange={(e) => setLoopMusic(e.target.checked)} />
                          <span>Loop music to fit video</span>
                        </label>
                      </div>

                      <div className="field">
                        <label className="checkbox-label" htmlFor={fadeOutId}>
                          <input id={fadeOutId} type="checkbox" checked={fadeOut} onChange={(e) => setFadeOut(e.target.checked)} />
                          <span>Fade out last 2 seconds</span>
                        </label>
                      </div>

                      <div className="action-buttons" style={{ marginTop: '2rem' }}>
                        <Button variant="secondary" onClick={handleReset}>
                          Start over
                        </Button>
                        <Button variant="primary" onClick={handleAddSoundtrack}>
                          Add soundtrack
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
