import { useState, useCallback, useRef, useEffect } from 'react';
import { describeError } from './errors';

export type JobStatus = 'idle' | 'running' | 'done' | 'error';

export interface UseJobReturn {
  status: JobStatus;
  progress: number;
  error?: string;
  result?: Blob;
  run: (fn: (setProgress: (ratio: number) => void) => Promise<Blob>) => Promise<void>;
  reset: () => void;
}

export function useJob(): UseJobReturn {
  const [status, setStatus] = useState<JobStatus>('idle');
  const [progress, setProgressState] = useState<number>(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<Blob | undefined>(undefined);
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  const setProgress = useCallback((ratio: number) => {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    setProgressState(clamped);
  }, []);

  const reset = useCallback(() => {
    generation.current++;
    setStatus('idle');
    setProgressState(0);
    setError(undefined);
    setResult(undefined);
  }, []);

  const run = useCallback(
    async (fn: (setProgress: (ratio: number) => void) => Promise<Blob>) => {
      const current = ++generation.current;
      setStatus('running');
      setProgressState(0);
      setError(undefined);
      setResult(undefined);

      try {
        const blob = await fn((ratio) => {
          if (current === generation.current) setProgress(ratio);
        });
        if (current !== generation.current) return;
        setResult(blob);
        setProgressState(1);
        setStatus('done');
      } catch (err: unknown) {
        if (current !== generation.current) return;
        const msg = describeError(err);
        setError(msg);
        setStatus('error');
      }
    },
    [setProgress],
  );

  return {
    status,
    progress,
    error,
    result,
    run,
    reset,
  };
}
