import { useState, useEffect, useRef, useId, useCallback } from 'react';
import JsBarcode from 'jsbarcode';
import { ToolPage } from '../../../components/ToolPage';
import { Field, Slider, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { downloadBlob } from '../../../lib/download';
import { BARCODE_FORMATS, validateBarcode, type BarcodeFormat, type BarcodeValidationResult } from '../_generate/barcode';
import styles from './Tool.module.css';

export default function BarcodeGeneratorTool() {
  const { t, locale } = useI18n();
  const meta = getToolMeta('img-barcode-generator');

  const [format, setFormat] = useState<BarcodeFormat>('CODE128');
  const [inputValue, setInputValue] = useState<string>('LOCONVERT-2026');

  // Barcode options
  const [barWidth, setBarWidth] = useState<number>(2);
  const [height, setHeight] = useState<number>(80);
  const [showText, setShowText] = useState<boolean>(true);
  const [fontSize, setFontSize] = useState<number>(18);
  const [margin, setMargin] = useState<number>(10);
  const [lineColor, setLineColor] = useState<string>('#000000');
  const [bgColor, setBgColor] = useState<string>('#ffffff');
  const [transparentBg, setTransparentBg] = useState<boolean>(false);

  const [validation, setValidation] = useState<BarcodeValidationResult>(() => validateBarcode('CODE128', 'LOCONVERT-2026'));

  const svgRef = useRef<SVGSVGElement | null>(null);
  const formatSelectId = useId();

  // Update validation whenever format or inputValue changes
  useEffect(() => {
    const res = validateBarcode(format, inputValue);
    setValidation(res);
  }, [format, inputValue, locale]);

  // When switching formats, if input is completely incompatible or empty, provide the format's example
  const handleFormatChange = (newFormat: BarcodeFormat) => {
    setFormat(newFormat);
    const def = BARCODE_FORMATS.find((f) => f.id === newFormat);
    if (def) {
      const test = validateBarcode(newFormat, inputValue);
      if (!test.valid) {
        setInputValue(def.example);
      }
    }
  };

  // Auto-fix check digit
  const handleFixCheckDigit = () => {
    if (validation.expectedCheckDigit !== undefined) {
      const clean = inputValue.trim().replace(/\s+/g, '');
      const fixed = clean.slice(0, clean.length - 1) + validation.expectedCheckDigit;
      setInputValue(fixed);
    }
  };

  // Render barcode into SVG
  const renderBarcode = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    if (!validation.valid || !validation.code) {
      while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
      }
      return;
    }

    try {
      JsBarcode(svg, validation.code, {
        format: format === 'UPC' ? 'UPC' : format,
        width: barWidth,
        height: height,
        displayValue: showText,
        fontSize: fontSize,
        margin: margin,
        lineColor: lineColor,
        background: transparentBg ? 'transparent' : bgColor,
        font: 'monospace',
        textMargin: 4,
      });
    } catch (err: any) {
      console.warn('JsBarcode rendering error:', err);
    }
  }, [validation, format, barWidth, height, showText, fontSize, margin, lineColor, bgColor, transparentBg]);

  useEffect(() => {
    renderBarcode();
  }, [renderBarcode]);

  // Download SVG
  const handleDownloadSvg = () => {
    const svg = svgRef.current;
    if (!svg || !validation.valid) return;

    const svgXml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, `barcode-${format.toLowerCase()}-${validation.code}.svg`);
  };

  // Download PNG
  const handleDownloadPng = () => {
    if (!validation.valid || !validation.code) return;

    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, validation.code, {
        format: format === 'UPC' ? 'UPC' : format,
        width: barWidth,
        height: height,
        displayValue: showText,
        fontSize: fontSize,
        margin: margin,
        lineColor: lineColor,
        background: transparentBg ? 'transparent' : bgColor,
        font: 'monospace',
        textMargin: 4,
      });

      canvas.toBlob((blob) => {
        if (blob) {
          downloadBlob(blob, `barcode-${format.toLowerCase()}-${validation.code}.png`);
        }
      }, 'image/png');
    } catch (err) {
      console.error('Failed to create PNG canvas:', err);
    }
  };

  const currentDef = BARCODE_FORMATS.find((f) => f.id === format);

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-barcode-generator">
      <div className={styles.container}>
        <div className={styles.layout}>
          {/* Controls Column */}
          <div className={styles.panel}>
            <Field label={t('Barcode format')} hint={currentDef ? t(currentDef.description) : undefined}>
              <Select
                id={formatSelectId}
                value={format}
                onChange={(e) => handleFormatChange(e.target.value as BarcodeFormat)}
                options={BARCODE_FORMATS.map((f) => ({ value: f.id, label: t(f.label) }))}
              />
            </Field>

            <Field label={t('Barcode value')} hint={t('Example: {example}', { example: currentDef?.example || '' })}>
              <input
                type="text"
                className="input"
                value={inputValue}
                placeholder={t(currentDef?.placeholder || 'Enter value...')}
                onChange={(e) => setInputValue(e.target.value)}
              />
            </Field>

            {validation.error && (
              <div className={styles.errorMessage}>
                <span>{validation.error}</span>
                {validation.autoFixAvailable && (
                  <button type="button" className={styles.fixButton} onClick={handleFixCheckDigit}>
                    {t('Fix check digit')}
                  </button>
                )}
              </div>
            )}

            {validation.warning && <div className={styles.warningMessage}>{validation.warning}</div>}

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />

            <div className={styles.twoCols}>
              <Field label={t('Bar width')}>
                <Slider min={1} max={4} step={1} unit="px" value={barWidth} onChange={setBarWidth} />
              </Field>

              <Field label={t('Height')}>
                <Slider min={30} max={160} step={5} unit="px" value={height} onChange={setHeight} />
              </Field>
            </div>

            <div className={styles.twoCols}>
              <Field label={t('Margin')}>
                <Slider min={0} max={30} step={2} unit="px" value={margin} onChange={setMargin} />
              </Field>

              <Field label={t('Show text')}>
                <div style={{ marginTop: '0.4rem' }}>
                  <label className={styles.checkboxLabel}>
                    <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} />
                    {t('Display human-readable text')}
                  </label>
                </div>
              </Field>
            </div>

            {showText && (
              <Field label={t('Font size')}>
                <Slider min={10} max={30} step={1} unit="px" value={fontSize} onChange={setFontSize} />
              </Field>
            )}

            <div className={styles.twoCols}>
              <Field label={t('Line colour')}>
                <div className={styles.colorPickerRow}>
                  <input
                    type="color"
                    className={styles.colorInput}
                    value={lineColor}
                    aria-label={t('Line colour')}
                    onChange={(e) => setLineColor(e.target.value)}
                  />
                  <span>{lineColor}</span>
                </div>
              </Field>

              <Field label={t('Background colour')}>
                <div className={styles.colorPickerRow}>
                  <input
                    type="color"
                    className={styles.colorInput}
                    value={bgColor}
                    disabled={transparentBg}
                    aria-label={t('Background colour')}
                    onChange={(e) => setBgColor(e.target.value)}
                  />
                  <label className={styles.checkboxLabel}>
                    <input type="checkbox" checked={transparentBg} onChange={(e) => setTransparentBg(e.target.checked)} />
                    {t('Transparent')}
                  </label>
                </div>
              </Field>
            </div>
          </div>

          {/* Preview & Download Column */}
          <div className={styles.previewCard}>
            <div className={styles.previewWrapper}>
              {validation.valid ? (
                <svg ref={svgRef} className={styles.previewSvg} role="img" aria-label={t('Barcode preview')} />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('Enter a valid barcode to view preview')}</div>
              )}
            </div>

            <div className={styles.actions}>
              <Button className={styles.actionBtn} disabled={!validation.valid} onClick={handleDownloadPng}>
                {t('Download PNG')}
              </Button>
              <Button variant="secondary" className={styles.actionBtn} disabled={!validation.valid} onClick={handleDownloadSvg}>
                {t('Download SVG')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ToolPage>
  );
}
