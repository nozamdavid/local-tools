import { useState, useRef, useEffect, useId, useCallback } from 'react';
import { PDFDocument } from 'pdf-lib';
import { ToolPage } from '../../../components/ToolPage';
import { Field, Select, Button, Slider } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { downloadBlob } from '../../../lib/download';
import { type LabelElement, type ImageElement, LABEL_PRESETS, renderLabelToCanvas } from '../_generate/label';
import styles from './Tool.module.css';

const DEFAULT_ELEMENTS: LabelElement[] = [
  {
    id: 'el-1',
    type: 'text',
    x: 5,
    y: 4,
    width: 40,
    height: 6,
    text: 'ACME SUPPLIES',
    fontSize: 12,
    bold: true,
    italic: false,
    align: 'left',
    color: '#000000',
  },
  {
    id: 'el-2',
    type: 'line',
    x: 5,
    y: 11,
    width: 40,
    height: 1,
    color: '#000000',
    lineWidth: 0.5,
  },
  {
    id: 'el-3',
    type: 'barcode',
    x: 5,
    y: 13,
    width: 40,
    height: 9,
    format: 'CODE128',
    value: 'ITEM-8842',
    showText: true,
  },
];

export default function LabelDesignerTool() {
  const meta = getToolMeta('img-label-designer');

  // Presets and dimensions
  const [selectedPresetId, setSelectedPresetId] = useState<string>('50x25');
  const [labelWidth, setLabelWidth] = useState<number>(50); // mm
  const [labelHeight, setLabelHeight] = useState<number>(25); // mm

  // Sheet tiling parameters
  const [sheetType, setSheetType] = useState<'A4' | 'Letter'>('A4');
  const [cols, setCols] = useState<number>(4);
  const [rows, setRows] = useState<number>(10);
  const [marginTop, setMarginTop] = useState<number>(10);
  const [marginLeft, setMarginLeft] = useState<number>(4);
  const [gapX, setGapX] = useState<number>(2);
  const [gapY, setGapY] = useState<number>(2);

  // Editor state
  const [elements, setElements] = useState<LabelElement[]>(DEFAULT_ELEMENTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'designer' | 'sheet'>('designer');
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true);
  const [gridStep, setGridStep] = useState<number>(1); // mm

  // Preview data URLs for sheet view
  const [singleLabelDataUrl, setSingleLabelDataUrl] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const presetSelectId = useId();
  const sheetSelectId = useId();

  // Scale in pixels per mm for designer canvas
  const canvasPxPerMm = Math.max(3, Math.min(8, 300 / Math.max(labelWidth, labelHeight)));

  // Dragging state
  const dragRef = useRef<{
    isDragging: boolean;
    isResizing: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    elementId: string;
  } | null>(null);

  // Preset selection handler
  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = LABEL_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    setLabelWidth(preset.width);
    setLabelHeight(preset.height);
    setSheetType(preset.sheet);
    setCols(preset.cols);
    setRows(preset.rows);
    setMarginTop(preset.marginTop);
    setMarginLeft(preset.marginLeft);
    setGapX(preset.gapX);
    setGapY(preset.gapY);
  };

  // Auto calculate cols and rows to fit sheet
  const handleAutoFitSheet = useCallback(() => {
    const sheetW = sheetType === 'A4' ? 210 : 215.9;
    const sheetH = sheetType === 'A4' ? 297 : 279.4;

    const availableW = sheetW - marginLeft * 2;
    const availableH = sheetH - marginTop * 2;

    const computedCols = Math.max(1, Math.floor((availableW + gapX) / (labelWidth + gapX)));
    const computedRows = Math.max(1, Math.floor((availableH + gapY) / (labelHeight + gapY)));

    setCols(computedCols);
    setRows(computedRows);
  }, [sheetType, marginLeft, marginTop, gapX, gapY, labelWidth, labelHeight]);

  // Update single label preview for sheet tab
  const updateSingleLabelPreview = useCallback(async () => {
    try {
      const canvas = await renderLabelToCanvas(elements, labelWidth, labelHeight, 150);
      setSingleLabelDataUrl(canvas.toDataURL('image/png'));
    } catch (e) {
      console.warn('Failed to render single label preview:', e);
    }
  }, [elements, labelWidth, labelHeight]);

  useEffect(() => {
    updateSingleLabelPreview();
  }, [updateSingleLabelPreview]);

  // Snap coordinate helper
  const snap = (val: number) => {
    if (!snapToGrid) return Math.round(val * 10) / 10;
    return Math.round(val / gridStep) * gridStep;
  };

  // Pointer drag/resize handling
  const handlePointerDown = (e: React.PointerEvent, id: string, isResize = false) => {
    e.stopPropagation();
    setSelectedId(id);

    const el = elements.find((item) => item.id === id);
    if (!el) return;

    dragRef.current = {
      isDragging: !isResize,
      isResizing: isResize,
      startX: e.clientX,
      startY: e.clientY,
      origX: el.x,
      origY: el.y,
      origW: el.width,
      origH: el.height,
      elementId: id,
    };

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { isDragging, isResizing, startX, startY, origX, origY, origW, origH, elementId } = dragRef.current;

    const dxMm = (e.clientX - startX) / canvasPxPerMm;
    const dyMm = (e.clientY - startY) / canvasPxPerMm;

    setElements((prev) =>
      prev.map((item) => {
        if (item.id !== elementId) return item;

        if (isDragging) {
          const newX = Math.max(0, Math.min(labelWidth - item.width, snap(origX + dxMm)));
          const newY = Math.max(0, Math.min(labelHeight - item.height, snap(origY + dyMm)));
          return { ...item, x: newX, y: newY };
        }

        if (isResizing) {
          const newW = Math.max(2, snap(origW + dxMm));
          const newH = Math.max(2, snap(origH + dyMm));
          return { ...item, width: newW, height: newH };
        }

        return item;
      }),
    );
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  // Add Element Helpers
  const addElement = (type: LabelElement['type']) => {
    const id = `el-${Date.now()}`;
    let newEl: LabelElement;

    switch (type) {
      case 'text':
        newEl = {
          id,
          type: 'text',
          x: 4,
          y: 4,
          width: Math.min(30, labelWidth - 8),
          height: 6,
          text: 'New Text',
          fontSize: 10,
          bold: false,
          italic: false,
          align: 'left',
          color: '#000000',
        };
        break;
      case 'rect':
        newEl = {
          id,
          type: 'rect',
          x: 2,
          y: 2,
          width: Math.max(10, labelWidth - 4),
          height: Math.max(10, labelHeight - 4),
          fill: 'transparent',
          stroke: '#000000',
          strokeWidth: 0.5,
          rounded: 1,
        };
        break;
      case 'line':
        newEl = {
          id,
          type: 'line',
          x: 4,
          y: Math.round(labelHeight / 2),
          width: Math.max(10, labelWidth - 8),
          height: 1,
          color: '#000000',
          lineWidth: 0.5,
        };
        break;
      case 'qr':
        newEl = {
          id,
          type: 'qr',
          x: 4,
          y: 4,
          width: Math.min(18, labelWidth - 8),
          height: Math.min(18, labelHeight - 8),
          text: 'https://loconvert.com',
          ecLevel: 'M',
        };
        break;
      case 'barcode':
        newEl = {
          id,
          type: 'barcode',
          x: 4,
          y: Math.max(2, labelHeight - 14),
          width: Math.max(20, labelWidth - 8),
          height: 10,
          format: 'CODE128',
          value: '12345678',
          showText: true,
        };
        break;
      case 'image':
        newEl = {
          id,
          type: 'image',
          x: 4,
          y: 4,
          width: Math.min(25, labelWidth - 8),
          height: Math.min(25, labelHeight - 8),
          dataUrl: '',
        };
        break;
    }

    setElements((prev) => [...prev, newEl]);
    setSelectedId(id);
  };

  // Image file upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const id = `el-${Date.now()}`;
      const newEl: ImageElement = {
        id,
        type: 'image',
        x: 4,
        y: 4,
        width: Math.min(25, labelWidth - 8),
        height: Math.min(25, labelHeight - 8),
        dataUrl,
      };
      setElements((prev) => [...prev, newEl]);
      setSelectedId(id);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Delete element
  const deleteElement = (id: string) => {
    setElements((prev) => prev.filter((el) => el.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  // Duplicate element
  const duplicateElement = (id: string) => {
    const el = elements.find((item) => item.id === id);
    if (!el) return;
    const newEl: LabelElement = {
      ...el,
      id: `el-${Date.now()}`,
      x: Math.min(labelWidth - el.width, el.x + 2),
      y: Math.min(labelHeight - el.height, el.y + 2),
    };
    setElements((prev) => [...prev, newEl]);
    setSelectedId(newEl.id);
  };

  // Export Single Label (300 DPI PNG)
  const handleExportSinglePng = async () => {
    try {
      const canvas = await renderLabelToCanvas(elements, labelWidth, labelHeight, 300);
      canvas.toBlob((blob) => {
        if (blob) {
          downloadBlob(blob, `label-${labelWidth}x${labelHeight}mm.png`);
        }
      }, 'image/png');
    } catch (e) {
      console.error('Failed to export label PNG:', e);
    }
  };

  // Export Sheet PDF via pdf-lib
  const handleExportSheetPdf = async () => {
    try {
      // 1. Render single label to 300 DPI canvas
      const canvas = await renderLabelToCanvas(elements, labelWidth, labelHeight, 300);
      const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!pngBlob) return;
      const pngBytes = await pngBlob.arrayBuffer();

      // 2. Create PDF document
      const pdfDoc = await PDFDocument.create();
      // Points (72 pt per inch, 2.83464567 pt per mm)
      const ptPerMm = 72 / 25.4;
      const pageWidthPt = sheetType === 'A4' ? 210 * ptPerMm : 215.9 * ptPerMm;
      const pageHeightPt = sheetType === 'A4' ? 297 * ptPerMm : 279.4 * ptPerMm;

      const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
      const pngImage = await pdfDoc.embedPng(pngBytes);

      const labelWPt = labelWidth * ptPerMm;
      const labelHPt = labelHeight * ptPerMm;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const xMm = marginLeft + c * (labelWidth + gapX);
          const yMm = marginTop + r * (labelHeight + gapY);

          // In PDF coordinates, origin (0, 0) is bottom-left
          const xPt = xMm * ptPerMm;
          const yPt = pageHeightPt - (yMm + labelHeight) * ptPerMm;

          page.drawImage(pngImage, {
            x: xPt,
            y: yPt,
            width: labelWPt,
            height: labelHPt,
          });
        }
      }

      const pdfBytes = await pdfDoc.save();
      const pdfBlob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
      downloadBlob(pdfBlob, `labels-sheet-${sheetType}.pdf`);
    } catch (e) {
      console.error('Failed to export PDF sheet:', e);
    }
  };

  // Print Sheet
  const handlePrint = () => {
    window.print();
  };

  const selectedElement = elements.find((el) => el.id === selectedId);

  // Sheet dimensions in mm
  const sheetWidthMm = sheetType === 'A4' ? 210 : 215.9;
  const sheetHeightMm = sheetType === 'A4' ? 297 : 279.4;
  const sheetScale = 0.5; // Scale for sheet preview display

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-label-designer">
      <div className={styles.container}>
        {/* Top Control Bar */}
        <div className={styles.topBar}>
          <div className={styles.toolbarGroup}>
            <div className={styles.tabButtons}>
              <button
                type="button"
                className={`${styles.tabBtn} ${activeTab === 'designer' ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab('designer')}
              >
                Design Label
              </button>
              <button
                type="button"
                className={`${styles.tabBtn} ${activeTab === 'sheet' ? styles.tabBtnActive : ''}`}
                onClick={() => {
                  setActiveTab('sheet');
                  updateSingleLabelPreview();
                }}
              >
                Fill Sheet ({cols * rows} Labels)
              </button>
            </div>
          </div>

          <div className={styles.toolbarGroup}>
            <Button variant="secondary" className={styles.smallBtn} onClick={handleExportSinglePng}>
              Export Label (300 DPI PNG)
            </Button>
            <Button className={styles.smallBtn} onClick={handleExportSheetPdf}>
              Export Sheet PDF
            </Button>
            <Button variant="secondary" className={styles.smallBtn} onClick={handlePrint}>
              Print Sheet
            </Button>
          </div>
        </div>

        {/* Main Workspace Layout */}
        <div className={styles.layout}>
          {/* Left Sidebar: Tools & Property Inspector */}
          <div className={styles.sidebar}>
            {activeTab === 'designer' ? (
              <>
                <div className={styles.propSection}>
                  <span className={styles.propTitle}>Label Size Preset</span>
                  <Select
                    id={presetSelectId}
                    value={selectedPresetId}
                    aria-label="Label Size Preset"
                    onChange={(e) => handlePresetChange(e.target.value)}
                    options={LABEL_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
                  />

                  {selectedPresetId === 'custom' && (
                    <div className={styles.twoCols}>
                      <Field label="Width (mm)">
                        <input
                          type="number"
                          className="input"
                          value={labelWidth}
                          min={10}
                          max={300}
                          onChange={(e) => setLabelWidth(Number(e.target.value) || 10)}
                        />
                      </Field>
                      <Field label="Height (mm)">
                        <input
                          type="number"
                          className="input"
                          value={labelHeight}
                          min={10}
                          max={300}
                          onChange={(e) => setLabelHeight(Number(e.target.value) || 10)}
                        />
                      </Field>
                    </div>
                  )}
                </div>

                <div className={styles.propSection}>
                  <span className={styles.propTitle}>Add Element</span>
                  <div className={styles.btnGroup} style={{ flexWrap: 'wrap' }}>
                    <Button variant="secondary" className={styles.smallBtn} onClick={() => addElement('text')}>
                      + Text
                    </Button>
                    <Button variant="secondary" className={styles.smallBtn} onClick={() => addElement('barcode')}>
                      + Barcode
                    </Button>
                    <Button variant="secondary" className={styles.smallBtn} onClick={() => addElement('qr')}>
                      + QR Code
                    </Button>
                    <Button variant="secondary" className={styles.smallBtn} onClick={() => addElement('rect')}>
                      + Box
                    </Button>
                    <Button variant="secondary" className={styles.smallBtn} onClick={() => addElement('line')}>
                      + Line
                    </Button>
                    <Button variant="secondary" className={styles.smallBtn} onClick={() => fileInputRef.current?.click()}>
                      + Image
                    </Button>
                    <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                  </div>
                </div>

                <div className={styles.propSection}>
                  <span className={styles.propTitle}>Grid & Snapping</span>
                  <label className={styles.checkboxLabel}>
                    <input type="checkbox" checked={snapToGrid} onChange={(e) => setSnapToGrid(e.target.checked)} />
                    Snap to grid
                  </label>
                  {snapToGrid && (
                    <Slider min={1} max={5} step={1} unit="mm" value={gridStep} onChange={setGridStep} aria-label="Grid size" />
                  )}
                </div>

                {/* Selected Element Properties */}
                {selectedElement && (
                  <div className={styles.propSection}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className={styles.propTitle}>Edit {selectedElement.type}</span>
                      <div className={styles.btnGroup}>
                        <button
                          type="button"
                          className={styles.smallBtn}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-text)' }}
                          onClick={() => duplicateElement(selectedElement.id)}
                          title="Duplicate element"
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          className={styles.smallBtn}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}
                          onClick={() => deleteElement(selectedElement.id)}
                          title="Delete element"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {selectedElement.type === 'text' && (
                      <>
                        <Field label="Text">
                          <textarea
                            className="input"
                            rows={2}
                            value={selectedElement.text}
                            onChange={(e) =>
                              setElements((prev) => prev.map((el) => (el.id === selectedElement.id ? { ...el, text: e.target.value } : el)))
                            }
                          />
                        </Field>
                        <Field label="Font Size">
                          <Slider
                            min={6}
                            max={32}
                            step={1}
                            unit="pt"
                            value={selectedElement.fontSize}
                            onChange={(v) =>
                              setElements((prev) => prev.map((el) => (el.id === selectedElement.id ? { ...el, fontSize: v } : el)))
                            }
                          />
                        </Field>
                        <div className={styles.twoCols}>
                          <label className={styles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={selectedElement.bold}
                              onChange={(e) =>
                                setElements((prev) =>
                                  prev.map((el) => (el.id === selectedElement.id ? { ...el, bold: e.target.checked } : el)),
                                )
                              }
                            />
                            Bold
                          </label>
                          <label className={styles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={selectedElement.italic}
                              onChange={(e) =>
                                setElements((prev) =>
                                  prev.map((el) => (el.id === selectedElement.id ? { ...el, italic: e.target.checked } : el)),
                                )
                              }
                            />
                            Italic
                          </label>
                        </div>
                      </>
                    )}

                    {selectedElement.type === 'barcode' && (
                      <>
                        <Field label="Barcode Format">
                          <Select
                            value={selectedElement.format}
                            onChange={(e) =>
                              setElements((prev) =>
                                prev.map((el) => (el.id === selectedElement.id ? { ...el, format: e.target.value as any } : el)),
                              )
                            }
                            options={[
                              { value: 'CODE128', label: 'Code 128' },
                              { value: 'EAN13', label: 'EAN-13' },
                              { value: 'UPC', label: 'UPC-A' },
                              { value: 'CODE39', label: 'Code 39' },
                            ]}
                          />
                        </Field>
                        <Field label="Value">
                          <input
                            type="text"
                            className="input"
                            value={selectedElement.value}
                            onChange={(e) =>
                              setElements((prev) =>
                                prev.map((el) => (el.id === selectedElement.id ? { ...el, value: e.target.value } : el)),
                              )
                            }
                          />
                        </Field>
                        <label className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={selectedElement.showText}
                            onChange={(e) =>
                              setElements((prev) =>
                                prev.map((el) => (el.id === selectedElement.id ? { ...el, showText: e.target.checked } : el)),
                              )
                            }
                          />
                          Show code text
                        </label>
                      </>
                    )}

                    {selectedElement.type === 'qr' && (
                      <>
                        <Field label="Content / URL">
                          <input
                            type="text"
                            className="input"
                            value={selectedElement.text}
                            onChange={(e) =>
                              setElements((prev) => prev.map((el) => (el.id === selectedElement.id ? { ...el, text: e.target.value } : el)))
                            }
                          />
                        </Field>
                        <Field label="Error Correction">
                          <Select
                            value={selectedElement.ecLevel}
                            onChange={(e) =>
                              setElements((prev) =>
                                prev.map((el) => (el.id === selectedElement.id ? { ...el, ecLevel: e.target.value as any } : el)),
                              )
                            }
                            options={[
                              { value: 'L', label: 'Low (7%)' },
                              { value: 'M', label: 'Medium (15%)' },
                              { value: 'Q', label: 'Quartile (25%)' },
                              { value: 'H', label: 'High (30%)' },
                            ]}
                          />
                        </Field>
                      </>
                    )}

                    {selectedElement.type === 'rect' && (
                      <>
                        <Field label="Fill Color">
                          <input
                            type="text"
                            className="input"
                            value={selectedElement.fill}
                            onChange={(e) =>
                              setElements((prev) => prev.map((el) => (el.id === selectedElement.id ? { ...el, fill: e.target.value } : el)))
                            }
                          />
                        </Field>
                        <Field label="Border Color">
                          <input
                            type="color"
                            value={selectedElement.stroke}
                            aria-label="Border Color"
                            onChange={(e) =>
                              setElements((prev) =>
                                prev.map((el) => (el.id === selectedElement.id ? { ...el, stroke: e.target.value } : el)),
                              )
                            }
                          />
                        </Field>
                        <Field label="Border Width">
                          <Slider
                            min={0}
                            max={4}
                            step={0.5}
                            unit="mm"
                            value={selectedElement.strokeWidth}
                            onChange={(v) =>
                              setElements((prev) => prev.map((el) => (el.id === selectedElement.id ? { ...el, strokeWidth: v } : el)))
                            }
                          />
                        </Field>
                      </>
                    )}

                    {selectedElement.type === 'line' && (
                      <>
                        <Field label="Line Color">
                          <input
                            type="color"
                            value={selectedElement.color}
                            aria-label="Line Color"
                            onChange={(e) =>
                              setElements((prev) =>
                                prev.map((el) => (el.id === selectedElement.id ? { ...el, color: e.target.value } : el)),
                              )
                            }
                          />
                        </Field>
                        <Field label="Line Thickness">
                          <Slider
                            min={0.2}
                            max={3}
                            step={0.2}
                            unit="mm"
                            value={selectedElement.lineWidth}
                            onChange={(v) =>
                              setElements((prev) => prev.map((el) => (el.id === selectedElement.id ? { ...el, lineWidth: v } : el)))
                            }
                          />
                        </Field>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* Sheet Layout Options */
              <>
                <div className={styles.propSection}>
                  <span className={styles.propTitle}>Sheet Paper</span>
                  <Select
                    id={sheetSelectId}
                    value={sheetType}
                    aria-label="Sheet Paper"
                    onChange={(e) => setSheetType(e.target.value as 'A4' | 'Letter')}
                    options={[
                      { value: 'A4', label: 'A4 (210 × 297 mm)' },
                      { value: 'Letter', label: 'US Letter (8.5 × 11 in)' },
                    ]}
                  />
                </div>

                <div className={styles.propSection}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className={styles.propTitle}>Grid Layout</span>
                    <Button variant="secondary" className={styles.smallBtn} onClick={handleAutoFitSheet}>
                      Auto-Fit
                    </Button>
                  </div>
                  <div className={styles.twoCols}>
                    <Field label="Columns">
                      <input
                        type="number"
                        className="input"
                        value={cols}
                        min={1}
                        max={12}
                        onChange={(e) => setCols(Math.max(1, Number(e.target.value) || 1))}
                      />
                    </Field>
                    <Field label="Rows">
                      <input
                        type="number"
                        className="input"
                        value={rows}
                        min={1}
                        max={30}
                        onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))}
                      />
                    </Field>
                  </div>
                </div>

                <div className={styles.propSection}>
                  <span className={styles.propTitle}>Margins (mm)</span>
                  <div className={styles.twoCols}>
                    <Field label="Top">
                      <input
                        type="number"
                        className="input"
                        value={marginTop}
                        min={0}
                        onChange={(e) => setMarginTop(Number(e.target.value) || 0)}
                      />
                    </Field>
                    <Field label="Left">
                      <input
                        type="number"
                        className="input"
                        value={marginLeft}
                        min={0}
                        onChange={(e) => setMarginLeft(Number(e.target.value) || 0)}
                      />
                    </Field>
                  </div>
                </div>

                <div className={styles.propSection}>
                  <span className={styles.propTitle}>Spacing / Gaps (mm)</span>
                  <div className={styles.twoCols}>
                    <Field label="Horizontal">
                      <input type="number" className="input" value={gapX} min={0} onChange={(e) => setGapX(Number(e.target.value) || 0)} />
                    </Field>
                    <Field label="Vertical">
                      <input type="number" className="input" value={gapY} min={0} onChange={(e) => setGapY(Number(e.target.value) || 0)} />
                    </Field>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right Area: Interactive Editor Canvas or Sheet Preview */}
          <div className={styles.editorArea}>
            {activeTab === 'designer' ? (
              <div
                className={styles.canvasStageWrapper}
                onClick={() => setSelectedId(null)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                <div
                  className={styles.labelCanvas}
                  style={{
                    width: `${labelWidth * canvasPxPerMm}px`,
                    height: `${labelHeight * canvasPxPerMm}px`,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {elements.map((el) => {
                    const isSel = el.id === selectedId;
                    return (
                      <div
                        key={el.id}
                        className={`${styles.element} ${isSel ? styles.elementSelected : ''}`}
                        style={{
                          left: `${el.x * canvasPxPerMm}px`,
                          top: `${el.y * canvasPxPerMm}px`,
                          width: `${el.width * canvasPxPerMm}px`,
                          height: `${el.height * canvasPxPerMm}px`,
                        }}
                        onPointerDown={(e) => handlePointerDown(e, el.id, false)}
                      >
                        {/* Content render according to type */}
                        {el.type === 'text' && (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              fontSize: `${el.fontSize * (canvasPxPerMm / 2.834)}px`,
                              fontWeight: el.bold ? 'bold' : 'normal',
                              fontStyle: el.italic ? 'italic' : 'normal',
                              textAlign: el.align,
                              color: el.color,
                              lineHeight: 1.25,
                              whiteSpace: 'pre-wrap',
                              overflow: 'hidden',
                            }}
                          >
                            {el.text}
                          </div>
                        )}

                        {el.type === 'rect' && (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              backgroundColor: el.fill,
                              border: `${Math.max(1, el.strokeWidth * canvasPxPerMm)}px solid ${el.stroke}`,
                              borderRadius: `${el.rounded * canvasPxPerMm}px`,
                              boxSizing: 'border-box',
                            }}
                          />
                        )}

                        {el.type === 'line' && (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <div
                              style={{
                                width: '100%',
                                height: `${Math.max(1, el.lineWidth * canvasPxPerMm)}px`,
                                backgroundColor: el.color,
                              }}
                            />
                          </div>
                        )}

                        {el.type === 'qr' && (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              background: '#f1f5f9',
                              color: 'var(--gray-900)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '10px',
                              border: '1px solid #cbd5e1',
                            }}
                          >
                            <span>🔳 QR</span>
                            <span style={{ fontSize: '8px', color: 'var(--gray-600)' }}>{el.text.slice(0, 14)}</span>
                          </div>
                        )}

                        {el.type === 'barcode' && (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              background: '#f1f5f9',
                              color: 'var(--gray-900)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '10px',
                              border: '1px solid #cbd5e1',
                            }}
                          >
                            <span>||| {el.value} |||</span>
                            {el.showText && <span style={{ fontSize: '8px', color: 'var(--gray-700)' }}>{el.format}</span>}
                          </div>
                        )}

                        {el.type === 'image' && (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              backgroundImage: el.dataUrl ? `url(${el.dataUrl})` : 'none',
                              backgroundSize: 'contain',
                              backgroundRepeat: 'no-repeat',
                              backgroundPosition: 'center',
                              border: el.dataUrl ? 'none' : '1px dashed #cbd5e1',
                            }}
                          />
                        )}

                        {/* Resize handle */}
                        {isSel && <div className={styles.resizeHandle} onPointerDown={(e) => handlePointerDown(e, el.id, true)} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Sheet Preview Mode */
              <div className={styles.sheetPreviewWrapper}>
                <div
                  className={styles.sheetPage}
                  style={{
                    width: `${sheetWidthMm * sheetScale * 2.834}px`,
                    height: `${sheetHeightMm * sheetScale * 2.834}px`,
                  }}
                >
                  {Array.from({ length: rows }).map((_, r) =>
                    Array.from({ length: cols }).map((_, c) => {
                      const xMm = marginLeft + c * (labelWidth + gapX);
                      const yMm = marginTop + r * (labelHeight + gapY);

                      return (
                        <div
                          key={`tile-${r}-${c}`}
                          className={styles.tiledLabel}
                          style={{
                            left: `${xMm * sheetScale * 2.834}px`,
                            top: `${yMm * sheetScale * 2.834}px`,
                            width: `${labelWidth * sheetScale * 2.834}px`,
                            height: `${labelHeight * sheetScale * 2.834}px`,
                            backgroundImage: singleLabelDataUrl ? `url(${singleLabelDataUrl})` : 'none',
                            backgroundSize: '100% 100%',
                          }}
                        />
                      );
                    }),
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Hidden Printable Sheet Container for window.print() */}
        <div
          className={styles.printOnly}
          style={{
            width: `${sheetWidthMm}mm`,
            height: `${sheetHeightMm}mm`,
            position: 'relative',
          }}
        >
          {Array.from({ length: rows }).map((_, r) =>
            Array.from({ length: cols }).map((_, c) => {
              const xMm = marginLeft + c * (labelWidth + gapX);
              const yMm = marginTop + r * (labelHeight + gapY);

              return (
                <div
                  key={`print-tile-${r}-${c}`}
                  style={{
                    position: 'absolute',
                    left: `${xMm}mm`,
                    top: `${yMm}mm`,
                    width: `${labelWidth}mm`,
                    height: `${labelHeight}mm`,
                    backgroundImage: singleLabelDataUrl ? `url(${singleLabelDataUrl})` : 'none',
                    backgroundSize: '100% 100%',
                  }}
                />
              );
            }),
          )}
        </div>
      </div>
    </ToolPage>
  );
}
