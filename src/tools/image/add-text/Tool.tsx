import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { FileDrop } from '../../../components/FileDrop';
import { CopyImageButton } from '../../../components/CopyImageButton';
import { Button, Field, Slider, Select } from '../../../components/Controls';
import { decodeImage, IMAGE_ACCEPT, EncodableMime } from '../../../lib/image';
import { downloadBlob } from '../../../lib/download';
import { withSuffix } from '../../../lib/format';
import { CanvasDocument, TextLayer } from '../_canvas/types';
import { useCanvasHistory } from '../_canvas/useCanvasHistory';
import { CanvasStage } from '../_canvas/CanvasStage';
import { exportDocument } from '../_canvas/render';
import { SYSTEM_FONTS } from '../_canvas/fonts';
import styles from './Tool.module.css';

export default function Tool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-add-text');

  const [file, setFile] = useState<File | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

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
    resetHistory,
  } = useCanvasHistory({
    width: 800,
    height: 600,
    baseImage: null,
    layers: [],
  });

  const handleFileDrop = async (files: File[]) => {
    if (files.length === 0) return;
    const f = files[0];
    try {
      const img = await decodeImage(f);
      setFile(f);
      const initialTextId = 'text-' + Date.now();
      const initialLayer: TextLayer = {
        id: initialTextId,
        type: 'text',
        text: 'Your Text Here',
        x: Math.max(10, Math.round(img.width / 2 - 120)),
        y: Math.max(10, Math.round(img.height / 2 - 30)),
        width: 240,
        height: 60,
        fontSize: Math.max(24, Math.round(img.width / 25)),
        fontFamily: 'sans',
        fill: '#ffffff',
        fontWeight: 'bold',
        fontStyle: 'normal',
        textAlign: 'center',
        lineHeight: 1.2,
        letterSpacing: 0,
        stroke: '#000000',
        strokeWidth: 3,
        opacity: 1,
      };

      const newDoc: CanvasDocument = {
        width: img.width,
        height: img.height,
        baseImage: img,
        layers: [initialLayer],
      };

      resetHistory(newDoc);
      setSelectedLayerId(initialTextId);
    } catch (err) {
      alert(t(err instanceof Error ? err.message : 'Failed to decode image.'));
    }
  };

  const addTextLayer = () => {
    const newId = 'text-' + Date.now();
    const w = 240;
    const h = 60;
    const newLayer: TextLayer = {
      id: newId,
      type: 'text',
      text: 'New Text',
      x: Math.max(10, Math.round(doc.width / 2 - w / 2)),
      y: Math.max(10, Math.round(doc.height / 2 - h / 2)),
      width: w,
      height: h,
      fontSize: Math.max(24, Math.round(doc.width / 25)),
      fontFamily: 'sans',
      fill: '#ffffff',
      fontWeight: 'bold',
      fontStyle: 'normal',
      textAlign: 'center',
      lineHeight: 1.2,
      letterSpacing: 0,
      stroke: '#000000',
      strokeWidth: 3,
      opacity: 1,
    };

    pushDoc({
      ...doc,
      layers: [...doc.layers, newLayer],
    });
    setSelectedLayerId(newId);
  };

  const updateSelected = (updater: (prev: TextLayer) => TextLayer) => {
    if (!selectedLayerId) return;
    pushDoc({
      ...doc,
      layers: doc.layers.map((l) => (l.id === selectedLayerId && l.type === 'text' ? updater(l) : l)),
    });
  };

  const deleteLayer = (id: string) => {
    pushDoc({
      ...doc,
      layers: doc.layers.filter((l) => l.id !== id),
    });
    if (selectedLayerId === id) {
      const remaining = doc.layers.filter((l) => l.id !== id);
      setSelectedLayerId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const reorderLayer = (id: string, direction: 'up' | 'down') => {
    const idx = doc.layers.findIndex((l) => l.id === id);
    if (idx === -1) return;
    if (direction === 'up' && idx < doc.layers.length - 1) {
      const copy = [...doc.layers];
      const temp = copy[idx];
      copy[idx] = copy[idx + 1];
      copy[idx + 1] = temp;
      pushDoc({ ...doc, layers: copy });
    } else if (direction === 'down' && idx > 0) {
      const copy = [...doc.layers];
      const temp = copy[idx];
      copy[idx] = copy[idx - 1];
      copy[idx - 1] = temp;
      pushDoc({ ...doc, layers: copy });
    }
  };

  const exportExt = exportMime === 'image/jpeg' ? 'jpg' : exportMime === 'image/webp' ? 'webp' : 'png';
  const exportFilename = withSuffix(file ? file.name : 'image-with-text.png', '-text', exportExt);

  const getExportBlob = async () => {
    setIsExporting(true);
    try {
      return await exportDocument(doc, exportMime, quality / 100);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = async () => {
    try {
      downloadBlob(await getExportBlob(), exportFilename);
    } catch (err) {
      alert(err instanceof Error ? err.message : t('Export failed.'));
    }
  };

  const selectedLayer = doc.layers.find((l) => l.id === selectedLayerId) as TextLayer | undefined;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-add-text">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label={t('Choose an image to add text')}
          hint={t('Supports JPG, PNG, WebP, GIF, BMP, AVIF, HEIC, SVG')}
          onFiles={handleFileDrop}
        />
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
              {selectedLayerId && (
                <button
                  type="button"
                  className={styles.iconBtn}
                  title={t('Delete layer (Del)')}
                  onClick={() => deleteLayer(selectedLayerId)}
                  style={{ color: 'var(--danger)' }}
                >
                  🗑
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <Button variant="primary" onClick={addTextLayer}>
                {t('+ Add text layer')}
              </Button>
              <Button variant="secondary" onClick={() => setFile(null)}>
                {t('Change image')}
              </Button>
            </div>
          </div>

          {/* Interactive Canvas */}
          <CanvasStage
            document={doc}
            selectedLayerId={selectedLayerId}
            mode="select"
            onSelectLayer={setSelectedLayerId}
            onPushDoc={pushDoc}
            onDeleteLayer={deleteLayer}
          />

          {/* Layers bar if multiple layers exist */}
          {doc.layers.length > 0 && (
            <div className={styles.layersBar}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('Layers')}:</span>
              {doc.layers.map((l, index) => (
                <button
                  key={l.id}
                  type="button"
                  className={`${styles.layerChip} ${selectedLayerId === l.id ? styles.layerChipActive : ''}`}
                  onClick={() => setSelectedLayerId(l.id)}
                >
                  {l.type === 'text' ? (l as TextLayer).text.slice(0, 15) || t('Text') : t('Layer {number}', { number: index + 1 })}
                </button>
              ))}
              {selectedLayerId && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.3rem' }}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title={t('Bring forward')}
                    onClick={() => reorderLayer(selectedLayerId, 'up')}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title={t('Send backward')}
                    onClick={() => reorderLayer(selectedLayerId, 'down')}
                  >
                    ↓
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Text Controls Panel */}
          {selectedLayer && (
            <div className={styles.settingsPanel}>
              <Field label={t('Text content')}>
                <textarea
                  className="input"
                  rows={2}
                  value={selectedLayer.text}
                  onChange={(e) => updateSelected((l) => ({ ...l, text: e.target.value }))}
                />
              </Field>

              <div className={styles.grid}>
                <Field label={t('Font size')}>
                  <Slider
                    value={selectedLayer.fontSize}
                    min={12}
                    max={140}
                    unit="px"
                    onChange={(v) => updateSelected((l) => ({ ...l, fontSize: v }))}
                  />
                </Field>

                <Field label={t('Text color')}>
                  <div className={styles.colorRow}>
                    <input
                      type="color"
                      className={styles.colorInput}
                      value={selectedLayer.fill}
                      onChange={(e) => updateSelected((l) => ({ ...l, fill: e.target.value }))}
                    />
                    <span>{selectedLayer.fill}</span>
                  </div>
                </Field>
              </div>

              <details className="tool-options">
                <summary>{t('Text style')}</summary>
                <div className="tool-options-body">
                  <div className={styles.grid}>
                    <Field label={t('Font family')}>
                      <Select
                        value={selectedLayer.fontFamily}
                        onChange={(e) => updateSelected((l) => ({ ...l, fontFamily: e.target.value }))}
                        options={SYSTEM_FONTS.map((f) => ({ value: f.id, label: t(f.label) }))}
                      />
                    </Field>

                    <Field label={t('Opacity')}>
                      <Slider
                        value={Math.round((selectedLayer.opacity ?? 1) * 100)}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={(v) => updateSelected((l) => ({ ...l, opacity: v / 100 }))}
                      />
                    </Field>

                    <Field label={t('Style & weight')}>
                      <div className={styles.btnGroup}>
                        <Button
                          variant={selectedLayer.fontWeight === 'bold' ? 'primary' : 'secondary'}
                          onClick={() =>
                            updateSelected((l) => ({
                              ...l,
                              fontWeight: l.fontWeight === 'bold' ? 'normal' : 'bold',
                            }))
                          }
                        >
                          {t('Bold')}
                        </Button>
                        <Button
                          variant={selectedLayer.fontStyle === 'italic' ? 'primary' : 'secondary'}
                          onClick={() =>
                            updateSelected((l) => ({
                              ...l,
                              fontStyle: l.fontStyle === 'italic' ? 'normal' : 'italic',
                            }))
                          }
                        >
                          {t('Italic')}
                        </Button>
                      </div>
                    </Field>

                    <Field label={t('Alignment')}>
                      <div className={styles.btnGroup}>
                        {(['left', 'center', 'right'] as const).map((a) => (
                          <Button
                            key={a}
                            variant={selectedLayer.textAlign === a ? 'primary' : 'secondary'}
                            onClick={() => updateSelected((l) => ({ ...l, textAlign: a }))}
                          >
                            {t(a === 'left' ? 'Left' : a === 'center' ? 'Center' : 'Right')}
                          </Button>
                        ))}
                      </div>
                    </Field>

                    <Field label={t('Line height')}>
                      <Slider
                        value={selectedLayer.lineHeight ?? 1.2}
                        min={0.8}
                        max={2.5}
                        step={0.1}
                        onChange={(v) => updateSelected((l) => ({ ...l, lineHeight: v }))}
                      />
                    </Field>

                    <Field label={t('Letter spacing')}>
                      <Slider
                        value={selectedLayer.letterSpacing ?? 0}
                        min={-5}
                        max={30}
                        unit="px"
                        onChange={(v) => updateSelected((l) => ({ ...l, letterSpacing: v }))}
                      />
                    </Field>
                  </div>

                  {/* Stroke (Outline) Section */}
                  <div className={styles.subSection}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedLayer.stroke && (selectedLayer.strokeWidth ?? 0) > 0)}
                          onChange={(e) =>
                            updateSelected((l) => ({
                              ...l,
                              stroke: e.target.checked ? '#000000' : undefined,
                              strokeWidth: e.target.checked ? 3 : 0,
                            }))
                          }
                        />
                        <span>{t('Stroke / outline')}</span>
                      </label>
                    </div>
                    {Boolean(selectedLayer.stroke && (selectedLayer.strokeWidth ?? 0) > 0) && (
                      <div className={styles.grid}>
                        <Field label={t('Stroke color')}>
                          <div className={styles.colorRow}>
                            <input
                              type="color"
                              className={styles.colorInput}
                              value={selectedLayer.stroke || '#000000'}
                              onChange={(e) => updateSelected((l) => ({ ...l, stroke: e.target.value }))}
                            />
                            <span>{selectedLayer.stroke}</span>
                          </div>
                        </Field>
                        <Field label={t('Stroke width')}>
                          <Slider
                            value={selectedLayer.strokeWidth ?? 3}
                            min={1}
                            max={20}
                            unit="px"
                            onChange={(v) => updateSelected((l) => ({ ...l, strokeWidth: v }))}
                          />
                        </Field>
                      </div>
                    )}
                  </div>

                  {/* Shadow Section */}
                  <div className={styles.subSection}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedLayer.shadowColor)}
                          onChange={(e) =>
                            updateSelected((l) => ({
                              ...l,
                              shadowColor: e.target.checked ? '#000000' : undefined,
                              shadowBlur: e.target.checked ? 6 : 0,
                              shadowOffsetX: 2,
                              shadowOffsetY: 2,
                            }))
                          }
                        />
                        <span>{t('Drop shadow')}</span>
                      </label>
                    </div>
                    {Boolean(selectedLayer.shadowColor) && (
                      <div className={styles.grid}>
                        <Field label={t('Shadow color')}>
                          <div className={styles.colorRow}>
                            <input
                              type="color"
                              className={styles.colorInput}
                              value={selectedLayer.shadowColor || '#000000'}
                              onChange={(e) => updateSelected((l) => ({ ...l, shadowColor: e.target.value }))}
                            />
                            <span>{selectedLayer.shadowColor}</span>
                          </div>
                        </Field>
                        <Field label={t('Shadow blur')}>
                          <Slider
                            value={selectedLayer.shadowBlur ?? 6}
                            min={0}
                            max={30}
                            unit="px"
                            onChange={(v) => updateSelected((l) => ({ ...l, shadowBlur: v }))}
                          />
                        </Field>
                        <Field label={t('Offset X')}>
                          <Slider
                            value={selectedLayer.shadowOffsetX ?? 2}
                            min={-20}
                            max={20}
                            unit="px"
                            onChange={(v) => updateSelected((l) => ({ ...l, shadowOffsetX: v }))}
                          />
                        </Field>
                        <Field label={t('Offset Y')}>
                          <Slider
                            value={selectedLayer.shadowOffsetY ?? 2}
                            min={-20}
                            max={20}
                            unit="px"
                            onChange={(v) => updateSelected((l) => ({ ...l, shadowOffsetY: v }))}
                          />
                        </Field>
                      </div>
                    )}
                  </div>

                  {/* Background Box Section */}
                  <div className={styles.subSection}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedLayer.bgBox)}
                          onChange={(e) =>
                            updateSelected((l) => ({
                              ...l,
                              bgBox: e.target.checked,
                              bgBoxColor: l.bgBoxColor || '#000000',
                              bgBoxOpacity: l.bgBoxOpacity ?? 0.8,
                              bgBoxPadding: l.bgBoxPadding ?? 12,
                              bgBoxRadius: l.bgBoxRadius ?? 8,
                            }))
                          }
                        />
                        <span>{t('Background box')}</span>
                      </label>
                    </div>
                    {Boolean(selectedLayer.bgBox) && (
                      <div className={styles.grid}>
                        <Field label={t('Box color')}>
                          <div className={styles.colorRow}>
                            <input
                              type="color"
                              className={styles.colorInput}
                              value={selectedLayer.bgBoxColor || '#000000'}
                              onChange={(e) => updateSelected((l) => ({ ...l, bgBoxColor: e.target.value }))}
                            />
                            <span>{selectedLayer.bgBoxColor}</span>
                          </div>
                        </Field>
                        <Field label={t('Box opacity')}>
                          <Slider
                            value={Math.round((selectedLayer.bgBoxOpacity ?? 0.8) * 100)}
                            min={0}
                            max={100}
                            unit="%"
                            onChange={(v) => updateSelected((l) => ({ ...l, bgBoxOpacity: v / 100 }))}
                          />
                        </Field>
                        <Field label={t('Box padding')}>
                          <Slider
                            value={selectedLayer.bgBoxPadding ?? 12}
                            min={0}
                            max={50}
                            unit="px"
                            onChange={(v) => updateSelected((l) => ({ ...l, bgBoxPadding: v }))}
                          />
                        </Field>
                        <Field label={t('Border radius')}>
                          <Slider
                            value={selectedLayer.bgBoxRadius ?? 8}
                            min={0}
                            max={50}
                            unit="px"
                            onChange={(v) => updateSelected((l) => ({ ...l, bgBoxRadius: v }))}
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                </div>
              </details>

              <details className="tool-options">
                <summary>{t('Position')}</summary>
                <div className="tool-options-body">
                  <div className={styles.grid}>
                    <Field label={t('X position (px)')}>
                      <input
                        type="number"
                        step={1}
                        className="input"
                        value={selectedLayer.x}
                        onChange={(e) => updateSelected((l) => ({ ...l, x: parseInt(e.target.value, 10) || 0 }))}
                      />
                    </Field>
                    <Field label={t('Y position (px)')}>
                      <input
                        type="number"
                        step={1}
                        className="input"
                        value={selectedLayer.y}
                        onChange={(e) => updateSelected((l) => ({ ...l, y: parseInt(e.target.value, 10) || 0 }))}
                      />
                    </Field>
                  </div>
                </div>
              </details>
            </div>
          )}

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

            <div className={styles.exportControls}>
              <Button variant="primary" data-testid="export-btn" loading={isExporting} onClick={handleExport}>
                {t('Download')}
              </Button>
              <CopyImageButton getImage={getExportBlob} disabled={isExporting} filename={exportFilename} />
            </div>
          </div>
        </div>
      )}
    </ToolPage>
  );
}
