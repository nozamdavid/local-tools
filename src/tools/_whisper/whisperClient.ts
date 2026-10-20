import { extractAudioPCM } from './extractAudio';
import { chunksToCues } from './formats';
import type {
  ProgressState,
  SubtitleCue,
  WhisperChunk,
  WhisperModel,
  WhisperTask,
  WorkerInMessage,
  WorkerOutMessage,
} from './types';

export interface TranscribeOptions {
  model: WhisperModel;
  language?: string;
  task?: WhisperTask;
  videoDuration?: number;
  onProgress?: (state: ProgressState) => void;
}

export interface TranscribeResult {
  text: string;
  chunks: WhisperChunk[];
  cues: SubtitleCue[];
}

export class WhisperTranscriptionJob {
  private worker: Worker | null = null;
  private aborted = false;

  public abort() {
    this.aborted = true;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  public async run(file: File | Blob, options: TranscribeOptions): Promise<TranscribeResult> {
    const { model, language, task, videoDuration, onProgress } = options;

    // Phase 1: Audio Extraction
    onProgress?.({
      phase: 'extracting',
      ratio: 0.1,
      label: 'Extracting audio track...',
    });

    const audioData = await extractAudioPCM(file, (ratio) => {
      onProgress?.({
        phase: 'extracting',
        ratio: Math.min(0.99, ratio),
        label: `Extracting audio track (${Math.round(ratio * 100)}%)...`,
      });
    });

    if (this.aborted) {
      throw new Error('Transcription cancelled');
    }

    onProgress?.({
      phase: 'downloading',
      ratio: 0,
      label: 'Preparing Whisper model...',
    });

    // Phase 2 & 3: Web Worker transcription
    return new Promise<TranscribeResult>((resolve, reject) => {
      try {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker = worker;

        worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
          if (this.aborted) {
            worker.terminate();
            this.worker = null;
            reject(new Error('Transcription cancelled'));
            return;
          }

          const data = e.data;
          if (!data) return;

          switch (data.type) {
            case 'download_progress': {
              const pct = Math.round(data.progress * 100);
              onProgress?.({
                phase: 'downloading',
                ratio: data.progress,
                label: `Downloading model weights (${pct}%)...`,
              });
              break;
            }
            case 'status': {
              if (data.phase === 'transcribing') {
                const s = data.elapsedSeconds;
                const timeText = s > 0 ? ` (${s}s elapsed)` : '';
                onProgress?.({
                  phase: 'transcribing',
                  ratio: 1, // Indeterminate / active
                  label: `Transcribing audio with Whisper${timeText}...`,
                  elapsedSeconds: s,
                });
              }
              break;
            }
            case 'complete': {
              worker.terminate();
              this.worker = null;
              onProgress?.({
                phase: 'done',
                ratio: 1,
                label: 'Transcription complete',
              });
              const cues = chunksToCues(data.chunks, videoDuration);
              resolve({
                text: data.text,
                chunks: data.chunks,
                cues,
              });
              break;
            }
            case 'error': {
              worker.terminate();
              this.worker = null;
              reject(new Error(data.error || 'Failed to transcribe audio'));
              break;
            }
          }
        };

        worker.onerror = (err) => {
          worker.terminate();
          this.worker = null;
          reject(new Error(err.message || 'Worker error during speech transcription'));
        };

        const msg: WorkerInMessage = {
          type: 'transcribe',
          audio: audioData,
          model,
          language: language || undefined,
          task,
        };

        // Transfer Float32Array buffer to worker for zero-copy efficiency
        worker.postMessage(msg, [audioData.buffer]);
      } catch (workerErr) {
        reject(workerErr);
      }
    });
  }
}
