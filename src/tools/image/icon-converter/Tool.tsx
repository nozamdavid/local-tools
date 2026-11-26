import { useState, useCallback, useEffect } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Field, Select, Button } from '../../../components/Controls';
import { ProgressBar } from '../../../components/ProgressBar';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { decodeImage, encodeIco, IMAGE_ACCEPT } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { CopyImageButton } from '../../../components/CopyImageButton';
import { zipFiles } from '../../../lib/zip';
import { formatBytes } from '../../../lib/format';
import { useObjectUrl } from '../../../lib/useObjectUrl';
import { peekPendingFiles } from '../../../lib/handoff';
import { classifyFile } from '../../../lib/toolInputs';
import { parseIcoDirectory, frameToPngBlob } from '../_utility/ico';

type Mode = 'ico-to-png' | 'image-to-ico';

interface ExtractedFrameItem {
  id: string;
  name: string;
  width: number;
  height: number;
  bitCount: number;
  format: string;
  blob: Blob;
}

interface GeneratedIcoItem {
  name: string;
  blob: Blob;
  sizes: string;
}

const RECOMMENDED_SIZES = [16, 32, 48];
const ALL_SIZES = [16, 32, 48, 64, 128, 256];
const SINGLE_SIZES = ALL_SIZES;
const MAX_IMAGE_PREVIEW_BYTES = 16 * 1024 * 1024;
const MAX_ICO_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_ICO_PREVIEW_FRAMES = 16;

type IcoPreviewLimit = 'file-size' | 'frame-count' | 'frame-size' | 'frame-dimensions';
type IcoPreviewIssue = { message: string; params?: Record<string, string | number> };

function getIcoPreviewLimit(buffer: ArrayBuffer): IcoPreviewLimit | null {
  if (buffer.byteLength > MAX_ICO_PREVIEW_BYTES) return 'file-size';
  if (buffer.byteLength < 6) return null;

  const view = new DataView(buffer);
  const count = view.getUint16(4, true);
  if (count > MAX_ICO_PREVIEW_FRAMES) return 'frame-count';

  const directoryEnd = 6 + count * 16;
  if (directoryEnd > buffer.byteLength) return null;

  let totalFrameBytes = 0;
  for (let index = 0; index < count; index++) {
    const entryOffset = 6 + index * 16;
    const length = view.getUint32(entryOffset + 8, true);
    const imageOffset = view.getUint32(entryOffset + 12, true);
    totalFrameBytes += length;
    if (totalFrameBytes > MAX_ICO_PREVIEW_BYTES) return 'frame-size';
    if (imageOffset < directoryEnd || length < 8 || imageOffset + length > buffer.byteLength) continue;

    const bytes = new Uint8Array(buffer, imageOffset, length);
    const isPng =
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;

    if (isPng && length >= 24) {
      const pngView = new DataView(buffer, imageOffset, length);
      if (pngView.getUint32(16, false) > 256 || pngView.getUint32(20, false) > 256) return 'frame-dimensions';
      continue;
    }

    if (isPng || length < 40) continue;
    const frameView = new DataView(buffer, imageOffset, length);
    const headerSize = frameView.getUint32(0, true);
    if (headerSize < 40 || headerSize > length) continue;
    const directoryWidth = view.getUint8(entryOffset) || 256;
    const directoryHeight = view.getUint8(entryOffset + 1) || 256;
    const dibWidth = frameView.getInt32(4, true);
    const dibHeight = frameView.getInt32(8, true);
    const width = dibWidth > 0 ? dibWidth : directoryWidth;
    const height = dibHeight > 0 ? Math.floor(dibHeight / 2) : directoryHeight;
    if (width > 256 || height > 256) return 'frame-dimensions';
  }

  return null;
}

function previewLimitMessage(limit: IcoPreviewLimit): IcoPreviewIssue {
  if (limit === 'file-size') {
    return { message: 'ICO preview supports files up to {size} MiB. Conversion is still available.', params: { size: 4 } };
  }
  if (limit === 'frame-count') {
    return {
      message: 'ICO preview supports up to {count} embedded frames. Conversion is still available.',
      params: { count: MAX_ICO_PREVIEW_FRAMES },
    };
  }
  if (limit === 'frame-dimensions') {
    return { message: 'ICO preview supports frames up to 256 × 256 px. Conversion is still available.' };
  }
  return { message: 'ICO preview supports up to {size} MiB of frame data. Conversion is still available.', params: { size: 4 } };
}

