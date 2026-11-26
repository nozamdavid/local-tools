import React, { useState, useEffect, useRef, useId } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { ProgressBar } from '../../components/ProgressBar';
import { ResultPanel } from '../../components/ResultPanel';
import { Field, Select, Slider, Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { getVideoMeta, type VideoMeta } from '../../lib/media';
import { formatBytes, formatDuration, withSuffix } from '../../lib/format';
import { runFFmpeg } from '../../lib/ffmpeg';
import { useJob } from '../../lib/useJob';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { useI18n } from '../../lib/i18n';
import styles from './Tool.module.css';

type OverlayType = 'text' | 'image';
type QuickPosition = 'tl' | 'tc' | 'tr' | 'ml' | 'c' | 'mr' | 'bl' | 'bc' | 'br';

const FONT_OPTIONS = [
  { value: 'Inter, system-ui, -apple-system, sans-serif', label: 'Inter / System Sans' },
  { value: 'Georgia, serif', label: 'Georgia Serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'Impact, fantasy, sans-serif', label: 'Impact' },
];

const QUICK_POSITIONS: { id: QuickPosition; label: string; icon: string }[] = [
  { id: 'tl', label: 'Top Left', icon: '↖' },
  { id: 'tc', label: 'Top Center', icon: '↑' },
  { id: 'tr', label: 'Top Right', icon: '↗' },
  { id: 'ml', label: 'Middle Left', icon: '←' },
  { id: 'c', label: 'Center', icon: '•' },
  { id: 'mr', label: 'Middle Right', icon: '→' },
  { id: 'bl', label: 'Bottom Left', icon: '↙' },
  { id: 'bc', label: 'Bottom Center', icon: '↓' },
  { id: 'br', label: 'Bottom Right', icon: '↘' },
];

interface OverlayRenderResult {
  width: number;
  height: number;
  dataUrl: string;
  blob: Blob;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const byteString = atob(parts[1]);
  const mime = parts[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mime });
}

function calculateQuickPosition(
  id: QuickPosition,
  overlayWidth: number,
  overlayHeight: number,
  videoWidth: number,
  videoHeight: number,
  marginPercent: number,
): { x: number; y: number } {
  const fw = overlayWidth / videoWidth;
  const fh = overlayHeight / videoHeight;
  const m = marginPercent / 100;

  let x: number;
  let y: number;

  if (id === 'tl' || id === 'ml' || id === 'bl') {
    x = m;
  } else if (id === 'tc' || id === 'c' || id === 'bc') {
    x = (1 - fw) / 2;
  } else {
    x = 1 - m - fw;
  }

  if (id === 'tl' || id === 'tc' || id === 'tr') {
    y = m;
  } else if (id === 'ml' || id === 'c' || id === 'mr') {
    y = (1 - fh) / 2;
  } else {
    y = 1 - m - fh;
  }

  const maxX = Math.max(0, 1 - fw);
  const maxY = Math.max(0, 1 - fh);

  return {
    x: Math.max(0, Math.min(maxX, x)),
    y: Math.max(0, Math.min(maxY, y)),
  };
}

export default function OverlayTool() {
  const { t } = useI18n();
  const meta = getToolMeta('overlay');

  // Step 1: Video File state
  const [file, setFile] = useState<File | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const videoUrl = useObjectUrl(file);

  // Step 2: Overlay Type
  const [overlayType, setOverlayType] = useState<OverlayType>('text');

  // Text Overlay state
  const [text, setText] = useState<string>('loconvert');
  const [fontFamily, setFontFamily] = useState<string>(FONT_OPTIONS[0].value);
  const [fontSize, setFontSize] = useState<number>(36);
  const [textColor, setTextColor] = useState<string>('#ffffff');
  const [isBold, setIsBold] = useState<boolean>(true);
  const [textOpacity, setTextOpacity] = useState<number>(100);
  const [hasBgBox, setHasBgBox] = useState<boolean>(false);
  const [bgBoxColor, setBgBoxColor] = useState<string>('#000000');
  const [bgBoxPadding, setBgBoxPadding] = useState<number>(12);
  const [bgBoxOpacity, setBgBoxOpacity] = useState<number>(75);
  const [hasShadow, setHasShadow] = useState<boolean>(true);

  // Image Overlay state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [imageSizePercent, setImageSizePercent] = useState<number>(25);
  const [imageOpacity, setImageOpacity] = useState<number>(100);

  // Placement state (normalized 0..1 of the video frame)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0.7, y: 0.8 });
  const [marginPercent, setMarginPercent] = useState<number>(5);
  const [activeQuickPos, setActiveQuickPos] = useState<QuickPosition | null>('br');

  // Current rasterized overlay
  const [overlayResult, setOverlayResult] = useState<OverlayRenderResult | null>(null);

  // Preview playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);

  // Dragging state
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    posX: number;
    posY: number;
  } | null>(null);

  const previewContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const job = useJob();

  // Unique control IDs
  const textInputId = useId();
  const fontSelectId = useId();
  const boldCheckboxId = useId();
  const bgBoxCheckboxId = useId();
  const shadowCheckboxId = useId();

  // Load Image element when image file changes
  useEffect(() => {
    if (!imageFile) {
      setImageElement(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    const img = new Image();
    img.onload = () => {
      setImageElement(img);
    };
    img.src = url;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [imageFile]);

  // Adjust default font size based on video resolution
  useEffect(() => {
    if (videoMeta?.height) {
      const suggestedSize = Math.max(16, Math.min(120, Math.round(videoMeta.height * 0.08)));
      setFontSize(suggestedSize);
    }
  }, [videoMeta?.height]);

  // Rasterize overlay to transparent PNG on canvas at video's native scale
  useEffect(() => {
    if (!videoMeta || videoMeta.width <= 0 || videoMeta.height <= 0) {
      setOverlayResult(null);
      return;
    }

    const { width: vidW, height: vidH } = videoMeta;

    if (overlayType === 'text') {
      if (!text.trim()) {
        const emptyCanvas = document.createElement('canvas');
        emptyCanvas.width = 2;
        emptyCanvas.height = 2;
        const dataUrl = emptyCanvas.toDataURL('image/png');
        setOverlayResult({ width: 2, height: 2, dataUrl, blob: dataUrlToBlob(dataUrl) });
        return;
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const fontStr = `${isBold ? 'bold ' : 'normal '}${fontSize}px ${fontFamily}`;
      ctx.font = fontStr;

      const metrics = ctx.measureText(text);
      const textWidth = Math.ceil(metrics.width);
      const ascent = Math.ceil(metrics.actualBoundingBoxAscent || fontSize * 0.8);
      const descent = Math.ceil(metrics.actualBoundingBoxDescent || fontSize * 0.25);
      const textHeight = ascent + descent;

      const shadowBlur = hasShadow ? Math.max(3, Math.round(fontSize * 0.12)) : 0;
      const shadowOffsetX = hasShadow ? Math.max(2, Math.round(fontSize * 0.05)) : 0;
      const shadowOffsetY = hasShadow ? Math.max(2, Math.round(fontSize * 0.05)) : 0;
      const shadowMargin = hasShadow ? Math.ceil(shadowBlur + Math.max(shadowOffsetX, shadowOffsetY) + 2) : 0;

      const pad = hasBgBox ? bgBoxPadding : 0;

      const totalWidth = Math.min(vidW, Math.max(4, textWidth + pad * 2 + shadowMargin * 2));
      const totalHeight = Math.min(vidH, Math.max(4, textHeight + pad * 2 + shadowMargin * 2));

      canvas.width = totalWidth;
      canvas.height = totalHeight;

      ctx.clearRect(0, 0, totalWidth, totalHeight);

      // Draw background box if enabled
      if (hasBgBox) {
        ctx.save();
        if (hasShadow) {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
          ctx.shadowBlur = shadowBlur;
          ctx.shadowOffsetX = shadowOffsetX;
          ctx.shadowOffsetY = shadowOffsetY;
        }
        ctx.globalAlpha = (textOpacity / 100) * (bgBoxOpacity / 100);
        ctx.fillStyle = bgBoxColor;
        const boxX = shadowMargin;
        const boxY = shadowMargin;
        const boxW = totalWidth - shadowMargin * 2;
        const boxH = totalHeight - shadowMargin * 2;
        const radius = Math.min(8, Math.round(boxH / 4));
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(boxX, boxY, boxW, boxH, radius);
        } else {
          ctx.rect(boxX, boxY, boxW, boxH);
        }
        ctx.fill();
        ctx.restore();
      }

      // Draw text
      ctx.save();
      ctx.globalAlpha = textOpacity / 100;
      ctx.font = fontStr;
      ctx.fillStyle = textColor;
      ctx.textBaseline = 'alphabetic';

      if (hasShadow && !hasBgBox) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = shadowBlur;
        ctx.shadowOffsetX = shadowOffsetX;
        ctx.shadowOffsetY = shadowOffsetY;
      }

      const textX = shadowMargin + pad;
      const textY = shadowMargin + pad + ascent;

      ctx.fillText(text, textX, textY);
      ctx.restore();

      const dataUrl = canvas.toDataURL('image/png');
      setOverlayResult({
        width: totalWidth,
        height: totalHeight,
        dataUrl,
        blob: dataUrlToBlob(dataUrl),
      });
    } else {
      // Image Overlay
      if (!imageElement || !imageElement.naturalWidth || !imageElement.naturalHeight) {
        setOverlayResult(null);
        return;
      }

      const aspect = imageElement.naturalHeight / imageElement.naturalWidth;
      let targetW = Math.max(4, Math.round(vidW * (imageSizePercent / 100)));
      let targetH = Math.max(4, Math.round(targetW * aspect));

      if (targetH > vidH) {
        targetH = vidH;
        targetW = Math.max(4, Math.round(targetH / aspect));
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, targetW, targetH);
      ctx.save();
      ctx.globalAlpha = imageOpacity / 100;
      ctx.drawImage(imageElement, 0, 0, targetW, targetH);
      ctx.restore();

      const dataUrl = canvas.toDataURL('image/png');
      setOverlayResult({
        width: targetW,
        height: targetH,
        dataUrl,
        blob: dataUrlToBlob(dataUrl),
      });
    }
  }, [
    overlayType,
    text,
    fontFamily,
    fontSize,
    textColor,
    isBold,
    textOpacity,
    hasBgBox,
    bgBoxColor,
    bgBoxPadding,
    bgBoxOpacity,
    hasShadow,
    imageElement,
    imageSizePercent,
    imageOpacity,
    videoMeta,
  ]);

  // Keep position anchored or clamped when overlay size changes
  useEffect(() => {
    if (!videoMeta || !overlayResult || overlayResult.width <= 0 || overlayResult.height <= 0) {
      return;
    }
    if (activeQuickPos) {
      const updated = calculateQuickPosition(
        activeQuickPos,
        overlayResult.width,
        overlayResult.height,
        videoMeta.width,
        videoMeta.height,
        marginPercent,
      );
      setPos(updated);
    } else {
      const fw = overlayResult.width / videoMeta.width;
      const fh = overlayResult.height / videoMeta.height;
      setPos((prev) => ({
        x: Math.max(0, Math.min(Math.max(0, 1 - fw), prev.x)),
        y: Math.max(0, Math.min(Math.max(0, 1 - fh), prev.y)),
      }));
    }
  }, [overlayResult?.width, overlayResult?.height, videoMeta?.width, videoMeta?.height, activeQuickPos, marginPercent]);

  // Global window listeners during active dragging
  useEffect(() => {
    if (!isDragging) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!dragStartRef.current || !previewContainerRef.current || !videoMeta || !overlayResult) {
        return;
      }
      const rect = previewContainerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dx = (e.clientX - dragStartRef.current.startX) / rect.width;
      const dy = (e.clientY - dragStartRef.current.startY) / rect.height;

      const fw = overlayResult.width / videoMeta.width;
      const fh = overlayResult.height / videoMeta.height;
      const maxX = Math.max(0, 1 - fw);
      const maxY = Math.max(0, 1 - fh);

      const nextX = Math.max(0, Math.min(maxX, dragStartRef.current.posX + dx));
      const nextY = Math.max(0, Math.min(maxY, dragStartRef.current.posY + dy));

      setPos({ x: nextX, y: nextY });
      setActiveQuickPos(null);
    };

    const onPointerUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [isDragging, videoMeta, overlayResult]);

  const handleVideoFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setMetaError(null);
    setVideoMeta(null);
    setActiveQuickPos('br');
    job.reset();

    try {
      const vMeta = await getVideoMeta(selected);
      setVideoMeta(vMeta);
    } catch {
      setMetaError('Could not read video metadata, but you can still attempt watermarking.');
    }
  };

  const handleImageFiles = (files: File[]) => {
    if (files.length === 0) return;
    setImageFile(files[0]);
  };

  const handleReset = () => {
    setFile(null);
    setVideoMeta(null);
    setMetaError(null);
    setImageFile(null);
    setImageElement(null);
    job.reset();
  };

  const handleQuickPosClick = (id: QuickPosition) => {
    if (!videoMeta || !overlayResult || overlayResult.width <= 0 || overlayResult.height <= 0) {
      return;
    }
    setActiveQuickPos(id);
    const newPos = calculateQuickPosition(id, overlayResult.width, overlayResult.height, videoMeta.width, videoMeta.height, marginPercent);
    setPos(newPos);
  };

  const handleMarginChange = (val: number) => {
    setMarginPercent(val);
    if (activeQuickPos && videoMeta && overlayResult && overlayResult.width > 0) {
      const newPos = calculateQuickPosition(
        activeQuickPos,
        overlayResult.width,
        overlayResult.height,
        videoMeta.width,
        videoMeta.height,
        val,
      );
      setPos(newPos);
    }
  };

  // Pointer drag start on overlay
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: pos.x,
      posY: pos.y,
    };
  };

  const togglePlayback = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (time: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleApplyWatermark = () => {
    if (!file || !videoMeta || !overlayResult || overlayResult.width <= 0 || overlayResult.height <= 0) {
      return;
    }

    job.run(async (setProgress) => {
      const inputExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.mp4';
      const inputVideoName = `input${inputExt}`;
      const overlayPngName = 'overlay.png';
      const outputName = withSuffix(file.name, '-watermarked', 'mp4');

      const overlayX = Math.max(0, Math.min(videoMeta.width - overlayResult.width, Math.round(pos.x * videoMeta.width)));
      const overlayY = Math.max(0, Math.min(videoMeta.height - overlayResult.height, Math.round(pos.y * videoMeta.height)));

      const args = [
        '-i',
        inputVideoName,
        '-i',
        overlayPngName,
        '-filter_complex',
        `[0:v][1:v]overlay=${overlayX}:${overlayY}[outv]`,
        '-map',
        '[outv]',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'copy',
        '-movflags',
        '+faststart',
        outputName,
      ];

      return await runFFmpeg({
        inputs: [
          { name: inputVideoName, data: file },
          { name: overlayPngName, data: overlayResult.blob },
        ],
        args,
        output: outputName,
        onProgress: setProgress,
      });
    });
  };

  const canApply = Boolean(
    file &&
    videoMeta &&
    overlayResult &&
    overlayResult.width > 0 &&
    overlayResult.height > 0 &&
    (overlayType === 'text' ? text.trim().length > 0 : Boolean(imageFile && imageElement)),
  );

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="overlay">
      {!file ? (
        <FileDrop
          accept="video/*"
          label={t('Choose a video or drag it here')}
          hint={t('Supports MP4, MOV, WebM, MKV, AVI and more.')}
          onFiles={handleVideoFiles}
        />
      ) : (
        <div className={styles.container}>
          {metaError && <div className="error-banner">{t(metaError)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          {job.status === 'done' && job.result ? (
            <ResultPanel
              blob={job.result}
              filename={withSuffix(file.name, '-watermarked', 'mp4')}
              kind="video"
              originalSize={file.size}
              beforePreview={videoUrl ? <video controls src={videoUrl} className="preview-media" playsInline /> : null}
              onReset={handleReset}
            />
          ) : (
            <div>
              <div className="meta-chips">
                <span className="meta-chip">
                  {t('Name:')} <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  {t('Size:')} <strong>{formatBytes(file.size)}</strong>
                </span>
                {videoMeta && (
                  <>
                    <span className="meta-chip">
                      {t('Duration:')} <strong>{formatDuration(videoMeta.duration)}</strong>
                    </span>
                    <span className="meta-chip">
                      {t('Resolution:')}{' '}
                      <strong>
                        {videoMeta.width}x{videoMeta.height}
                      </strong>
                    </span>
                  </>
                )}
              </div>

              {job.status === 'running' ? (
                <ProgressBar value={job.progress} label={t('Applying watermark...')} />
              ) : (
                <>
                  {/* Live Video Preview with Draggable Overlay */}
                  <div className={styles.previewCard}>
                    <div className={styles.previewTitle}>{t('Live Preview (Drag watermark to reposition)')}</div>
                    <div
                      ref={previewContainerRef}
                      className={styles.previewContainer}
                      style={{
                        aspectRatio: videoMeta ? `${videoMeta.width} / ${videoMeta.height}` : '16/9',
                      }}
                    >
                      <video
                        ref={videoRef}
                        src={videoUrl || undefined}
                        className={styles.previewVideo}
                        playsInline
                        muted
                        preload="auto"
                        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                      />

                      {overlayResult && videoMeta && overlayResult.width > 0 && overlayResult.height > 0 && (
                        <div
                          className={`${styles.overlayBox} ${isDragging ? styles.overlayDragging : ''}`}
                          style={{
                            left: `${pos.x * 100}%`,
                            top: `${pos.y * 100}%`,
                            width: `${(overlayResult.width / videoMeta.width) * 100}%`,
                            height: `${(overlayResult.height / videoMeta.height) * 100}%`,
                          }}
                          onPointerDown={handlePointerDown}
                        >
                          <img src={overlayResult.dataUrl} alt={t('Watermark')} className={styles.overlayImage} draggable={false} />
                        </div>
                      )}
                    </div>

                    {videoMeta && (
                      <div className={styles.playbackBar}>
                        <button type="button" className={styles.playToggleBtn} onClick={togglePlayback}>
                          {isPlaying ? `⏸ ${t('Pause')}` : `▶ ${t('Play')}`}
                        </button>
                        <input
                          type="range"
                          className={styles.scrubber}
                          min={0}
                          max={videoMeta.duration || 1}
                          step={0.05}
                          value={currentTime}
                          onChange={(e) => handleSeek(parseFloat(e.target.value))}
                        />
                        <span className={styles.timeDisplay}>
                          {formatDuration(currentTime)} / {formatDuration(videoMeta.duration)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Overlay Type Tabs */}
                  <div className={styles.tabs}>
                    <button
                      type="button"
                      className={`${styles.tab} ${overlayType === 'text' ? styles.activeTab : ''}`}
                      onClick={() => setOverlayType('text')}
                    >
                      {t('Text Watermark')}
                    </button>
                    <button
                      type="button"
                      className={`${styles.tab} ${overlayType === 'image' ? styles.activeTab : ''}`}
                      onClick={() => setOverlayType('image')}
                    >
                      {t('Image Watermark')}
                    </button>
                  </div>

                  {/* Settings Grid */}
                  <div className={styles.sectionGrid}>
                    {/* Left Column: Overlay Customization */}
                    <div className={styles.settingsCard}>
                      <div className={styles.cardTitle}>{overlayType === 'text' ? t('Text Settings') : t('Image Settings')}</div>

                      {overlayType === 'text' ? (
                        <>
                          <Field label={t('Watermark text')}>
                            <input
                              id={textInputId}
                              type="text"
                              className="select"
                              value={text}
                              onChange={(e) => setText(e.target.value)}
                              placeholder={t('Enter watermark text...')}
                            />
                          </Field>

                          <Field label={t('Font family')}>
                            <Select
                              id={fontSelectId}
                              value={fontFamily}
                              onChange={(e) => setFontFamily(e.target.value)}
                              options={FONT_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
                            />
                          </Field>

                          <Field label={t('Font size')}>
                            <Slider
                              value={fontSize}
                              min={10}
                              max={Math.max(160, Math.round((videoMeta?.height ?? 360) * 0.4))}
                              step={1}
                              unit="px"
                              onChange={setFontSize}
                            />
                          </Field>

                          <div className="field">
                            <label className="field-label">{t('Text color & style')}</label>
                            <div className={styles.colorRow}>
                              <input
                                type="color"
                                className={styles.colorInput}
                                value={textColor}
                                onChange={(e) => setTextColor(e.target.value)}
                              />
                              <span className={styles.colorHex}>{textColor.toUpperCase()}</span>
                              <label className="checkbox-label" htmlFor={boldCheckboxId} style={{ marginLeft: 'auto' }}>
                                <input id={boldCheckboxId} type="checkbox" checked={isBold} onChange={(e) => setIsBold(e.target.checked)} />
                                <span>{t('Bold')}</span>
                              </label>
                            </div>
                          </div>

                          <Field label={t('Opacity')}>
                            <Slider value={textOpacity} min={0} max={100} step={1} unit="%" onChange={setTextOpacity} />
                          </Field>

                          <div className="field" style={{ marginTop: '1rem' }}>
                            <label className="checkbox-label" htmlFor={shadowCheckboxId}>
                              <input
                                id={shadowCheckboxId}
                                type="checkbox"
                                checked={hasShadow}
                                onChange={(e) => setHasShadow(e.target.checked)}
                              />
                              <span>{t('Add drop shadow')}</span>
                            </label>
                          </div>

                          <div className="field" style={{ marginTop: '0.75rem' }}>
                            <label className="checkbox-label" htmlFor={bgBoxCheckboxId}>
                              <input
                                id={bgBoxCheckboxId}
                                type="checkbox"
                                checked={hasBgBox}
                                onChange={(e) => setHasBgBox(e.target.checked)}
                              />
                              <span>{t('Add background box')}</span>
                            </label>
                          </div>

                          {hasBgBox && (
                            <div style={{ paddingLeft: '1rem', borderLeft: '2px solid var(--accent)', marginTop: '0.5rem' }}>
                              <div className="field">
                                <label className="field-label">{t('Box color')}</label>
                                <div className={styles.colorRow}>
                                  <input
                                    type="color"
                                    className={styles.colorInput}
                                    value={bgBoxColor}
                                    onChange={(e) => setBgBoxColor(e.target.value)}
                                  />
                                  <span className={styles.colorHex}>{bgBoxColor.toUpperCase()}</span>
                                </div>
                              </div>

                              <Field label={t('Box opacity')}>
                                <Slider value={bgBoxOpacity} min={0} max={100} step={1} unit="%" onChange={setBgBoxOpacity} />
                              </Field>

                              <Field label={t('Box padding')}>
                                <Slider value={bgBoxPadding} min={0} max={60} step={1} unit="px" onChange={setBgBoxPadding} />
                              </Field>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {!imageFile ? (
                            <FileDrop
                              accept="image/*"
                              rememberInHistory={false}
                              label={t('Choose a watermark image')}
                              hint={t('Supports PNG, JPG, WebP, SVG (PNG with transparency recommended)')}
                              onFiles={handleImageFiles}
                            />
                          ) : (
                            <div>
                              <div className={styles.imagePreviewRow}>
                                {imageElement && <img src={imageElement.src} alt={t('Overlay thumbnail')} className={styles.imageThumb} />}
                                <div className={styles.imageInfo}>
                                  <div className={styles.imageName}>{imageFile.name}</div>
                                  <div className={styles.imageSize}>{formatBytes(imageFile.size)}</div>
                                </div>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => {
                                    setImageFile(null);
                                    setImageElement(null);
                                  }}
                                >
                                  {t('Change')}
                                </Button>
                              </div>

                              <Field label={t('Size (percentage of video width)')}>
                                <Slider value={imageSizePercent} min={5} max={100} step={1} unit="%" onChange={setImageSizePercent} />
                              </Field>

                              <Field label={t('Opacity')}>
                                <Slider value={imageOpacity} min={0} max={100} step={1} unit="%" onChange={setImageOpacity} />
                              </Field>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Right Column: Position & Placement */}
                    <div className={styles.settingsCard}>
                      <div className={styles.cardTitle}>{t('Position & Placement')}</div>

                      <div className={styles.quickPositionWrapper}>
                        <Field label={t('Quick position presets')}>
                          <div className={styles.positionGrid}>
                            {QUICK_POSITIONS.map((qp) => (
                              <button
                                key={qp.id}
                                type="button"
                                title={t(qp.label)}
                                className={`${styles.posBtn} ${activeQuickPos === qp.id ? styles.posBtnActive : ''}`}
                                onClick={() => handleQuickPosClick(qp.id)}
                              >
                                {qp.icon}
                              </button>
                            ))}
                          </div>
                        </Field>

                        <Field label={t('Margin from edge')}>
                          <Slider value={marginPercent} min={0} max={25} step={1} unit="%" onChange={handleMarginChange} />
                        </Field>

                        <div className={styles.dragHint}>
                          💡 {t('Tip: You can also drag the watermark directly on the video preview above to place it anywhere.')}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="action-buttons" style={{ marginTop: '2rem' }}>
                    <Button variant="secondary" onClick={handleReset}>
                      {t('Choose different video')}
                    </Button>
                    <Button variant="primary" onClick={handleApplyWatermark} disabled={!canApply}>
                      {t('Add watermark')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
