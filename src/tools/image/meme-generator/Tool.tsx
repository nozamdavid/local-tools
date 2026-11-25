import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { getToolMeta } from '../../registry';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Field, Slider, Select } from '../../../components/Controls';
import { decodeImage, IMAGE_ACCEPT, EncodableMime } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { withSuffix } from '../../../lib/format';
import { CanvasDocument, TextLayer } from '../_canvas/types';
import { useCanvasHistory } from '../_canvas/useCanvasHistory';
import { CanvasStage } from '../_canvas/CanvasStage';
import { exportDocument } from '../_canvas/render';
import { useI18n } from '../../../lib/i18n';
import styles from './Tool.module.css';

type AspectRatio = '1:1' | '4:5' | '16:9';

export default function Tool() {
  const meta = getToolMeta('img-meme-generator');
  const { t } = useI18n();

  const [hasSource, setHasSource] = useState<boolean>(false);
  const [sourceFilename, setSourceFilename] = useState<string>('meme.png');
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>('meme-top');

  // Blank template settings
  const [blankAspect, setBlankAspect] = useState<AspectRatio>('1:1');
  const [blankColor, setBlankColor] = useState<string>('#ffffff');

  // Uppercase toggles
  const [topUppercase, setTopUppercase] = useState<boolean>(true);
  const [bottomUppercase, setBottomUppercase] = useState<boolean>(true);

  // Format & export
  const [exportMime, setExportMime] = useState<EncodableMime>('image/png');
  const [quality, setQuality] = useState<number>(92);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // History hook
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
    height: 800,
    baseImage: null,
    backgroundColor: '#ffffff',
    layers: [],
  });

  const createInitialLayers = (w: number, h: number): TextLayer[] => {
    const textH = Math.max(60, Math.round(h * 0.22));
    const pad = Math.max(16, Math.round(w * 0.04));
    const fontSize = Math.max(28, Math.round(w / 14));

    const topLayer: TextLayer = {
      id: 'meme-top',
      type: 'text',
      text: 'TOP TEXT',
      x: pad,
      y: pad,
      width: w - pad * 2,
      height: textH,
      fontSize,
      fontFamily: 'impact',
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: Math.max(3, Math.round(fontSize / 8)),
      textAlign: 'center',
      uppercase: true,
      autoFit: true,
      opacity: 1,
    };

    const bottomLayer: TextLayer = {
      id: 'meme-bottom',
      type: 'text',
      text: 'BOTTOM TEXT',
      x: pad,
      y: h - textH - pad,
      width: w - pad * 2,
      height: textH,
      fontSize,
      fontFamily: 'impact',
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: Math.max(3, Math.round(fontSize / 8)),
      textAlign: 'center',
      uppercase: true,
      autoFit: true,
      opacity: 1,
    };

    return [topLayer, bottomLayer];
  };

  const handleFileDrop = async (files: File[]) => {
    if (files.length === 0) return;
    const f = files[0];
    try {
      const img = await decodeImage(f);
      setSourceFilename(f.name);
      const layers = createInitialLayers(img.width, img.height);
      const newDoc: CanvasDocument = {
        width: img.width,
        height: img.height,
        baseImage: img,
        layers,
      };
      resetHistory(newDoc);
      setHasSource(true);
      setSelectedLayerId('meme-top');
    } catch (err) {
      alert(t(err instanceof Error ? err.message : 'Failed to decode image.'));
    }
  };

  const startWithBlank = () => {
    let w = 800;
    let h = 800;
    if (blankAspect === '4:5') {
      w = 800;
      h = 1000;
    } else if (blankAspect === '16:9') {
      w = 1280;
      h = 720;
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = blankColor;
      ctx.fillRect(0, 0, w, h);
    }

    setSourceFilename('meme.png');
    const layers = createInitialLayers(w, h);
    const newDoc: CanvasDocument = {
      width: w,
      height: h,
      baseImage: canvas,
      backgroundColor: blankColor,
      layers,
    };

    resetHistory(newDoc);
    setHasSource(true);
    setSelectedLayerId('meme-top');
  };

  const addExtraText = () => {
    const newId = 'meme-extra-' + Date.now();
    const w = Math.round(doc.width * 0.7);
    const h = Math.round(doc.height * 0.18);
    const fontSize = Math.max(28, Math.round(doc.width / 15));

    const extraLayer: TextLayer = {
      id: newId,
      type: 'text',
      text: 'EXTRA CAPTION',
      x: Math.round((doc.width - w) / 2),
      y: Math.round((doc.height - h) / 2),
      width: w,
      height: h,
      fontSize,
      fontFamily: 'impact',
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: Math.max(3, Math.round(fontSize / 8)),
      textAlign: 'center',
      uppercase: true,
      autoFit: true,
      opacity: 1,
    };

    pushDoc({
      ...doc,
      layers: [...doc.layers, extraLayer],
    });
    setSelectedLayerId(newId);
  };

  const updateTextLayer = (id: string, updater: (prev: TextLayer) => TextLayer) => {
    pushDoc({
      ...doc,
      layers: doc.layers.map((l) => (l.id === id && l.type === 'text' ? updater(l) : l)),
    });
  };

  const deleteLayer = (id: string) => {
    pushDoc({
      ...doc,
      layers: doc.layers.filter((l) => l.id !== id),
    });
    if (selectedLayerId === id) {
      setSelectedLayerId(null);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await exportDocument(doc, exportMime, quality / 100);
      const ext = exportMime === 'image/jpeg' ? 'jpg' : exportMime === 'image/webp' ? 'webp' : 'png';
      const outName = withSuffix(sourceFilename, '-meme', ext);
      downloadBlob(blob, outName);
    } catch (err) {
      alert(t(err instanceof Error ? err.message : 'Export failed.'));
    } finally {
      setIsExporting(false);
    }
  };

  const topLayer = doc.layers.find((l) => l.id === 'meme-top') as TextLayer | undefined;
  const bottomLayer = doc.layers.find((l) => l.id === 'meme-bottom') as TextLayer | undefined;
  const selectedLayer = doc.layers.find((l) => l.id === selectedLayerId) as TextLayer | undefined;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-meme-generator">
      {!hasSource ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <FileDrop
            accept={IMAGE_ACCEPT}
            label={t('Upload an image to make a meme')}
            hint={t('Supports JPG, PNG, WebP, GIF, BMP, AVIF, HEIC and SVG.')}
            onFiles={handleFileDrop}
          />

          <div className={styles.blankTemplatesCard}>
            <div className={styles.templatesTitle}>{t('Or start with a blank canvas template:')}</div>
            <div className={styles.templateOptions}>
              <Field label={t('Aspect ratio')}>
                <div className={styles.btnGroup}>
                  {(['1:1', '4:5', '16:9'] as AspectRatio[]).map((asp) => (
                    <Button key={asp} variant={blankAspect === asp ? 'primary' : 'secondary'} onClick={() => setBlankAspect(asp)}>
                      {asp === '1:1' && t('1:1 Square')}
                      {asp === '4:5' && t('4:5 Portrait')}
                      {asp === '16:9' && t('16:9 Landscape')}
                    </Button>
                  ))}
                </div>
              </Field>

              <Field label={t('Background colour')}>
                <div className={styles.colorRow}>
                  <input
                    type="color"
                    className={styles.colorInput}
                    value={blankColor}
                    aria-label={t('Background colour')}
                    onChange={(e) => setBlankColor(e.target.value)}
                  />
                  <span>{blankColor}</span>
                </div>
              </Field>

              <div style={{ marginTop: 'auto' }}>
                <Button variant="primary" onClick={startWithBlank}>
                  {t('Create blank meme')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.container}>
          {/* Top Bar with History & Actions */}
          <div className={styles.topBar}>
            <div className={styles.historyGroup}>
              <button
                type="button"
                className={styles.iconBtn}
                title={t('Undo (Ctrl+Z)')}
                aria-label={t('Undo')}
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
                aria-label={t('Redo')}
                data-testid="redo-btn"
                disabled={!canRedo}
                onClick={redo}
              >
                ↪
              </button>
              {selectedLayerId && (
                <button
                  type="button"
                  className={styles.iconBtn}
                  title={t('Delete layer (Del)')}
                  aria-label={t('Delete layer')}
                  onClick={() => deleteLayer(selectedLayerId)}
                  style={{ color: 'var(--danger)' }}
                >
                  🗑
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <Button variant="secondary" onClick={addExtraText}>
                {t('+ Add extra text')}
              </Button>
              <Button variant="secondary" onClick={() => setHasSource(false)}>
                {t('Start over')}
              </Button>
            </div>
          </div>

          {/* Interactive Canvas */}
          <CanvasStage
            document={doc}
            selectedLayerId={selectedLayerId}
            mode="select"
            onSelectLayer={setSelectedLayerId}
            onUpdateDocSilent={updateDocSilent}
            onPushDoc={pushDoc}
            onDeleteLayer={deleteLayer}
          />

          {/* Captions Settings Panel */}
          <div className={styles.settingsPanel}>
            <div className={styles.grid}>
              {/* Top Text */}
              {topLayer && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="field-label" style={{ fontWeight: 600 }}>
                      {t('Top caption')}
                    </label>
                    <label className="checkbox-label" style={{ fontSize: '0.8rem' }}>
                      <input
                        type="checkbox"
                        checked={topUppercase}
                        onChange={(e) => {
                          setTopUppercase(e.target.checked);
                          updateTextLayer('meme-top', (l) => ({ ...l, uppercase: e.target.checked }));
                        }}
                      />
                      <span>{t('ALL CAPS')}</span>
                    </label>
                  </div>
                  <input
                    type="text"
                    className="input"
                    value={topLayer.text}
                    aria-label={t('Top caption')}
                    onChange={(e) => updateTextLayer('meme-top', (l) => ({ ...l, text: e.target.value }))}
                  />
                </div>
              )}

              {/* Bottom Text */}
              {bottomLayer && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="field-label" style={{ fontWeight: 600 }}>
                      {t('Bottom caption')}
                    </label>
                    <label className="checkbox-label" style={{ fontSize: '0.8rem' }}>
                      <input
                        type="checkbox"
                        checked={bottomUppercase}
                        onChange={(e) => {
                          setBottomUppercase(e.target.checked);
                          updateTextLayer('meme-bottom', (l) => ({ ...l, uppercase: e.target.checked }));
                        }}
                      />
                      <span>{t('ALL CAPS')}</span>
                    </label>
                  </div>
                  <input
                    type="text"
                    className="input"
                    value={bottomLayer.text}
                    aria-label={t('Bottom caption')}
                    onChange={(e) => updateTextLayer('meme-bottom', (l) => ({ ...l, text: e.target.value }))}
                  />
                </div>
              )}
            </div>

            {/* Selected Layer Properties */}
            {selectedLayer && selectedLayer.type === 'text' && (
              <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  {t('Selected text style ({id})', { id: selectedLayer.id })}
                </div>
                <div className={styles.grid}>
                  <Field label={t('Font size')}>
                    <Slider
                      value={selectedLayer.fontSize}
                      min={16}
                      max={140}
                      unit="px"
                      onChange={(v) => updateTextLayer(selectedLayer.id, (l) => ({ ...l, fontSize: v }))}
                    />
                  </Field>

                  <Field label={t('Text colour')}>
                    <div className={styles.colorRow}>
                      <input
                        type="color"
                        className={styles.colorInput}
                        value={selectedLayer.fill}
                        aria-label={t('Text colour')}
                        onChange={(e) => updateTextLayer(selectedLayer.id, (l) => ({ ...l, fill: e.target.value }))}
                      />
                      <span>{selectedLayer.fill}</span>
                    </div>
                  </Field>

                  <Field label={t('Outline stroke colour')}>
                    <div className={styles.colorRow}>
                      <input
                        type="color"
                        className={styles.colorInput}
                        value={selectedLayer.stroke || '#000000'}
                        aria-label={t('Outline stroke colour')}
                        onChange={(e) => updateTextLayer(selectedLayer.id, (l) => ({ ...l, stroke: e.target.value }))}
                      />
                      <span>{selectedLayer.stroke}</span>
                    </div>
                  </Field>

                  <Field label={t('Outline width')}>
                    <Slider
                      value={selectedLayer.strokeWidth ?? 4}
                      min={0}
                      max={20}
                      unit="px"
                      onChange={(v) => updateTextLayer(selectedLayer.id, (l) => ({ ...l, strokeWidth: v }))}
                    />
                  </Field>
                </div>
              </div>
            )}
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
                  {' '}
                  <Slider value={quality} min={10} max={100} unit="%" onChange={setQuality} />{' '}
                </Field>
              )}
            </div>

            <Button variant="primary" data-testid="export-btn" disabled={isExporting} onClick={handleExport}>
              {isExporting ? t('Exporting…') : t('Download meme')}
            </Button>
          </div>
        </div>
      )}
    </ToolPage>
  );
}
