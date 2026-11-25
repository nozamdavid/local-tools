import { useState, useId, useRef } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { detectVideoAudio, getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { runFFmpeg } from '../../lib/ffmpeg';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { useI18n } from '../../lib/i18n';
import styles from './Tool.module.css';
import { SourcePreview } from '../../components/SourcePreview';

type OriginalAudioMode = 'keep' | 'replace';

export default function AddSoundtrackTool() {
  const { t } = useI18n();
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
  const metadataRequestRef = useRef(0);

  const job = useJob();
  const videoUrl = useObjectUrl(videoFile);

  const originalAudioId = useId();
  const loopMusicId = useId();
  const fadeOutId = useId();

  const handleVideoFile = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    const requestId = ++metadataRequestRef.current;
    setVideoFile(selected);
    setMetaError(null);
    setVideoMeta(null);
    setHasAudio(null);
    job.reset();

    try {
      const vMeta = await getVideoMeta(selected);
      if (requestId !== metadataRequestRef.current) return;
      setVideoMeta(vMeta);
      const audioExists = await detectVideoAudio(selected, vMeta);
      if (requestId !== metadataRequestRef.current) return;
      setHasAudio(audioExists);
    } catch {
      const audioExists = await detectVideoAudio(selected);
      if (requestId !== metadataRequestRef.current) return;
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
    metadataRequestRef.current += 1;
    setVideoFile(null);
    setAudioFile(null);
    setVideoMeta(null);
    setHasAudio(null);
    setMetaError(null);
    job.reset();
  };

  const handleChangeVideo = () => {
    metadataRequestRef.current += 1;
    setVideoFile(null);
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

      const shouldMix = originalAudioMode === 'keep' && (hasAudio ?? (await detectVideoAudio(videoFile, videoMeta ?? undefined)));

      let filterComplex: string;
      if (shouldMix) {
        filterComplex = `[1:a:0]${musicFilters}[mus];[0:a:0][mus]amix=inputs=2:duration=longest:normalize=0,apad[aout]`;
      } else {
        filterComplex = `[1:a:0]${musicFilters},apad[aout]`;
      }

      const args: string[] = ['-i', inputVideoName];

      if (loopMusic) {
        args.push('-stream_loop', '-1');
      }
      args.push('-i', inputAudioName);

      const run = (videoCodecArgs: string[]) =>
        runFFmpeg({
          inputs: [
            { name: inputVideoName, data: videoFile },
            { name: inputAudioName, data: audioFile },
          ],
          args: [
            ...args,
            '-filter_complex',
            filterComplex,
            '-map',
            '0:v:0',
            '-map',
            '[aout]',
            ...videoCodecArgs,
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-shortest',
            '-movflags',
            '+faststart',
            outputName,
          ],
          output: outputName,
          onProgress: setProgress,
        });

      try {
        return await run(['-c:v', 'copy']);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('codec not currently supported in container')) throw error;
        return run(['-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p']);
      }
    });
  };

  const isRelevantOriginalAudio = hasAudio !== false;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="add-soundtrack">
      {!videoFile ? (
        <div>
          <div className={styles.sectionTitle}>{t('Step 1: Select Video')}</div>
          <FileDrop
            accept="video/*"
            label={t('Choose a video or drag it here')}
            hint={t('Supports MP4, WebM, MOV, and more.')}
            onFiles={handleVideoFile}
          />
        </div>
      ) : (
        <div>
          {metaError && <div className="error-banner">{t(metaError)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

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
                  <div className={styles.fileTitle}>{t('Video: {name}', { name: videoFile.name })}</div>
                  <div className={styles.fileSub}>
                    {formatBytes(videoFile.size)}
                    {videoMeta && ` • ${formatDuration(videoMeta.duration)} • ${videoMeta.width}x${videoMeta.height}`}
                    {hasAudio === false && ` • ${t('(No audio)')}`}
                  </div>
                </div>
                <Button variant="secondary" onClick={handleChangeVideo}>
                  {t('Change video')}
                </Button>
              </div>
              <SourcePreview file={videoFile} note="Video source preview. The soundtrack mix is created during export." />

              {!audioFile ? (
                <div style={{ marginTop: '1.5rem' }}>
                  <div className={styles.sectionTitle}>{t('Step 2: Select Audio / Soundtrack')}</div>
                  <FileDrop
                    accept="audio/*"
                    label={t('Choose an audio track or drag it here')}
                    hint={t('Supports MP3, WAV, AAC, OGG, and more.')}
                    onFiles={handleAudioFile}
                  />
                </div>
              ) : (
                <div>
                  <div className={styles.fileCard}>
                    <div className={styles.fileDetails}>
                      <div className={styles.fileTitle}>{t('Soundtrack: {name}', { name: audioFile.name })}</div>
                      <div className={styles.fileSub}>{formatBytes(audioFile.size)}</div>
                    </div>
                    <Button variant="secondary" onClick={() => setAudioFile(null)}>
                      {t('Change audio')}
                    </Button>
                  </div>
                  <SourcePreview
                    file={audioFile}
                    kind="audio"
                    note="Soundtrack source preview. Looping, mixing, gain, and fades are applied during export."
                  />

                  {job.status === 'running' ? (
                    <ProgressBar value={job.progress} label={t('Adding soundtrack...')} />
                  ) : (
                    <div style={{ marginTop: '1.5rem' }}>
                      <Field label={t('Music volume')} hint={t('Adjust volume level of the added soundtrack.')}>
                        <Slider value={musicVolume} min={0} max={200} step={5} unit="%" onChange={setMusicVolume} />
                      </Field>

                      {isRelevantOriginalAudio && (
                        <Field
                          label={t('Original audio')}
                          hint={t("Choose whether to keep and mix the video's original sound or replace it entirely.")}
                        >
                          <Select
                            id={originalAudioId}
                            value={originalAudioMode}
                            onChange={(e) => setOriginalAudioMode(e.target.value as OriginalAudioMode)}
                            options={[
                              { value: 'keep', label: t('Keep and mix original audio') },
                              { value: 'replace', label: t('Replace original audio') },
                            ]}
                          />
                        </Field>
                      )}

                      <details className="tool-options">
                        <summary>{t('Advanced audio options')}</summary>
                        <div className="tool-options-body">
                          <div className="field">
                            <label className="checkbox-label" htmlFor={loopMusicId}>
                              <input
                                id={loopMusicId}
                                type="checkbox"
                                checked={loopMusic}
                                onChange={(e) => setLoopMusic(e.target.checked)}
                              />
                              <span>{t('Loop music to fit video')}</span>
                            </label>
                          </div>

                          <div className="field">
                            <label className="checkbox-label" htmlFor={fadeOutId}>
                              <input id={fadeOutId} type="checkbox" checked={fadeOut} onChange={(e) => setFadeOut(e.target.checked)} />
                              <span>{t('Fade out last 2 seconds')}</span>
                            </label>
                          </div>
                        </div>
                      </details>

                      <div className="action-buttons" style={{ marginTop: '2rem' }}>
                        <Button variant="secondary" onClick={handleReset}>
                          {t('Start over')}
                        </Button>
                        <Button variant="primary" onClick={handleAddSoundtrack}>
                          {t('Add soundtrack')}
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
