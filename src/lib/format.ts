export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  const value = parseFloat((bytes / Math.pow(k, index)).toFixed(dm));
  return `${value} ${sizes[index]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const sStr = s.toFixed(1).padStart(4, '0');
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${sStr}`;
  }
  return `${m}:${sStr}`;
}

export function replaceExt(filename: string, ext: string): string {
  const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
  const dotIdx = filename.lastIndexOf('.');
  const base = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  return `${base}.${cleanExt}`;
}

export function withSuffix(filename: string, suffix: string, ext?: string): string {
  const dotIdx = filename.lastIndexOf('.');
  const base = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const currentExt = dotIdx > 0 ? filename.slice(dotIdx + 1) : '';
  const targetExt = ext !== undefined ? (ext.startsWith('.') ? ext.slice(1) : ext) : currentExt;
  return targetExt ? `${base}${suffix}.${targetExt}` : `${base}${suffix}`;
}
