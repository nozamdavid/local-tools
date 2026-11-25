import { extractAudioPCM } from './extractAudio';
import { chunksToCues } from './formats';
import type { ProgressState, SubtitleCue, WhisperChunk, WhisperModel, WhisperTask, WorkerInMessage, WorkerOutMessage } from './types';
import { translate } from '../../lib/i18n';

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
  private controller = new AbortController();

  public abort() {
    this.controller.abort(new Error(translate('Transcription cancelled')));
  }

  public async run(file: File | Blob, options: TranscribeOptions): Promise<TranscribeResult> {
    const { model, language, task, videoDuration, onProgress } = options;
    const { signal } = this.controller;
    signal.throwIfAborted();

    // Phase 1: Audio Extraction
    onProgress?.({
      phase: 'extracting',
      ratio: 0.1,
      label: translate('Extracting audio track...'),
    });

    const audioData = await extractAudioPCM(
      file,
      (ratio) => {
        onProgress?.({
          phase: 'extracting',
          ratio: Math.min(0.99, ratio),
          label: translate('Extracting audio track ({percent}%)...', { percent: Math.round(ratio * 100) }),
        });
      },
      signal,
    );

    signal.throwIfAborted();

    onProgress?.({
      phase: 'downloading',
      ratio: 0,
      label: translate('Preparing Whisper model...'),
    });

    // Phase 2 & 3: Web Worker transcription
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    let onAbort: (() => void) | undefined;
    try {
      return await new Promise<TranscribeResult>((resolve, reject) => {
        signal.throwIfAborted();
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });

        worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
          const data = e.data;
          if (!data) return;

          switch (data.type) {
            case 'download_progress': {
              const pct = Math.round(data.progress * 100);
              onProgress?.({
                phase: 'downloading',
                ratio: data.progress,
                label: translate('Downloading model weights ({percent}%)...', { percent: pct }),
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
                  label: translate('Transcribing audio with Whisper{time}...', { time: timeText }),
                  elapsedSeconds: s,
                });
              }
              break;
            }
            case 'complete': {
              onProgress?.({
                phase: 'done',
                ratio: 1,
                label: translate('Transcription complete'),
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
              reject(
                new Error(
                  data.error
                    ? translate('Speech transcription failed: {message}', { message: data.error })
                    : translate('Failed to transcribe audio'),
                ),
              );
              break;
            }
          }
        };

        worker.onerror = (err) => {
          reject(
            new Error(
              translate('Speech transcription worker failed: {message}', {
                message: err.message || translate('Worker error during speech transcription'),
              }),
            ),
          );
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
      });
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
      worker.terminate();
    }
  }
}
