import { useState, useEffect } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { Button, Slider } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import {
  type RGBA,
  formatHex,
  formatRgb,
  formatHsl,
  formatHsv,
  formatCmyk,
  rgbToHsl,
  hslToRgb,
  rgbToHsv,
  hsvToRgb,
  rgbToCmyk,
  cmykToRgb,
  parseHex,
  parseRgb,
  parseHsl,
  parseHsv,
  parseCmyk,
  findMatchingNamedColor,
  CSS_NAMED_COLORS,
} from '../_color/convert';
import styles from './Tool.module.css';

const PRESETS = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Coral', hex: '#ff7f50' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Sky Blue', hex: '#0284c7' },
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Fuchsia', hex: '#d946ef' },
  { name: 'Slate', hex: '#64748b' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Black', hex: '#000000' },
];

export default function HexRgbConverterTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-hex-rgb-converter');

  const [rgba, setRgba] = useState<RGBA>({ r: 59, g: 130, b: 246, a: 1 });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Editable input text state
  const [hexInput, setHexInput] = useState<string>('#3b82f6');
  const [rgbInput, setRgbInput] = useState<string>('rgb(59, 130, 246)');
  const [hslInput, setHslInput] = useState<string>('hsl(217, 91%, 60%)');
  const [hsvInput, setHsvInput] = useState<string>('hsv(217, 76%, 96%)');
  const [cmykInput, setCmykInput] = useState<string>('cmyk(76%, 47%, 0%, 4%)');
  const [namedInput, setNamedInput] = useState<string>('');

  // Synchronize input fields when rgba changes from picker/presets
  const syncInputsFromRgba = (color: RGBA) => {
    const hsla = rgbToHsl(color);
    const hsva = rgbToHsv(color);
    const cmyk = rgbToCmyk(color);

    setHexInput(formatHex(color, color.a < 1 ? 8 : 6));
    setRgbInput(formatRgb(color, color.a < 1));
    setHslInput(formatHsl(hsla, color.a < 1));
    setHsvInput(formatHsv(hsva, color.a < 1));
    setCmykInput(formatCmyk(cmyk));

    const matched = findMatchingNamedColor(color);
    setNamedInput(matched || '');
  };

  useEffect(() => {
    syncInputsFromRgba(rgba);
  }, []);

  const handleNativePicker = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseHex(e.target.value);
    if (parsed) {
      const updated = { ...parsed, a: rgba.a };
      setRgba(updated);
      syncInputsFromRgba(updated);
    }
  };

  const handleAlphaChange = (newAlphaPercent: number) => {
    const updated = { ...rgba, a: Math.round(newAlphaPercent) / 100 };
    setRgba(updated);
    syncInputsFromRgba(updated);
  };

  const handleHexChange = (text: string) => {
    setHexInput(text);
    const parsed = parseHex(text);
    if (parsed) {
      setRgba(parsed);
      const hsla = rgbToHsl(parsed);
      const hsva = rgbToHsv(parsed);
      const cmyk = rgbToCmyk(parsed);
      setRgbInput(formatRgb(parsed, parsed.a < 1));
      setHslInput(formatHsl(hsla, parsed.a < 1));
      setHsvInput(formatHsv(hsva, parsed.a < 1));
      setCmykInput(formatCmyk(cmyk));
      setNamedInput(findMatchingNamedColor(parsed) || '');
    }
  };

  const handleRgbChange = (text: string) => {
    setRgbInput(text);
    const parsed = parseRgb(text);
    if (parsed) {
      setRgba(parsed);
      const hsla = rgbToHsl(parsed);
      const hsva = rgbToHsv(parsed);
      const cmyk = rgbToCmyk(parsed);
      setHexInput(formatHex(parsed, parsed.a < 1 ? 8 : 6));
      setHslInput(formatHsl(hsla, parsed.a < 1));
      setHsvInput(formatHsv(hsva, parsed.a < 1));
      setCmykInput(formatCmyk(cmyk));
      setNamedInput(findMatchingNamedColor(parsed) || '');
    }
  };

  const handleHslChange = (text: string) => {
    setHslInput(text);
    const parsed = parseHsl(text);
    if (parsed) {
      const rgbColor = hslToRgb(parsed);
      setRgba(rgbColor);
      setHexInput(formatHex(rgbColor, rgbColor.a < 1 ? 8 : 6));
      setRgbInput(formatRgb(rgbColor, rgbColor.a < 1));
      setHsvInput(formatHsv(rgbToHsv(rgbColor), rgbColor.a < 1));
      setCmykInput(formatCmyk(rgbToCmyk(rgbColor)));
      setNamedInput(findMatchingNamedColor(rgbColor) || '');
    }
  };

  const handleHsvChange = (text: string) => {
    setHsvInput(text);
    const parsed = parseHsv(text);
    if (parsed) {
      const rgbColor = hsvToRgb(parsed);
      setRgba(rgbColor);
      setHexInput(formatHex(rgbColor, rgbColor.a < 1 ? 8 : 6));
      setRgbInput(formatRgb(rgbColor, rgbColor.a < 1));
      setHslInput(formatHsl(rgbToHsl(rgbColor), rgbColor.a < 1));
      setCmykInput(formatCmyk(rgbToCmyk(rgbColor)));
      setNamedInput(findMatchingNamedColor(rgbColor) || '');
    }
  };

  const handleCmykChange = (text: string) => {
    setCmykInput(text);
    const parsed = parseCmyk(text);
    if (parsed) {
      const rgbColor = cmykToRgb(parsed, rgba.a);
      setRgba(rgbColor);
      setHexInput(formatHex(rgbColor, rgbColor.a < 1 ? 8 : 6));
      setRgbInput(formatRgb(rgbColor, rgbColor.a < 1));
      setHslInput(formatHsl(rgbToHsl(rgbColor), rgbColor.a < 1));
      setHsvInput(formatHsv(rgbToHsv(rgbColor), rgbColor.a < 1));
      setNamedInput(findMatchingNamedColor(rgbColor) || '');
    }
  };

  const handleNamedChange = (text: string) => {
    setNamedInput(text);
    const clean = text.trim().toLowerCase();
    if (CSS_NAMED_COLORS[clean]) {
      const parsed = parseHex(CSS_NAMED_COLORS[clean]);
      if (parsed) {
        const withAlpha = { ...parsed, a: rgba.a };
        setRgba(withAlpha);
        const hsla = rgbToHsl(withAlpha);
        const hsva = rgbToHsv(withAlpha);
        const cmyk = rgbToCmyk(withAlpha);
        setHexInput(formatHex(withAlpha, withAlpha.a < 1 ? 8 : 6));
        setRgbInput(formatRgb(withAlpha, withAlpha.a < 1));
        setHslInput(formatHsl(hsla, withAlpha.a < 1));
        setHsvInput(formatHsv(hsva, withAlpha.a < 1));
        setCmykInput(formatCmyk(cmyk));
      }
    }
  };

  const applyPreset = (presetHex: string) => {
    const parsed = parseHex(presetHex);
    if (parsed) {
      setRgba(parsed);
      syncInputsFromRgba(parsed);
    }
  };

  const copyValue = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-hex-rgb-converter">
      <div className={styles.container}>
        <div className={styles.topSection}>
          <div className={styles.previewColumn}>
            <div className={styles.previewBox}>
              <div
                className={styles.previewColor}
                style={{
                  backgroundColor: `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})`,
                }}
              />
            </div>

            <div className={styles.nativePickerWrapper}>
              <input
                type="color"
                className={styles.nativePicker}
                value={formatHex(rgba, 6)}
                onChange={handleNativePicker}
                title={t('Open native colour picker')}
                aria-label={t('Open native colour picker')}
              />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('Click to open colour picker')}</span>
            </div>

            <div className={styles.alphaSliderWrapper}>
              <div className={styles.alphaLabel}>
                <span>{t('Opacity')}:</span>
                <span>{Math.round(rgba.a * 100)}%</span>
              </div>
              <Slider min={0} max={100} step={1} value={Math.round(rgba.a * 100)} onChange={handleAlphaChange} aria-label={t('Opacity')} />
            </div>
          </div>

          <div className={styles.formatsGrid}>
            <div className={styles.formatRow}>
              <span className={styles.formatLabel}>HEX</span>
              <input
                type="text"
                className={styles.formatInput}
                value={hexInput}
                onChange={(e) => handleHexChange(e.target.value)}
                placeholder="#3b82f6 or #38f"
                aria-label={t('HEX colour')}
              />
              <Button
                variant="secondary"
                onClick={() => copyValue(hexInput, 'hex')}
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
              >
                {copiedKey === 'hex' ? t('Copied') : t('Copy')}
              </Button>
            </div>

            <div className={styles.formatRow}>
              <span className={styles.formatLabel}>RGB(A)</span>
              <input
                type="text"
                className={styles.formatInput}
                value={rgbInput}
                onChange={(e) => handleRgbChange(e.target.value)}
                placeholder="rgb(59, 130, 246)"
                aria-label={t('RGB colour')}
              />
              <Button
                variant="secondary"
                onClick={() => copyValue(rgbInput, 'rgb')}
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
              >
                {copiedKey === 'rgb' ? t('Copied') : t('Copy')}
              </Button>
            </div>

            <div className={styles.formatRow}>
              <span className={styles.formatLabel}>HSL(A)</span>
              <input
                type="text"
                className={styles.formatInput}
                value={hslInput}
                onChange={(e) => handleHslChange(e.target.value)}
                placeholder="hsl(217, 91%, 60%)"
                aria-label={t('HSL colour')}
              />
              <Button
                variant="secondary"
                onClick={() => copyValue(hslInput, 'hsl')}
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
              >
                {copiedKey === 'hsl' ? t('Copied') : t('Copy')}
              </Button>
            </div>

            <div className={styles.formatRow}>
              <span className={styles.formatLabel}>HSV</span>
              <input
                type="text"
                className={styles.formatInput}
                value={hsvInput}
                onChange={(e) => handleHsvChange(e.target.value)}
                placeholder="hsv(217, 76%, 96%)"
                aria-label={t('HSV colour')}
              />
              <Button
                variant="secondary"
                onClick={() => copyValue(hsvInput, 'hsv')}
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
              >
                {copiedKey === 'hsv' ? t('Copied') : t('Copy')}
              </Button>
            </div>

            <div className={styles.formatRow}>
              <span className={styles.formatLabel}>CMYK</span>
              <input
                type="text"
                className={styles.formatInput}
                value={cmykInput}
                onChange={(e) => handleCmykChange(e.target.value)}
                placeholder="cmyk(76%, 47%, 0%, 4%)"
                aria-label={t('CMYK colour')}
              />
              <Button
                variant="secondary"
                onClick={() => copyValue(cmykInput, 'cmyk')}
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
              >
                {copiedKey === 'cmyk' ? t('Copied') : t('Copy')}
              </Button>
            </div>

            <div className={styles.formatRow}>
              <span className={styles.formatLabel}>{t('CSS name')}</span>
              <input
                type="text"
                className={styles.formatInput}
                value={namedInput}
                onChange={(e) => handleNamedChange(e.target.value)}
                placeholder={t('For example: {first}, {second}', { first: 'royalblue', second: 'coral' })}
                aria-label={t('CSS named colour')}
              />
              <Button
                variant="secondary"
                onClick={() => copyValue(namedInput, 'named')}
                disabled={!namedInput}
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
              >
                {copiedKey === 'named' ? t('Copied') : t('Copy')}
              </Button>
            </div>
          </div>
        </div>

        <div className={styles.presetsSection}>
          <span className={styles.presetsTitle}>{t('Quick colour presets')}</span>
          <div className={styles.presetsList}>
            {PRESETS.map((p) => (
              <button key={p.name} type="button" className={styles.presetButton} onClick={() => applyPreset(p.hex)}>
                <span className={styles.presetDot} style={{ backgroundColor: p.hex }} />
                <span>{t(p.name)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ToolPage>
  );
}