function imageToIconCanvas(img: HTMLImageElement, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');

  const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (size - width) / 2, (size - height) / 2, width, height);
  return canvas;
}

function ExtractedItemRow({ item }: { item: ExtractedFrameItem }) {
  const { t } = useI18n();
  const url = useObjectUrl(item.blob);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.75rem 1rem',
        background: 'var(--surface)',
        borderRadius: '8px',
        gap: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'repeating-conic-gradient(#80808020 0% 25%, transparent 0% 50%) 50% / 8px 8px',
            borderRadius: '6px',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          {url && (
            <img
              src={url}
              alt={item.name}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                imageRendering: item.width <= 32 ? 'pixelated' : 'auto',
              }}
            />
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name}
          </span>
          <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>
            {item.width}×{item.height} px · {item.bitCount}-bit · {item.format} · {formatBytes(item.blob.size)}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <Button variant="secondary" size="sm" onClick={() => downloadBlob(item.blob, item.name)}>
          {t('Download')}
        </Button>
        <CopyImageButton getImage={() => item.blob} filename={item.name} size="sm" />
      </div>
    </div>
  );
}

function ImageSourcePreview({ file, count, resolution }: { file: File; count: number; resolution: string }) {
  const { t } = useI18n();
  const previewFile = file.size <= MAX_IMAGE_PREVIEW_BYTES ? file : null;
  const [sourceUrl, setSourceUrl] = useState<{ file: File; url: string } | null>(null);
  const url = sourceUrl?.file === previewFile ? sourceUrl.url : undefined;
  const [imageState, setImageState] = useState<{ file: File; width: number; height: number } | null>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [targetPreview, setTargetPreview] = useState<{ file: File; size: number; url: string } | null>(null);
  const [targetPreviewError, setTargetPreviewError] = useState<{ file: File; size: number } | null>(null);
  const sizes = resolution === 'recommended' ? RECOMMENDED_SIZES : resolution === 'all' ? ALL_SIZES : [Number(resolution)];
  const targetSize = Math.max(...sizes);

  useEffect(() => {
    if (!previewFile) {
      setSourceUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(previewFile);
    setSourceUrl({ file: previewFile, url: objectUrl });
    return () => URL.revokeObjectURL(objectUrl);
  }, [previewFile]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let targetUrl: string | null = null;
    const image = new Image();
    setTargetPreview(null);
    setTargetPreviewError(null);

    image.onload = () => {
      if (cancelled) return;
      setImageState({ file, width: image.naturalWidth, height: image.naturalHeight });
      try {
        const canvas = imageToIconCanvas(image, targetSize);
        canvas.toBlob((blob) => {
          if (cancelled) return;
          if (!blob) {
            setTargetPreviewError({ file, size: targetSize });
            return;
          }
          targetUrl = URL.createObjectURL(blob);
          setTargetPreview({ file, size: targetSize, url: targetUrl });
        }, 'image/png');
      } catch {
        if (!cancelled) setTargetPreviewError({ file, size: targetSize });
      }
    };
    image.onerror = () => {
      if (!cancelled) setFailedFile(file);
    };
    image.src = url;

    return () => {
      cancelled = true;
      if (targetUrl) URL.revokeObjectURL(targetUrl);
    };
  }, [file, targetSize, url]);

  return (
    <section
      style={{
        background: 'var(--surface)',
        padding: '1.25rem',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.85rem',
      }}
      aria-label={t('Source preview')}
    >
      <div>
        <strong>{t('Source preview')}</strong>
        {count > 1 && <div style={{ fontSize: '0.85rem', opacity: 0.75 }}>{t('Previewing first of {count} files', { count })}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: '0.35rem', justifyItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('Source image')}</span>
            <div
              style={{
                width: '96px',
                height: '96px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                borderRadius: '8px',
                background: 'repeating-conic-gradient(#80808020 0% 25%, transparent 0% 50%) 50% / 12px 12px',
              }}
            >
              {url && !failedFile && (
                <img src={url} alt={file.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gap: '0.35rem', justifyItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {t('Target icon appearance: {size} × {size} px', { size: targetSize })}
            </span>
            <div
              style={{
                width: '96px',
                height: '96px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                borderRadius: '8px',
                background: 'repeating-conic-gradient(#80808020 0% 25%, transparent 0% 50%) 50% / 12px 12px',
              }}
            >
              {targetPreview?.file === file && targetPreview.size === targetSize && (
                <img src={targetPreview.url} alt="" style={{ width: '96px', height: '96px', imageRendering: 'pixelated' }} />
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 0 }}>
          <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{file.name}</span>
          <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>{t('Target icon sizes: {sizes} px', { sizes: sizes.join(', ') })}</span>
          {imageState?.file === file && (
            <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>
              {t('Source image dimensions: {width} × {height} px', { width: imageState.width, height: imageState.height })}
            </span>
          )}
          <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>
            {t('The preview shows the first selected file. Convert processes all {count} files.', { count })}
          </span>
        </div>
      </div>
      {file.size > MAX_IMAGE_PREVIEW_BYTES ? (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {t('Source image preview supports files up to {size} MiB. Conversion is still available.', { size: 16 })}
        </p>
      ) : failedFile === file ? (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }} role="status">
          {t('Preview could not be created. Conversion is still available.')}
        </p>
      ) : !url ? (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }} role="status">
          {t('Preparing source preview…')}
        </p>
      ) : imageState?.file !== file ? (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }} role="status">
          {t('Loading source preview...')}
        </p>
      ) : null}
      {targetPreviewError?.file === file && targetPreviewError.size === targetSize && (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }} role="status">
          {t('Target icon preview could not be created. Conversion is still available.')}
        </p>
      )}
      {url && imageState?.file === file && targetPreview?.file !== file && targetPreviewError?.file !== file && (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }} role="status">
          {t('Preparing target icon preview…')}
        </p>
      )}
    </section>
  );
}

