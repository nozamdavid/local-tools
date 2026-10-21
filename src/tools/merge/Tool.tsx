import { useState, useId, useRef } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration } from '../../lib/format';
import { runFFmpeg } from '../../lib/ffmpeg';
import { useJob } from '../../lib/useJob';
import styles from './Tool.module.css';

type ResolutionOption = 'match' | '1080p' | '720p';

interface MergeItem {
  id: string;
  file: File;
  meta?: VideoMeta;
  hasAudio?: boolean;
}

function ensureEven(num: number): number {
  const rounded = Math.round(num);
  const even = Math.floor(rounded / 2) * 2;
  return Math.max(2, even);
}

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

export default function MergeTool() {
  const meta = getToolMeta('merge');
  const [items, setItems] = useState<MergeItem[]>([]);
  const [resolution, setResolution] = useState<ResolutionOption>('match');
  const addFilesInputRef = useRef<HTMLInputElement>(null);

  const job = useJob();
  const resolutionId = useId();

  const processNewFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const newItems: MergeItem[] = files.map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file: f,
    }));

    setItems((prev) => [...prev, ...newItems]);
    job.reset();

    for (const item of newItems) {
      try {
        const vMeta = await getVideoMeta(item.file);
        const hasAudio = await detectAudio(item.file, vMeta);
        setItems((current) => current.map((it) => (it.id === item.id ? { ...it, meta: vMeta, hasAudio } : it)));
      } catch {
        const hasAudio = await detectAudio(item.file);
        setItems((current) => current.map((it) => (it.id === item.id ? { ...it, hasAudio } : it)));
      }
    }
  };

  const handleFiles = (files: File[]) => {
    processNewFiles(files);
  };

  const handleReset = () => {
    setItems([]);
    job.reset();
  };

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const updated = [...items];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);
    setItems(updated);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleMerge = () => {
    if (items.length < 2) return;

    job.run(async (setProgress) => {
      let targetW = 1920;
      let targetH = 1080;

      if (resolution === '1080p') {
        targetW = 1920;
        targetH = 1080;
      } else if (resolution === '720p') {
        targetW = 1280;
        targetH = 720;
      } else {
        // match first video
        const firstMeta = items[0]?.meta;
        if (firstMeta && firstMeta.width && firstMeta.height) {
          targetW = ensureEven(firstMeta.width);
          targetH = ensureEven(firstMeta.height);
        }
      }

      const inputs = items.map((it, i) => {
        const dotIdx = it.file.name.lastIndexOf('.');
        const ext = dotIdx >= 0 ? it.file.name.slice(dotIdx) : '.mp4';
        return {
          name: `input_${i}${ext}`,
          data: it.file,
        };
      });

      const filterParts: string[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        // video filter
        filterParts.push(
          `[${i}:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[v${i}]`,
        );

        // audio filter
        if (item.hasAudio) {
          filterParts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
        } else {
          const duration = item.meta?.duration && item.meta.duration > 0 ? item.meta.duration.toFixed(3) : '10';
          filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${duration}[a${i}]`);
        }
      }

      let concatStr = '';
      for (let i = 0; i < items.length; i++) {
        concatStr += `[v${i}][a${i}]`;
      }
      concatStr += `concat=n=${items.length}:v=1:a=1[outv][outa]`;
      filterParts.push(concatStr);

      const filterComplex = filterParts.join(';');

      const args: string[] = [];
      for (const input of inputs) {
        args.push('-i', input.name);
      }

      args.push(
        '-filter_complex',
        filterComplex,
        '-map',
        '[outv]',
        '-map',
        '[outa]',
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
        '192k',
        '-movflags',
        '+faststart',
        'merged.mp4',
      );

      return await runFFmpeg({
        inputs,
        args,
        output: 'merged.mp4',
        onProgress: setProgress,
      });
    });
  };

  const totalSize = items.reduce((acc, it) => acc + it.file.size, 0);

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="merge">
      {items.length === 0 ? (
        <FileDrop
          accept="video/*"
          multiple={true}
          label="Choose multiple videos or drag them here"
          hint="Merge multiple clips into a single video with normalized resolution and audio."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {job.error && <div className="error-banner">{job.error}</div>}

          {job.status === 'done' && job.result ? (
            <ResultPanel blob={job.result} filename="merged.mp4" kind="video" originalSize={totalSize} onReset={handleReset} />
          ) : (
            <div>
              <div className="toolbar">
                <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>Clips to merge ({items.length})</span>
                <Button
                  variant="secondary"
                  onClick={() => addFilesInputRef.current?.click()}
                  style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                >
                  + Add more files
                </Button>
                <input
                  ref={addFilesInputRef}
                  type="file"
                  multiple
                  accept="video/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      processNewFiles(Array.from(e.target.files));
                      e.target.value = '';
                    }
                  }}
                />
              </div>

              <div className={styles.fileList}>
                {items.map((item, index) => (
                  <div key={item.id} className={styles.fileItem}>
                    <div className={styles.fileInfo}>
                      <span className={styles.fileName}>
                        {index + 1}. {item.file.name}
                      </span>
                      <span className={styles.fileMeta}>
                        {formatBytes(item.file.size)}
                        {item.meta && (
                          <>
                            {' • '}
                            {formatDuration(item.meta.duration)}
                            {' • '}
                            {item.meta.width}x{item.meta.height}
                          </>
                        )}
                        {item.hasAudio === false && ' • (Silent)'}
                      </span>
                    </div>

                    <div className={styles.itemActions}>
                      <button
                        type="button"
                        aria-label="Move up"
                        title="Move up"
                        className={styles.iconBtn}
                        disabled={index === 0}
                        onClick={() => moveItem(index, 'up')}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        title="Move down"
                        className={styles.iconBtn}
                        disabled={index === items.length - 1}
                        onClick={() => moveItem(index, 'down')}
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        aria-label="Remove"
                        title="Remove"
                        className={`${styles.iconBtn} ${styles.removeBtn}`}
                        onClick={() => removeItem(item.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label="Merging videos..." />
              ) : (
                <div style={{ marginTop: '1.5rem' }}>
                  <Field
                    label="Output resolution"
                    hint="Clips with different resolutions or aspect ratios will be scaled and fitted with black bars."
                  >
                    <Select
                      id={resolutionId}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value as ResolutionOption)}
                      options={[
                        { value: 'match', label: 'Match first video' },
                        { value: '1080p', label: '1080p (Full HD)' },
                        { value: '720p', label: '720p (HD)' },
                      ]}
                    />
                  </Field>

                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      Clear all
                    </Button>
                    <Button variant="primary" onClick={handleMerge} disabled={items.length < 2}>
                      {items.length < 2 ? 'Add at least 2 videos' : 'Merge videos'}
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
