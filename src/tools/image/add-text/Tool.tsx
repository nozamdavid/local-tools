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
import { SYSTEM_FONTS } from '../_canvas/fonts';
import styles from './Tool.module.css';

export default function Tool() {
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
    updateDocSilent,
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
      alert(err instanceof Error ? err.message : 'Failed to decode image.');
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
      layers: doc.layers.map((l) =>
        l.id === selectedLayerId && l.type === 'text' ? updater(l) : l
      ),
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

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await exportDocument(doc, exportMime, quality / 100);
      const ext = exportMime === 'image/jpeg' ? 'jpg' : exportMime === 'image/webp' ? 'webp' : 'png';
      const outName = withSuffix(file ? file.name : 'image-with-text.png', '-text', ext);
      downloadBlob(blob, outName);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const selectedLayer = doc.layers.find((l) => l.id === selectedLayerId) as TextLayer | undefined;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-add-text">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label="Choose an image to add text"
          hint="Supports JPG, PNG, WebP, GIF, BMP, AVIF, HEIC, SVG"
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
                title="Undo (Ctrl+Z)"
                data-testid="undo-btn"
                disabled={!canUndo}
                onClick={undo}
              >
                ↩
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                title="Redo (Ctrl+Shift+Z)"
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
                  title="Delete layer (Del)"
                  onClick={() => deleteLayer(selectedLayerId)}
                  style={{ color: 'var(--danger)' }}
                >
                  🗑
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <Button variant="primary" onClick={addTextLayer}>
                + Add text layer
              </Button>
              <Button variant="secondary" onClick={() => setFile(null)}>
                Change Image
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

          {/* Layers bar if multiple layers exist */}
          {doc.layers.length > 0 && (
            <div className={styles.layersBar}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Layers:</span>
              {doc.layers.map((l, index) => (
                <button
                  key={l.id}
                  type="button"
                  className={`${styles.layerChip} ${selectedLayerId === l.id ? styles.layerChipActive : ''}`}
                  onClick={() => setSelectedLayerId(l.id)}
                >
                  {l.type === 'text' ? (l as TextLayer).text.slice(0, 15) || 'Text' : `Layer ${index + 1}`}
                </button>
              ))}
              {selectedLayerId && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.3rem' }}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title="Bring forward"
                    onClick={() => reorderLayer(selectedLayerId, 'up')}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title="Send backward"
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
              <Field label="Text Content">
                <textarea
                  className="input"
                  rows={2}
                  value={selectedLayer.text}
                  onChange={(e) => updateSelected((l) => ({ ...l, text: e.target.value }))}
                />
              </Field>

              <div className={styles.grid}>
                <Field label="Font Family">
                  <Select
                    value={selectedLayer.fontFamily}
                    onChange={(e) => updateSelected((l) => ({ ...l, fontFamily: e.target.value }))}
                    options={SYSTEM_FONTS.map((f) => ({ value: f.id, label: f.label }))}
                  />
                </Field>

                <Field label="Font Size">
                  <Slider
                    value={selectedLayer.fontSize}
                    min={12}
                    max={140}
                    unit="px"
                    onChange={(v) => updateSelected((l) => ({ ...l, fontSize: v }))}
                  />
                </Field>

                <Field label="Text Color">
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

                <Field label="Opacity">
                  <Slider
                    value={Math.round((selectedLayer.opacity ?? 1) * 100)}
                    min={0}
                    max={100}
                    unit="%"
                    onChange={(v) => updateSelected((l) => ({ ...l, opacity: v / 100 }))}
                  />
                </Field>

                <Field label="Style & Weight">
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
                      Bold
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
                      Italic
                    </Button>
                  </div>
                </Field>

                <Field label="Alignment">
                  <div className={styles.btnGroup}>
                    {(['left', 'center', 'right'] as const).map((a) => (
                      <Button
                        key={a}
                        variant={selectedLayer.textAlign === a ? 'primary' : 'secondary'}
                        onClick={() => updateSelected((l) => ({ ...l, textAlign: a }))}
                      >
                        {a.charAt(0).toUpperCase() + a.slice(1)}
                      </Button>
                    ))}
                  </div>
                </Field>

                <Field label="Line Height">
                  <Slider
                    value={selectedLayer.lineHeight ?? 1.2}
                    min={0.8}
                    max={2.5}
                    step={0.1}
                    onChange={(v) => updateSelected((l) => ({ ...l, lineHeight: v }))}
                  />
                </Field>

                <Field label="Letter Spacing">
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
                    <span>Stroke / Outline</span>
                  </label>
                </div>
                {Boolean(selectedLayer.stroke && (selectedLayer.strokeWidth ?? 0) > 0) && (
                  <div className={styles.grid}>
                    <Field label="Stroke Color">
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
                    <Field label="Stroke Width">
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
                    <span>Drop Shadow</span>
                  </label>
                </div>
                {Boolean(selectedLayer.shadowColor) && (
                  <div className={styles.grid}>
                    <Field label="Shadow Color">
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
                    <Field label="Shadow Blur">
                      <Slider
                        value={selectedLayer.shadowBlur ?? 6}
                        min={0}
                        max={30}
                        unit="px"
                        onChange={(v) => updateSelected((l) => ({ ...l, shadowBlur: v }))}
                      />
                    </Field>
                    <Field label="Offset X">
                      <Slider
                        value={selectedLayer.shadowOffsetX ?? 2}
                        min={-20}
                        max={20}
                        unit="px"
                        onChange={(v) => updateSelected((l) => ({ ...l, shadowOffsetX: v }))}
                      />
                    </Field>
                    <Field label="Offset Y">
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
                    <span>Background Box</span>
                  </label>
                </div>
                {Boolean(selectedLayer.bgBox) && (
                  <div className={styles.grid}>
                    <Field label="Box Color">
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
                    <Field label="Box Opacity">
                      <Slider
                        value={Math.round((selectedLayer.bgBoxOpacity ?? 0.8) * 100)}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={(v) => updateSelected((l) => ({ ...l, bgBoxOpacity: v / 100 }))}
                      />
                    </Field>
                    <Field label="Box Padding">
                      <Slider
                        value={selectedLayer.bgBoxPadding ?? 12}
                        min={0}
                        max={50}
                        unit="px"
                        onChange={(v) => updateSelected((l) => ({ ...l, bgBoxPadding: v }))}
                      />
                    </Field>
                    <Field label="Border Radius">
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
          )}

          {/* Export Row */}
          <div className={styles.exportRow}>
            <div className={styles.exportControls}>
              <Field label="Format">
                <Select
                  value={exportMime}
                  onChange={(e) => setExportMime(e.target.value as EncodableMime)}
                  options={[
                    { value: 'image/png', label: 'PNG' },
                    { value: 'image/jpeg', label: 'JPEG' },
                    { value: 'image/webp', label: 'WebP' },
                  ]}
                />
              </Field>

              {exportMime !== 'image/png' && (
                <Field label="Quality">
                  <Slider value={quality} min={10} max={100} unit="%" onChange={setQuality} />
                </Field>
              )}
            </div>

            <Button
              variant="primary"
              data-testid="export-btn"
              disabled={isExporting}
              onClick={handleExport}
            >
              {isExporting ? 'Exporting…' : 'Download Image'}
            </Button>
          </div>
        </div>
      )}
    </ToolPage>
  );
}