function IcoSourcePreview({ file, count }: { file: File; count: number }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<
    | { file: File; status: 'loading' }
    | { file: File; status: 'ready'; url: string; width: number; height: number; bitCount: number; format: string }
    | ({ file: File; status: 'error' } & IcoPreviewIssue)
  >({ file, status: 'loading' });
  const currentPreview = preview.file === file ? preview : { file, status: 'loading' as const };

  useEffect(() => {
    let cancelled = false;
    let previewUrl: string | null = null;
    setPreview({ file, status: 'loading' });

    const createPreview = async () => {
      try {
        if (file.size > MAX_ICO_PREVIEW_BYTES) {
          setPreview({ file, status: 'error', ...previewLimitMessage('file-size') });
          return;
        }
        const buffer = await file.arrayBuffer();
        if (cancelled) return;
        const limit = getIcoPreviewLimit(buffer);
        if (limit) {
          setPreview({ file, status: 'error', ...previewLimitMessage(limit) });
          return;
        }

        const { frames } = parseIcoDirectory(buffer);
        const frame = frames[0];
        if (!frame) throw new Error(t('Preview could not be created. Conversion is still available.'));
        const blob = await frameToPngBlob(frame);
        if (cancelled) return;
        previewUrl = URL.createObjectURL(blob);
        setPreview({
          file,
          status: 'ready',
          url: previewUrl,
          width: frame.width,
          height: frame.height,
          bitCount: frame.bitCount,
          format: frame.isPng ? 'PNG stream' : 'DIB bitmap',
        });
      } catch {
        if (!cancelled) {
          setPreview({ file, status: 'error', message: 'Preview could not be created. Conversion is still available.' });
        }
      }
    };

    void createPreview();
    return () => {
      cancelled = true;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [file, t]);

  return (
    <section
      style={{
        background: 'var(--surface)',
        padding: '1.25rem',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.85rem',
      }}
      aria-label={t('Source preview')}
    >
      <div>
        <strong>{t('Source preview')}</strong>
        {count > 1 && <div style={{ fontSize: '0.85rem', opacity: 0.75 }}>{t('Previewing first of {count} files', { count })}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div
          style={{
            width: '128px',
            height: '128px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            overflow: 'hidden',
            borderRadius: '8px',
            background: 'repeating-conic-gradient(#80808020 0% 25%, transparent 0% 50%) 50% / 12px 12px',
          }}
        >
          {currentPreview.status === 'ready' && (
            <img
              src={currentPreview.url}
              alt={file.name}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
            />
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 0 }}>
          <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{file.name}</span>
          {currentPreview.status === 'ready' && (
            <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>
              {t('First ICO frame: {width} × {height} px · {bitCount}-bit · {format}', {
                width: currentPreview.width,
                height: currentPreview.height,
                bitCount: currentPreview.bitCount,
                format: t(currentPreview.format),
              })}
            </span>
          )}
          <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>
            {t('The preview shows the first frame. Convert extracts every frame from all {count} selected files.', { count })}
          </span>
        </div>
      </div>
      {currentPreview.status === 'loading' && (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }} role="status">
          {t('Preparing ICO preview…')}
        </p>
      )}
      {currentPreview.status === 'error' && (
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }} role="status">
          {t(currentPreview.message, currentPreview.params)}
        </p>
      )}
    </section>
  );
}

