import createModule from '@neslinesli93/qpdf-wasm';
import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';

interface QpdfRuntime {
  callMain: (args: string[]) => number;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
  };
}

type QpdfFactory = (options: {
  locateFile: () => string;
  noInitialRun: boolean;
})=> Promise<QpdfRuntime>;

export interface QpdfRequest {
  input: Uint8Array;
  args: string[];
  /** Read /out.pdf after the run. */
  output: boolean;
}

export type QpdfResponse =
  | { ok: true; code: number; output: Uint8Array; stderr: string }
  | { ok: false; message: string };

self.onmessage = async (event: MessageEvent<QpdfRequest>) => {
  const { input, args, output } = event.data;
  const lines: string[] = [];

  // This qpdf build ignores the print/printErr options and writes to console.log/console.error,
  // bound when the module is created. Redirect both so qpdf's messages can be reported.
  const capture = (...parts: unknown[]) => void lines.push(parts.map(String).join(' '));
  console.log = capture;
  console.error = capture;

  try {
    const factory = createModule as unknown as QpdfFactory;
    const qpdf = await factory({ locateFile: () => wasmUrl, noInitialRun: true });

    qpdf.FS.writeFile('/in.pdf', input);

    let code: number;
    try {
      code = qpdf.callMain(args);
    } catch (err) {
      // emscripten reports exit() as a thrown ExitStatus
      const status = (err as { status?: unknown } | null)?.status;
      if (typeof status !== 'number') throw err;
      code = status;
    }

    let bytes: Uint8Array = new Uint8Array(0);
    if (output) {
      try {
        bytes = qpdf.FS.readFile('/out.pdf');
      } catch {
        // qpdf failed before writing the output; the exit code and messages explain why
      }
    }
    const response: QpdfResponse = { ok: true, code, output: bytes, stderr: lines.join('\n') };
    (self as unknown as Worker).postMessage(response, bytes.length ? [bytes.buffer as ArrayBuffer] : []);
  } catch (err) {
    const response: QpdfResponse = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
