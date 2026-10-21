/** Zips blobs in memory. Duplicate names get a " (2)", " (3)" suffix instead of overwriting each other. */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();

  for (const { name, blob } of files) {
    let finalName = name;
    for (let n = 2; used.has(finalName); n++) {
      const dot = name.lastIndexOf('.');
      finalName = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    }
    used.add(finalName);
    zip.file(finalName, blob);
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
