import type { AiWorkerInMessage, AiWorkerOutMessage } from './types';

export interface AiProgress {
  phase: 'downloading' | 'inferring' | 'done';
  progress: number;
  label: string;
  loaded?: number;
  total?: number;
  current?: number;
  totalItems?: number;
  elapsedSeconds?: number;
}

export class AiJob {
  private cancel: (() => void) | null = null;

  public abort() {
    this.cancel?.();
  }

  public async summarize(
    text: string,
    modelId: string,
    options: {
      maxLength?: number;
      minLength?: number;
      onProgress?: (p: AiProgress) => void;
    } = {},
  ): Promise<string> {
    const { maxLength, minLength, onProgress } = options;

    return this.runWorker(
      {
        type: 'summarize',
        text,
        modelId,
        maxLength,
        minLength,
      },
      onProgress,
    );
  }

  public async translate(
    chunks: string[],
    modelId: string,
    options: {
      onProgress?: (p: AiProgress) => void;
    } = {},
  ): Promise<string> {
    const { onProgress } = options;

    return this.runWorker(
      {
        type: 'translate',
        chunks,
        modelId,
      },
      onProgress,
    );
  }

  private runWorker(inMsg: AiWorkerInMessage, onProgress?: (p: AiProgress) => void): Promise<string> {
    this.abort();
    return new Promise<string>((resolve, reject) => {
      try {
        const worker = new Worker(new URL('./aiWorker.ts', import.meta.url), {
          type: 'module',
        });
        const startTime = Date.now();
        const timer = setInterval(() => {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          onProgress?.({
            phase: 'inferring',
            progress: 1,
            label: `Running model inference... (${elapsed}s elapsed)`,
            elapsedSeconds: elapsed,
          });
        }, 1000);

        const cleanup = () => {
          clearInterval(timer);
          worker.onmessage = null;
          worker.onerror = null;
          worker.terminate();
          this.cancel = null;
        };
        this.cancel = () => {
          cleanup();
          reject(new Error('Operation cancelled by user.'));
        };

        worker.onmessage = (e: MessageEvent<AiWorkerOutMessage>) => {
          const data = e.data;
          if (!data) return;

          switch (data.type) {
            case 'download_progress': {
              const pct = Math.round(data.progress * 100);
              const mbLoaded = (data.loaded / (1024 * 1024)).toFixed(1);
              const mbTotal = data.total > 0 ? (data.total / (1024 * 1024)).toFixed(1) : '?';
              onProgress?.({
                phase: 'downloading',
                progress: data.progress,
                loaded: data.loaded,
                total: data.total,
                label: `Downloading model weights: ${pct}% (${mbLoaded} MB / ${mbTotal} MB)...`,
              });
              break;
            }

            case 'status': {
              if (data.phase === 'inferring') {
                const itemInfo = data.total && data.total > 1 ? ` (chunk ${data.current} of ${data.total})` : '';
                onProgress?.({
                  phase: 'inferring',
                  progress: data.total ? (data.current ?? 1) / data.total : 1,
                  current: data.current,
                  totalItems: data.total,
                  label: `Running inference${itemInfo}...`,
                });
              }
              break;
            }

            case 'chunk_complete': {
              // chunk intermediate update
              break;
            }

            case 'complete': {
              cleanup();
              onProgress?.({
                phase: 'done',
                progress: 1,
                label: 'Complete',
              });
              resolve(data.result);
              break;
            }

            case 'error': {
              cleanup();
              reject(new Error(data.error));
              break;
            }
          }
        };

        worker.onerror = (err) => {
          cleanup();
          reject(new Error(err.message || 'Worker execution failed.'));
        };

        try {
          worker.postMessage(inMsg);
        } catch (err) {
          cleanup();
          reject(err);
        }
      } catch (err) {
        reject(err);
      }
    });
  }
}