export default function IconConverterTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-icon-converter');
  const title = meta.title && meta.title !== 'img-icon-converter' ? meta.title : 'Image to Favicon / ICO';
  const description = meta.description || 'Convert images to favicon.ico at your chosen resolution, or extract frames from ICO files.';

  const [mode, setMode] = useState<Mode>(() => {
    const pending = peekPendingFiles('/image/icon-converter');
    if (pending && pending.length > 0) {
      const c = classifyFile(pending[0]);
      return c.format === 'ico' ? 'ico-to-png' : 'image-to-ico';
    }
    return 'image-to-ico';
  });
  const [resolution, setResolution] = useState('recommended');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const [processing, setProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // ICO to PNG state
  const [extractedFrames, setExtractedFrames] = useState<ExtractedFrameItem[]>([]);

  // PNG to ICO state
  const [generatedIcos, setGeneratedIcos] = useState<GeneratedIcoItem[]>([]);

  const handleFiles = useCallback((files: File[]) => {
    if (!files || files.length === 0) return;
    setError(null);
    setExtractedFrames([]);
    setGeneratedIcos([]);
    setProgress(0);

    const classes = files.map(classifyFile);
    const hasIco = classes.some((c) => c.format === 'ico');
    const hasImage = classes.some((c) => c.isStandardImage);

    if (hasIco && hasImage) {
      setSelectedFiles([]);
      setError(
        'Mixed input formats: cannot process ICO and image files in the same batch. Please upload either ICO files or supported images.',
      );
      return;
    }

    if (!hasIco && !hasImage) {
      setSelectedFiles([]);
      setError('Please upload an ICO file or a supported image format.');
      return;
    }

    const targetMode: Mode = hasIco ? 'ico-to-png' : 'image-to-ico';
    setMode(targetMode);
    setSelectedFiles(files);
  }, []);

  const handleConvert = useCallback(async () => {
    const files = selectedFiles;
    if (files.length === 0 || processing) return;
    setError(null);
    setProcessing(true);
    setProgress(0);

    try {
      if (mode === 'ico-to-png') {
        const items: ExtractedFrameItem[] = [];
        const nameTracker = new Map<string, number>();

        for (let fIdx = 0; fIdx < files.length; fIdx++) {
          const file = files[fIdx];
          const buffer = await file.arrayBuffer();
          const { frames } = parseIcoDirectory(buffer);
          const base = file.name.replace(/\.[^.]+$/, '');

          for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const pngBlob = await frameToPngBlob(frame);

            const dimKey = `${base}-${frame.width}x${frame.height}`;
            const count = nameTracker.get(dimKey) || 0;
            nameTracker.set(dimKey, count + 1);

            const suffix = count === 0 ? '' : `-${count + 1}`;
            const filename = `${dimKey}${suffix}.png`;

            items.push({
              id: `${file.name}-${i}-${Date.now()}`,
              name: filename,
              width: frame.width,
              height: frame.height,
              bitCount: frame.bitCount,
              format: frame.isPng ? 'PNG stream' : 'DIB bitmap',
              blob: pngBlob,
            });
          }
          setProgress(((fIdx + 1) / files.length) * 100);
        }

        if (items.length === 0) {
          throw new Error('No valid icon frames could be found in the uploaded file(s).');
        }
        setExtractedFrames(items);
      } else {
        // Image to ICO
        const icoItems: GeneratedIcoItem[] = [];
        const nameCounts = new Map<string, number>();
        const usedNames = new Set<string>();
        const sizes = resolution === 'recommended' ? RECOMMENDED_SIZES : resolution === 'all' ? ALL_SIZES : [Number(resolution)];

        for (let fIdx = 0; fIdx < files.length; fIdx++) {
          const file = files[fIdx];
          const img = await decodeImage(file);

          const canvases = sizes.map((size) => imageToIconCanvas(img, size));
          const icoBlob = await encodeIco(canvases);
          const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
          let outputName = 'favicon.ico';
          if (files.length > 1) {
            let count = nameCounts.get(baseName) || 0;
            do {
              outputName = `${baseName}${count === 0 ? '' : `-${count + 1}`}.ico`;
              count += 1;
            } while (usedNames.has(outputName.toLowerCase()));
            nameCounts.set(baseName, count);
            usedNames.add(outputName.toLowerCase());
          }

          icoItems.push({
            name: outputName,
            blob: icoBlob,
            sizes: sizes.join(', '),
          });
          setProgress(((fIdx + 1) / files.length) * 100);
        }

        setGeneratedIcos(icoItems);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error processing icon conversion');
    } finally {
      setProcessing(false);
    }
  }, [mode, processing, resolution, selectedFiles]);

  const handleDownloadAllZip = async () => {
    try {
      if (mode === 'ico-to-png' && extractedFrames.length > 0) {
        const zipBlob = await zipFiles(extractedFrames.map((f) => ({ name: f.name, blob: f.blob })));
        downloadBlob(zipBlob, 'extracted-icon-frames.zip');
      } else if (mode === 'image-to-ico' && generatedIcos.length > 0) {
        const zipBlob = await zipFiles(generatedIcos.map((ico) => ({ name: ico.name, blob: ico.blob })));
        downloadBlob(zipBlob, 'favicons.zip');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate ZIP');
    }
  };

  const handleReset = () => {
    setSelectedFiles([]);
    setExtractedFrames([]);
    setGeneratedIcos([]);
    setError(null);
    setProgress(0);
  };

  const hasResults = extractedFrames.length > 0 || generatedIcos.length > 0;

  return (
    <ToolPage title={title} description={description} currentId="img-icon-converter">
      <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Mode Selector */}
        <div
          style={{
            background: 'var(--surface)',
            padding: '1.25rem',
            borderRadius: '12px',
          }}
        >
          <Field
            label={t('Icon conversion mode')}
            hint={
              mode === 'ico-to-png'
                ? t('Extracts every embedded resolution and frame inside .ICO files into individual transparent PNGs.')
                : t('Converts any supported image into a Windows .ICO with your selected resolution set.')
            }
          >
            <Select
              value={mode}
              disabled={processing || hasResults}
              onChange={(e) => {
                setMode(e.target.value as Mode);
                handleReset();
              }}
              options={[
                { value: 'ico-to-png', label: t('Extract frames: ICO → PNG (extracts 16, 32, 48, 64, 128, 256...)') },
                { value: 'image-to-ico', label: t('Create favicon / ICO from an image') },
              ]}
            />
          </Field>
        </div>

        {mode === 'image-to-ico' && !hasResults && (
          <div style={{ background: 'var(--surface)', padding: '1.25rem', borderRadius: '12px' }}>
            <Field
              label={t('ICO resolution')}
              hint={t('Recommended includes 16×16, 32×32, and 48×48 px. The image stays centered with its aspect ratio preserved.')}
            >
              <Select
                value={resolution}
                disabled={processing}
                onChange={(e) => setResolution(e.target.value)}
                options={[
                  { value: 'recommended', label: t('Recommended multi-size (16, 32, 48 px)') },
                  ...SINGLE_SIZES.map((size) => ({ value: String(size), label: t('Single size ({size}×{size} px)', { size }) })),
                  { value: 'all', label: t('All sizes (16, 32, 48, 64, 128, 256 px)') },
                ]}
              />
            </Field>
          </div>
        )}

        {error && (
          <div style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '0.85rem 1rem', borderRadius: '8px' }}>
            {t(error)}
          </div>
        )}

        {/* Upload Zone */}
        {!hasResults && !processing && (
          <FileDrop
            accept={`${IMAGE_ACCEPT},.ico,image/x-icon,image/vnd.microsoft.icon`}
            multiple={true}
            label={
              mode === 'ico-to-png'
                ? t('Choose one or more .ICO files or drag them here')
                : t('Choose one or more supported image files to create favicon.ico')
            }
            hint={
              mode === 'ico-to-png'
                ? t('Decodes both PNG streams and standard DIB frames with AND transparency masks.')
                : t('Creates ICO frames at {sizes} px, with transparent padding around the image as needed.', {
                    sizes:
                      resolution === 'recommended' ? '16, 32, and 48' : resolution === 'all' ? '16, 32, 48, 64, 128, and 256' : resolution,
                  })
            }
            onFiles={handleFiles}
          />
        )}

        {!hasResults && selectedFiles.length > 0 && (
          <>
            {mode === 'ico-to-png' ? (
              <IcoSourcePreview file={selectedFiles[0]} count={selectedFiles.length} />
            ) : (
              <ImageSourcePreview file={selectedFiles[0]} count={selectedFiles.length} resolution={resolution} />
            )}
            {!processing && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="primary" onClick={handleConvert}>
                  {t('Convert')}
                </Button>
              </div>
            )}
          </>
        )}

        {/* Processing State */}
        {processing && (
          <div
            style={{
              background: 'var(--surface)',
              padding: '2rem',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              alignItems: 'center',
            }}
          >
            <span>{t('Converting icon files...')}</span>
            <div style={{ width: '100%', maxWidth: '400px' }}>
              <ProgressBar value={progress / 100} />
            </div>
          </div>
        )}

        {/* Results for ICO -> PNG */}
        {mode === 'ico-to-png' && extractedFrames.length > 0 && (
          <div
            style={{
              background: 'var(--surface)',
              padding: '1.25rem',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('Extracted frames ({count})', { count: extractedFrames.length })}</h3>
                <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>
                  {t('Every embedded frame extracted with transparency preserved')}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  {t('Convert more')}
                </Button>
                <span>extracted-icon-frames.zip</span>
                <Button variant="primary" onClick={handleDownloadAllZip}>
                  {t('Download')}
                </Button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {extractedFrames.map((item) => (
                <ExtractedItemRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* Results for image -> ICO */}
        {mode === 'image-to-ico' && generatedIcos.length > 0 && (
          <div
            style={{
              background: 'var(--surface)',
              padding: '1.25rem',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{t('Generated favicons / ICO files')}</h3>
                <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>
                  {t('Embedded resolutions')}:{' '}
                  {generatedIcos[0].sizes
                    .split(', ')
                    .map((size) => `${size}×${size}`)
                    .join(', ')}{' '}
                  px
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  {t('Convert more')}
                </Button>
                {generatedIcos.length > 1 && (
                  <>
                    <span>favicons.zip</span>
                    <Button variant="primary" onClick={handleDownloadAllZip}>
                      {t('Download')}
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {generatedIcos.map((ico, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ fontWeight: 600 }}>{ico.name}</span>
                    <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>
                      {ico.sizes.split(', ').length === 1
                        ? t('1 frame ({sizes} px)', { sizes: ico.sizes })
                        : t('{count} frames ({sizes} px)', { count: ico.sizes.split(', ').length, sizes: ico.sizes })}{' '}
                      · {formatBytes(ico.blob.size)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <Button variant="primary" onClick={() => downloadBlob(ico.blob, ico.name)}>
                      {t('Download')}
                    </Button>
                    <CopyImageButton getImage={() => ico.blob} filename={ico.name} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
