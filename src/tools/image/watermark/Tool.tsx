import { useState, useEffect } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { getToolMeta } from '../../registry';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Field, Slider, Select } from '../../../components/Controls';
import { decodeImage, IMAGE_ACCEPT, EncodableMime } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { withSuffix } from '../../../lib/format';
import { CanvasDocument, TextLayer, ImageLayer, Layer } from '../_canvas/types';
import { useCanvasHistory } from '../_canvas/useCanvasHistory';
import { CanvasStage } from '../_canvas/CanvasStage';
import { exportDocument } from '../_canvas/render';
import { BatchResults, BatchResultItem } from '../../../components/BatchResults';
import { useI18n } from '../../../lib/i18n';
import styles from './Tool.module.css';

type WatermarkType = 'text' | 'image';
type GridPos = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';

const GRID_POSITIONS: Array<{ id: GridPos; label: string; symbol: string }> = [
  { id: 'tl', label: 'Top Left', symbol: '↖' },
  { id: 'tc', label: 'Top Center', symbol: '↑' },
  { id: 'tr', label: 'Top Right', symbol: '↗' },
  { id: 'ml', label: 'Middle Left', symbol: '←' },
  { id: 'mc', label: 'Center', symbol: '·' },
  { id: 'mr', label: 'Middle Right', symbol: '→' },
  { id: 'bl', label: 'Bottom Left', symbol: '↙' },
  { id: 'bc', label: 'Bottom Center', symbol: '↓' },
  { id: 'br', label: 'Bottom Right', symbol: '↘' },
];

