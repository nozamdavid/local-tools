/** Zips blobs in memory. Duplicate names get a " (2)", " (3)" suffix instead of overwriting each other. */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();

  for (const { name, blob } of files) {
    const dot = name.lastIndexOf('.');
    const extensionStart = dot > name.lastIndexOf('/') + 1 ? dot : name.length;
    let finalName = name;
    for (let n = 2; used.has(finalName); n++) {
      finalName = `${name.slice(0, extensionStart)} (${n})${name.slice(extensionStart)}`;
    }
    used.add(finalName);
    zip.file(finalName, blob);
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

interface ZipEntryStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): ZipEntryStream;
  on(event: 'error', listener: (error: Error) => void): ZipEntryStream;
  on(event: 'end', listener: () => void): ZipEntryStream;
  pause(): ZipEntryStream;
  resume(): ZipEntryStream;
}

export function readZipEntry(entry: unknown, maxBytes: number, limitMessage: string): Promise<Uint8Array> {
  // JSZip exposes this in the browser but omits it from its type definitions.
  const stream = (entry as { internalStream(type: 'uint8array'): ZipEntryStream }).internalStream('uint8array');
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    stream
      .on('data', (chunk) => {
        byteLength += chunk.byteLength;
        if (byteLength > maxBytes) {
          stream.pause();
          chunks.length = 0;
          reject(new Error(limitMessage));
          return;
        }
        chunks.push(chunk);
      })
      .on('error', reject)
      .on('end', () => {
        if (byteLength > maxBytes) return;
        try {
          const output = new Uint8Array(byteLength);
          let offset = 0;
          for (const chunk of chunks) {
            output.set(chunk, offset);
            offset += chunk.byteLength;
          }
          resolve(output);
        } catch (error) {
          reject(error);
        }
      })
      .resume();
  });
}
