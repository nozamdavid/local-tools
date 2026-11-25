import { useState, useMemo } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { type RGBA, formatHex, parseColorAny, getContrastRatio, evaluateWcag, suggestPassingColor } from '../_color/convert';
import styles from './Tool.module.css';

export default function ColorContrastTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-color-contrast');

  const [textHex, setTextHex] = useState<string>('#595959');
  const [bgHex, setBgHex] = useState<string>('#ffffff');

  const textRgba = useMemo<RGBA>(() => {
    return parseColorAny(textHex) || { r: 89, g: 89, b: 89, a: 1 };
  }, [textHex]);

  const bgRgba = useMemo<RGBA>(() => {
    return parseColorAny(bgHex) || { r: 255, g: 255, b: 255, a: 1 };
  }, [bgHex]);

  const ratio = useMemo(() => {
    return getContrastRatio(textRgba, bgRgba);
  }, [textRgba, bgRgba]);

  const evalResults = useMemo(() => {
    return evaluateWcag(ratio);
  }, [ratio]);

  const handleSwap = () => {
    const tempText = textHex;
    setTextHex(bgHex);
    setBgHex(tempText);
  };

  const handleTextPicker = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTextHex(e.target.value);
  };

  const handleBgPicker = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBgHex(e.target.value);
  };

  // Suggest passing color for AA (4.5)
  const suggestedAa = useMemo(() => {
    if (evalResults.aaNormal) return null;
    const passing = suggestPassingColor(textRgba, bgRgba, 4.5);
    const newRatio = getContrastRatio(passing, bgRgba);
    return {
      rgba: passing,
      hex: formatHex(passing, 6),
      ratio: newRatio,
    };
  }, [textRgba, bgRgba, evalResults.aaNormal]);

  // Suggest passing color for AAA (7.0)
  const suggestedAaa = useMemo(() => {
    if (evalResults.aaaNormal) return null;
    const passing = suggestPassingColor(textRgba, bgRgba, 7.0);
    const newRatio = getContrastRatio(passing, bgRgba);
    return {
      rgba: passing,
      hex: formatHex(passing, 6),
      ratio: newRatio,
    };
  }, [textRgba, bgRgba, evalResults.aaaNormal]);

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-color-contrast">
      <div className={styles.container}>
        <div className={styles.inputsRow}>
          <div className={styles.colorPickerBlock}>
            <label className={styles.colorLabel}>{t('Text colour')}</label>
            <div className={styles.pickerControls}>
              <input
                type="color"
                className={styles.colorInput}
                value={formatHex(textRgba, 6)}
                onChange={handleTextPicker}
                title={t('Pick text colour')}
                aria-label={t('Pick text colour')}
              />
              <input
                type="text"
                className={styles.textInput}
                value={textHex}
                onChange={(e) => setTextHex(e.target.value)}
                placeholder="#595959"
                aria-label={t('Text colour hex')}
              />
            </div>
          </div>

          <Button variant="secondary" className={styles.swapButton} onClick={handleSwap} title={t('Swap colours')}>
            ⇄ {t('Swap')}
          </Button>

          <div className={styles.colorPickerBlock}>
            <label className={styles.colorLabel}>{t('Background colour')}</label>
            <div className={styles.pickerControls}>
              <input
                type="color"
                className={styles.colorInput}
                value={formatHex(bgRgba, 6)}
                onChange={handleBgPicker}
                title={t('Pick background colour')}
                aria-label={t('Pick background colour')}
              />
              <input
                type="text"
                className={styles.textInput}
                value={bgHex}
                onChange={(e) => setBgHex(e.target.value)}
                placeholder="#ffffff"
                aria-label={t('Background colour hex')}
              />
            </div>
          </div>
        </div>

        <div className={styles.ratioCard}>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('WCAG 2.x contrast ratio')}</div>
          <div className={styles.ratioValue}>{ratio.toFixed(2)} : 1</div>

          <div className={styles.evalGrid}>
            <div className={styles.evalCard}>
              <div className={styles.evalTitle}>{t('Normal text')}</div>
              <div className={styles.evalBadgeRow}>
                <span>{t('Level AA (4.5:1)')}</span>
                <span className={evalResults.aaNormal ? styles.badgePass : styles.badgeFail}>
                  {evalResults.aaNormal ? t('PASS') : t('FAIL')}
                </span>
              </div>
              <div className={styles.evalBadgeRow}>
                <span>{t('Level AAA (7.0:1)')}</span>
                <span className={evalResults.aaaNormal ? styles.badgePass : styles.badgeFail}>
                  {evalResults.aaaNormal ? t('PASS') : t('FAIL')}
                </span>
              </div>
            </div>

            <div className={styles.evalCard}>
              <div className={styles.evalTitle}>{t('Large text (≥ 18pt / 14pt bold)')}</div>
              <div className={styles.evalBadgeRow}>
                <span>{t('Level AA (3.0:1)')}</span>
                <span className={evalResults.aaLarge ? styles.badgePass : styles.badgeFail}>
                  {evalResults.aaLarge ? t('PASS') : t('FAIL')}
                </span>
              </div>
              <div className={styles.evalBadgeRow}>
                <span>{t('Level AAA (4.5:1)')}</span>
                <span className={evalResults.aaaLarge ? styles.badgePass : styles.badgeFail}>
                  {evalResults.aaaLarge ? t('PASS') : t('FAIL')}
                </span>
              </div>
            </div>

            <div className={styles.evalCard}>
              <div className={styles.evalTitle}>{t('UI components & graphics')}</div>
              <div className={styles.evalBadgeRow}>
                <span>{t('Level AA (3.0:1)')}</span>
                <span className={evalResults.uiComponent ? styles.badgePass : styles.badgeFail}>
                  {evalResults.uiComponent ? t('PASS') : t('FAIL')}
                </span>
              </div>
              <div className={styles.evalBadgeRow}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('Form borders & icons')}</span>
                <span className={evalResults.uiComponent ? styles.badgePass : styles.badgeFail}>
                  {evalResults.uiComponent ? t('PASS') : t('FAIL')}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          className={styles.previewContainer}
          aria-hidden="true"
          style={{
            backgroundColor: formatHex(bgRgba, 6),
            color: formatHex(textRgba, 6),
          }}
        >
          <div className={styles.previewLarge}>{t('Large heading text (24px bold)')}</div>
          <div className={styles.previewNormal}>
            {t(
              'This is regular paragraph text demonstrating readability under current lighting and contrast conditions. Good contrast ensures that all users, including those with moderate low vision, can read content without difficulty.',
            )}
          </div>
          <div className={styles.previewUiRow}>
            <div
              className={styles.previewButton}
              style={{
                border: `2px solid ${formatHex(textRgba, 6)}`,
                color: formatHex(textRgba, 6),
              }}
            >
              <span>{t('Sample button')}</span>
            </div>
            <div
              className={styles.previewButton}
              style={{
                backgroundColor: formatHex(textRgba, 6),
                color: formatHex(bgRgba, 6),
              }}
            >
              <span>{t('Filled button')}</span>
            </div>
          </div>
        </div>

        {(suggestedAa || suggestedAaa) && (
          <div className={styles.suggestionSection}>
            <div className={styles.suggestionHeader}>
              <span style={{ fontWeight: 600 }}>{t('Suggested passing colours')}</span>
              <span className={styles.suggestionText}>{t('Adjusts lightness to reach passing ratio')}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {suggestedAa && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '4px',
                        backgroundColor: suggestedAa.hex,
                        border: '1px solid var(--border)',
                      }}
                    />
                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{suggestedAa.hex.toUpperCase()}</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {t('(Ratio: {ratio} : 1 for AA)', { ratio: suggestedAa.ratio.toFixed(2) })}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setTextHex(suggestedAa.hex)}
                    style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem' }}
                  >
                    {t('Apply for AA')}
                  </Button>
                </div>
              )}

              {suggestedAaa && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '4px',
                        backgroundColor: suggestedAaa.hex,
                        border: '1px solid var(--border)',
                      }}
                    />
                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{suggestedAaa.hex.toUpperCase()}</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {t('(Ratio: {ratio} : 1 for AAA)', { ratio: suggestedAaa.ratio.toFixed(2) })}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setTextHex(suggestedAaa.hex)}
                    style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem' }}
                  >
                    {t('Apply for AAA')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