export default function Tool() {
  const meta = getToolMeta('img-watermark');
  const { t } = useI18n();

  const [files, setFiles] = useState<File[]>([]);
  const [batchResults, setBatchResults] = useState<BatchResultItem[] | null>(null);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);

  // Watermark settings
  const [wmType, setWmType] = useState<WatermarkType>('text');
  const [wmText, setWmText] = useState<string>('WATERMARK');
  const [wmColor, setWmColor] = useState<string>('#ffffff');
  const [wmOpacity, setWmOpacity] = useState<number>(50); // 0 to 100
  const [wmSizePercent, setWmSizePercent] = useState<number>(30); // 5 to 100% of image width
  const [wmRotation, setWmRotation] = useState<number>(-30); // -180 to 180
  const [activeGridPos, setActiveGridPos] = useState<GridPos>('mc');
  const [marginPercent, setMarginPercent] = useState<number>(5);
  const [isTiled, setIsTiled] = useState<boolean>(false);
  const [tileSpacing, setTileSpacing] = useState<number>(120);

  // Logo image file
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);

  // Format & export
  const [exportMime, setExportMime] = useState<EncodableMime>('image/png');
  const [quality, setQuality] = useState<number>(92);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Selected layer
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>('wm-layer');

  // Canvas history
  const {
    document: doc,
    canUndo,
    canRedo,
    undo,
    redo,
    pushDoc,
    updateDocSilent,
    resetHistory,
  } = useCanvasHistory({
    width: 800,
    height: 600,
    baseImage: null,
    layers: [],
  });

  // Calculate watermark layer dimensions & position
  const computeWatermarkLayout = (imgW: number, imgH: number) => {
    const wmW = Math.max(40, Math.round((imgW * wmSizePercent) / 100));
    const wmH =
      wmType === 'text' ? Math.max(20, Math.round(wmW * 0.3)) : logoImg ? Math.round((wmW * logoImg.height) / logoImg.width) : wmW;
    const mX = Math.round((imgW * marginPercent) / 100);
    const mY = Math.round((imgH * marginPercent) / 100);

    let x = (imgW - wmW) / 2;
    let y = (imgH - wmH) / 2;

    switch (activeGridPos) {
      case 'tl':
        x = mX;
        y = mY;
        break;
      case 'tc':
        x = (imgW - wmW) / 2;
        y = mY;
        break;
      case 'tr':
        x = imgW - wmW - mX;
        y = mY;
        break;
      case 'ml':
        x = mX;
        y = (imgH - wmH) / 2;
        break;
      case 'mc':
        x = (imgW - wmW) / 2;
        y = (imgH - wmH) / 2;
        break;
      case 'mr':
        x = imgW - wmW - mX;
        y = (imgH - wmH) / 2;
        break;
      case 'bl':
        x = mX;
        y = imgH - wmH - mY;
        break;
      case 'bc':
        x = (imgW - wmW) / 2;
        y = imgH - wmH - mY;
        break;
      case 'br':
        x = imgW - wmW - mX;
        y = imgH - wmH - mY;
        break;
    }

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(wmW),
      height: Math.round(wmH),
    };
  };

  // Build layers based on current settings
  const buildLayers = (imgW: number, imgH: number): Layer[] => {
    const layout = computeWatermarkLayout(imgW, imgH);

    if (isTiled) {
      const layers: Layer[] = [];
      const step = Math.max(60, tileSpacing);
      const startX = -imgW;
      const startY = -imgH;
      const endX = imgW * 2;
      const endY = imgH * 2;

      let idx = 0;
      for (let y = startY; y < endY; y += step) {
        for (let x = startX; x < endX; x += step) {
          if (wmType === 'text') {
            layers.push({
              id: `wm-tile-${idx++}`,
              type: 'text',
              text: wmText,
              x,
              y,
              width: layout.width,
              height: layout.height,
              fontSize: Math.max(16, Math.round((layout.width / (wmText.length || 1)) * 1.5)),
              fontFamily: 'sans',
              fill: wmColor,
              stroke: '#000000',
              strokeWidth: 1,
              rotation: wmRotation,
              opacity: wmOpacity / 100,
            } as TextLayer);
          } else if (logoImg) {
            layers.push({
              id: `wm-tile-${idx++}`,
              type: 'image',
              image: logoImg,
              x,
              y,
              width: layout.width,
              height: layout.height,
              rotation: wmRotation,
              opacity: wmOpacity / 100,
            } as ImageLayer);
          }
        }
      }
      return layers;
    }

    if (wmType === 'text') {
      const textLayer: TextLayer = {
        id: 'wm-layer',
        type: 'text',
        text: wmText,
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        fontSize: Math.max(18, Math.round((layout.width / (wmText.length || 1)) * 1.5)),
        fontFamily: 'sans',
        fill: wmColor,
        stroke: '#000000',
        strokeWidth: 2,
        rotation: wmRotation,
        opacity: wmOpacity / 100,
      };
      return [textLayer];
    } else if (logoImg) {
      const imgLayer: ImageLayer = {
        id: 'wm-layer',
        type: 'image',
        image: logoImg,
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        rotation: wmRotation,
        opacity: wmOpacity / 100,
      };
      return [imgLayer];
    }

    return [];
  };

  // Sync layers when settings change on the loaded single image
  useEffect(() => {
    if (doc.baseImage && doc.width > 0 && doc.height > 0) {
      const newLayers = buildLayers(doc.width, doc.height);
      pushDoc({
        ...doc,
        layers: newLayers,
      });
    }
  }, [wmType, wmText, wmColor, wmOpacity, wmSizePercent, wmRotation, activeGridPos, marginPercent, isTiled, tileSpacing, logoImg]);

  const handleFileDrop = async (dropped: File[]) => {
    if (dropped.length === 0) return;
    setFiles(dropped);
    setBatchResults(null);

    // Load first image into interactive editor
    try {
      const firstImg = await decodeImage(dropped[0]);
      const initialLayers = buildLayers(firstImg.width, firstImg.height);
      const newDoc: CanvasDocument = {
        width: firstImg.width,
        height: firstImg.height,
        baseImage: firstImg,
        layers: initialLayers,
      };
      resetHistory(newDoc);
      setSelectedLayerId('wm-layer');
    } catch (err) {
      alert(t(err instanceof Error ? err.message : 'Failed to decode image.'));
    }
  };

  const handleLogoDrop = async (logoFiles: File[]) => {
    if (logoFiles.length === 0) return;
    try {
      const img = await decodeImage(logoFiles[0]);
      setLogoImg(img);
      setWmType('image');
    } catch (err) {
      alert(t(err instanceof Error ? err.message : 'Failed to load logo.'));
    }
  };

  // Batch process all images
  const processAllImages = async () => {
    if (files.length === 0) return;
    setIsProcessingBatch(true);
    try {
      const results: BatchResultItem[] = [];

      for (const f of files) {
        const img = await decodeImage(f);
        const layers = buildLayers(img.width, img.height);
        const itemDoc: CanvasDocument = {
          width: img.width,
          height: img.height,
          baseImage: img,
          layers,
        };

        const blob = await exportDocument(itemDoc, exportMime, quality / 100);
        const ext = exportMime === 'image/jpeg' ? 'jpg' : exportMime === 'image/webp' ? 'webp' : 'png';
        const outName = withSuffix(f.name, '-watermarked', ext);

        results.push({
          name: outName,
          blob,
          originalSize: f.size,
        });
      }

      setBatchResults(results);
    } catch (err) {
      alert(t(err instanceof Error ? err.message : 'Batch processing failed.'));
    } finally {
      setIsProcessingBatch(false);
    }
  };

  // Single export
  const handleSingleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await exportDocument(doc, exportMime, quality / 100);
      const ext = exportMime === 'image/jpeg' ? 'jpg' : exportMime === 'image/webp' ? 'webp' : 'png';
      const outName = withSuffix(files[0] ? files[0].name : 'watermarked.png', '-watermarked', ext);
      downloadBlob(blob, outName);
    } catch (err) {
      alert(t(err instanceof Error ? err.message : 'Export failed.'));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-watermark">
      {files.length === 0 ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          multiple={true}
          label={t('Choose one or more images to watermark')}
          hint={t('Supports JPG, PNG, WebP, GIF, BMP, AVIF, HEIC and SVG.')}
          onFiles={handleFileDrop}
        />
      ) : batchResults ? (
        <BatchResults items={batchResults} onReset={() => setBatchResults(null)} />
      ) : (
        <div className={styles.container}>
          {/* Top Bar with History & Actions */}
          <div className={styles.topBar}>
            <div className={styles.historyGroup}>
              <button
                type="button"
                className={styles.iconBtn}
                title={t('Undo (Ctrl+Z)')}
                data-testid="undo-btn"
                disabled={!canUndo}
                onClick={undo}
              >
                ↩
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                title={t('Redo (Ctrl+Shift+Z)')}
                data-testid="redo-btn"
                disabled={!canRedo}
                onClick={redo}
              >
                ↪
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              {files.length > 1 && (
                <Button variant="primary" disabled={isProcessingBatch} onClick={processAllImages}>
                  {isProcessingBatch ? t('Processing…') : t('Apply to all ({count} images)', { count: files.length })}
                </Button>
              )}
              <Button variant="secondary" onClick={() => setFiles([])}>
                {t('Change images')}
              </Button>
            </div>
          </div>

          {/* Interactive Canvas */}
          <CanvasStage
            document={doc}
            selectedLayerId={isTiled ? null : selectedLayerId}
            mode="select"
            onSelectLayer={setSelectedLayerId}
            onUpdateDocSilent={updateDocSilent}
            onPushDoc={pushDoc}
          />

          {/* Settings Panel */}
          <div className={styles.settingsPanel}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button variant={wmType === 'text' ? 'primary' : 'secondary'} onClick={() => setWmType('text')}>
                {t('Text watermark')}
              </Button>
              <Button variant={wmType === 'image' ? 'primary' : 'secondary'} onClick={() => setWmType('image')}>
                {t('Logo image')}
              </Button>
            </div>

            <div className={styles.grid}>
              {wmType === 'text' ? (
                <>
                  <Field label={t('Watermark text')}>
                    <input type="text" className="input" value={wmText} onChange={(e) => setWmText(e.target.value)} />
                  </Field>

                  <Field label={t('Text colour')}>
                    <div className={styles.colorRow}>
                      <input type="color" className={styles.colorInput} value={wmColor} onChange={(e) => setWmColor(e.target.value)} />
                      <span>{wmColor}</span>
                    </div>
                  </Field>
                </>
              ) : (
                <Field label={t('Logo image')}>
                  {!logoImg ? (
                    <FileDrop
                      accept="image/*"
                      label={t('Upload logo')}
                      hint={t('PNG with transparency recommended')}
                      onFiles={handleLogoDrop}
                    />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <img
                        src={logoImg.src}
                        alt={t('Logo preview')}
                        style={{ maxHeight: '48px', maxWidth: '100px', objectFit: 'contain' }}
                      />
                      <Button variant="secondary" onClick={() => setLogoImg(null)}>
                        {t('Change logo')}
                      </Button>
                    </div>
                  )}
                </Field>
              )}

              <Field label={t('Size (percentage of image width)')}>
                <Slider value={wmSizePercent} min={5} max={100} unit="%" onChange={setWmSizePercent} />
              </Field>

              <Field label={t('Opacity')}>
                <Slider value={wmOpacity} min={5} max={100} unit="%" onChange={setWmOpacity} />
              </Field>

              <Field label={t('Rotation')}>
                <Slider value={wmRotation} min={-180} max={180} unit="°" onChange={setWmRotation} />
              </Field>

              <Field label={t('Position (9-grid)')}>
                <div className={styles.grid9}>
                  {GRID_POSITIONS.map((gp) => (
                    <button
                      key={gp.id}
                      type="button"
                      title={t(gp.label)}
                      className={`${styles.grid9Btn} ${activeGridPos === gp.id && !isTiled ? styles.grid9BtnActive : ''}`}
                      disabled={isTiled}
                      onClick={() => setActiveGridPos(gp.id)}
                    >
                      {gp.symbol}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label={t('Margin from edge')}>
                <Slider value={marginPercent} min={0} max={25} unit="%" disabled={isTiled} onChange={setMarginPercent} />
              </Field>
            </div>

            {/* Tile Mode Section */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                paddingTop: '0.5rem',
                borderTop: '1px solid var(--border)',
              }}
            >
              <label className="checkbox-label">
                <input type="checkbox" checked={isTiled} onChange={(e) => setIsTiled(e.target.checked)} />
                <span>{t('Tile watermark diagonally across the image')}</span>
              </label>

              {isTiled && (
                <div className={styles.grid}>
                  <Field label={t('Tile spacing')}>
                    <Slider value={tileSpacing} min={60} max={300} unit="px" onChange={setTileSpacing} />
                  </Field>
                </div>
              )}
            </div>
          </div>

          {/* Export Row */}
          <div className={styles.exportRow}>
            <div className={styles.exportControls}>
              <Field label={t('Format')}>
                <Select
                  value={exportMime}
                  onChange={(e) => setExportMime(e.target.value as EncodableMime)}
                  options={[
                    { value: 'image/png', label: t('PNG') },
                    { value: 'image/jpeg', label: t('JPEG') },
                    { value: 'image/webp', label: t('WebP') },
                  ]}
                />
              </Field>

              {exportMime !== 'image/png' && (
                <Field label={t('Quality')}>
                  <Slider value={quality} min={10} max={100} unit="%" onChange={setQuality} />
                </Field>
              )}
            </div>

            <Button variant="primary" data-testid="export-btn" disabled={isExporting} onClick={handleSingleExport}>
              {isExporting ? t('Exporting…') : t('Download image')}
            </Button>
          </div>
        </div>
      )}
    </ToolPage>
  );
}
