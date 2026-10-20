import type { QpdfRequest, QpdfResponse } from './qpdf.worker';

/** qpdf reads the input from this path inside its virtual file system. */
export const QPDF_IN = '/in.pdf';
/** qpdf writes the result to this path inside its virtual file system. */
export const QPDF_OUT = '/out.pdf';

export class QpdfError extends Error {
  readonly code: number;
  readonly stderr: string;
  /** True when qpdf rejected the password (or one is needed). */
  readonly badPassword: boolean;

  constructor(code: number, stderr: string) {
    super(stderr.trim() || `qpdf failed with exit code ${code}.`);
    this.name = 'QpdfError';
    this.code = code;
    this.stderr = stderr;
    this.badPassword = /invalid password/i.test(stderr);
  }
}

export interface QpdfRun {
  /** qpdf exit code: 0 ok, 2 error, 3 finished with warnings. */
  code: number;
  output: Uint8Array;
  stderr: string;
}

/**
 * Runs qpdf (WASM, served from this origin) in a Web Worker with a fresh virtual file system.
 * `args` are the options only; the input and output paths are appended unless `output` is false.
 * Resolves with any exit code, so callers can inspect check commands such as `--is-encrypted`.
 */
export function runQpdfRaw(
  input: Uint8Array,
  args: string[],
  options: { output?: boolean } = {}
): Promise<QpdfRun> {
  const output = options.output ?? true;
  const fullArgs = output ? [...args, QPDF_IN, QPDF_OUT] : [...args, QPDF_IN];

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./qpdf.worker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = (event: MessageEvent<QpdfResponse>) => {
      worker.terminate();
      const res = event.data;
      if (res.ok) resolve({ code: res.code, output: res.output, stderr: res.stderr });
      else reject(new Error(res.message));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'The qpdf worker failed to start.'));
    };

    const request: QpdfRequest = { input: input.slice(), args: fullArgs, output };
    worker.postMessage(request);
  });
}

/** Runs qpdf and returns the output file. Throws QpdfError on failure (warnings are accepted). */
export async function runQpdf(input: Uint8Array, args: string[]): Promise<Uint8Array> {
  const run = await runQpdfRaw(input, args);
  if ((run.code !== 0 && run.code !== 3) || run.output.length === 0) {
    throw new QpdfError(run.code, run.stderr);
  }
  return run.output;
}

/** True when the PDF is encrypted (with or without an open password). Throws if the file cannot be read. */
export async function isEncryptedPdf(input: Uint8Array): Promise<boolean> {
  const run = await runQpdfRaw(input, ['--is-encrypted'], { output: false });
  // qpdf exits 0 for encrypted files and 2 (with no message) for plain ones
  if (run.code === 0) return true;
  const error = new QpdfError(run.code, run.stderr);
  if (error.badPassword) return true;
  if (run.code === 2 && !run.stderr.trim()) return false;
  throw error;
}

/** Removes encryption. An empty password opens PDFs that only have an owner password. */
export function decryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  return runQpdf(bytes, [`--password=${password}`, '--decrypt']);
}
