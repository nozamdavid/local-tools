import { useState, useMemo } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { useI18n } from '../../lib/i18n';
import { copyText } from '../../lib/clipboard';
import { downloadBlob } from '../../lib/download';
import { escapeStyleTagBreakout, sanitizeSampleHtml } from '../../lib/inertMarkup';
import styles from './Tool.module.css';

const DEFAULT_CSS = `/* Sample CSS - Edit live below */
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  padding: 2rem;
  background-color: #f8fafc;
  color: #1e293b;
  margin: 0;
}

.card {
  background: #ffffff;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  max-width: 420px;
  margin: 0 auto;
  border: 1px solid #e2e8f0;
}

.badge {
  display: inline-block;
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 9999px;
  background-color: #e0e7ff;
  color: #4338ca;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.75rem;
}

.title {
  margin: 0 0 0.5rem 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
}

.description {
  margin: 0 0 1.25rem 0;
  color: #64748b;
  font-size: 0.95rem;
  line-height: 1.5;
}

.btn-primary {
  display: inline-block;
  background-color: #2563eb;
  color: #ffffff;
  font-weight: 600;
  font-size: 0.9rem;
  padding: 0.6rem 1.2rem;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.btn-primary:hover {
  background-color: #1d4ed8;
}

.btn-secondary {
  display: inline-block;
  background-color: #f1f5f9;
  color: #334155;
  font-weight: 600;
  font-size: 0.9rem;
  padding: 0.6rem 1.2rem;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  margin-left: 0.5rem;
  cursor: pointer;
}
`;

export const HTML_PRESETS: Record<string, { label: string; html: string }> = {
  card: {
    label: 'Profile / Product Card',
    html: `<div class="card">
  <span class="badge">Featured</span>
  <h2 class="title">Modern Component</h2>
  <p class="description">
    Inspect how your CSS renders locally inside a safe sandbox with instant live preview.
  </p>
  <button class="btn-primary">Get Started</button>
  <button class="btn-secondary">Learn More</button>
</div>`,
  },
  buttons: {
    label: 'Buttons & Badges',
    html: `<div style="display:flex; flex-direction:column; gap:1rem; align-items:flex-start;">
  <div>
    <span class="badge" style="background:#dcfce7; color:#15803d;">Active</span>
    <span class="badge" style="background:#fee2e2; color:#b91c1c;">Alert</span>
    <span class="badge">Info</span>
  </div>
  <div style="display:flex; gap:0.5rem;">
    <button class="btn-primary">Primary Button</button>
    <button class="btn-secondary">Secondary Button</button>
  </div>
</div>`,
  },
  form: {
    label: 'Interactive Form',
    html: `<div class="card" style="display:flex; flex-direction:column; gap:0.75rem;">
  <h2 class="title">Contact Support</h2>
  <div>
    <label style="display:block; font-size:0.85rem; font-weight:600; margin-bottom:0.25rem;">Email Address</label>
    <input type="email" placeholder="you@example.com" style="width:100%; box-sizing:border-box; padding:0.5rem; border:1px solid #cbd5e1; border-radius:6px;" />
  </div>
  <div>
    <label style="display:block; font-size:0.85rem; font-weight:600; margin-bottom:0.25rem;">Message</label>
    <textarea rows="3" placeholder="How can we help?" style="width:100%; box-sizing:border-box; padding:0.5rem; border:1px solid #cbd5e1; border-radius:6px;"></textarea>
  </div>
  <button class="btn-primary" type="button" style="margin-top:0.5rem;">Submit Inquiry</button>
</div>`,
  },
  typography: {
    label: 'Typography & Layout',
    html: `<div style="max-width:600px; margin:0 auto;">
  <span class="badge">Documentation</span>
  <h1 style="font-size:2rem; font-weight:800; margin:0.5rem 0 1rem 0;">Typography Overview</h1>
  <p style="font-size:1.1rem; line-height:1.6; color:#475569;">
    Clean typography establishes hierarchy and helps readers navigate content effortlessly.
  </p>
  <blockquote style="border-left:4px solid #3b82f6; padding-left:1rem; margin:1.5rem 0; font-style:italic; color:#64748b;">
    "Simplicity is the soul of efficiency." — Austin Freeman
  </blockquote>
</div>`,
  },
};

export default function CssViewerTool() {
  const { t } = useI18n();
  const meta = getToolMeta('css-viewer');
  const title = meta.title !== 'css-viewer' ? meta.title : t('CSS Viewer');
  const description = meta.description || t('View, live edit, inspect, and test CSS stylesheets securely in a sandboxed preview.');

  const diagnosticText = (message: string) => {
    const braceMatch = message.match(/^Mismatched braces detected: (\d+) opening '\{' vs (\d+) closing '\}'.$/);
    if (braceMatch)
      return t('Mismatched braces detected: {open} opening braces vs {close} closing braces.', {
        open: braceMatch[1],
        close: braceMatch[2],
      });
    if (message.startsWith('Parser diagnostic: '))
      return t('Parser diagnostic: {message}', { message: message.slice('Parser diagnostic: '.length) });
    return t(message);
  };

  const [cssCode, setCssCode] = useState<string>(DEFAULT_CSS);
  const [selectedPreset, setSelectedPreset] = useState<string>('card');
  const [sampleHtml, setSampleHtml] = useState<string>(HTML_PRESETS.card.html);
  const [deviceWidth, setDeviceWidth] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [activeTab, setActiveTab] = useState<'css' | 'html'>('css');
  const [copied, setCopied] = useState<boolean>(false);

  // Handle uploaded CSS file
  const handleFileUpload = (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      setCssCode(text);
    };
    reader.readAsText(file);
  };

  // Change preset
  const handlePresetChange = (presetKey: string) => {
    setSelectedPreset(presetKey);
    if (HTML_PRESETS[presetKey]) {
      setSampleHtml(HTML_PRESETS[presetKey].html);
    }
  };

  // Browser CSS parsing diagnostics (explicitly partial)
  const diagnostics = useMemo(() => {
    const warnings: string[] = [];
    let selectorCount = 0;
    let mediaQueryCount = 0;
    let keyframeCount = 0;

    // Check for @import and external urls
    if (/@import\s+/i.test(cssCode)) {
      warnings.push('@import rules are present. For host security and privacy, network imports are blocked by the sandboxed CSP.');
    }
    if (/url\s*\(\s*['"]?https?:\/\//i.test(cssCode)) {
      warnings.push('Remote network url(...) references detected. External fonts and images are blocked by CSP.');
    }

    // Unclosed braces or comments heuristic
    const openBraces = (cssCode.match(/{/g) || []).length;
    const closeBraces = (cssCode.match(/}/g) || []).length;
    if (openBraces !== closeBraces) {
      warnings.push(`Mismatched braces detected: ${openBraces} opening '{' vs ${closeBraces} closing '}'.`);
    }

    const openComments = (cssCode.match(/\/\*/g) || []).length;
    const closeComments = (cssCode.match(/\*\//g) || []).length;
    if (openComments !== closeComments) {
      warnings.push('Unterminated CSS comment (/* ... */) detected.');
    }

    // Partial CSSStyleSheet inspection in browser if supported
    if (typeof CSSStyleSheet !== 'undefined') {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(cssCode);
        for (let i = 0; i < sheet.cssRules.length; i++) {
          const rule = sheet.cssRules[i];
          if (rule instanceof CSSStyleRule) {
            selectorCount++;
          } else if (rule instanceof CSSMediaRule) {
            mediaQueryCount++;
          } else if (rule instanceof CSSKeyframesRule) {
            keyframeCount++;
          }
        }
      } catch (err: unknown) {
        warnings.push(`Parser diagnostic: ${(err as Error).message || String(err)}`);
      }
    } else {
      // Fallback heuristic counts
      selectorCount = (cssCode.match(/\{/g) || []).length;
      mediaQueryCount = (cssCode.match(/@media\b/gi) || []).length;
      keyframeCount = (cssCode.match(/@keyframes\b/gi) || []).length;
    }

    return {
      ruleCount: selectorCount,
      mediaQueryCount,
      keyframeCount,
      warnings,
      charCount: cssCode.length,
      lineCount: cssCode.split('\n').length,
    };
  }, [cssCode]);

  // Construct iframe srcDoc with strict CSP and sandboxing
  const iframeSrcDoc = useMemo(() => {
    const safeCss = escapeStyleTagBreakout(cssCode);
    const safeHtml = sanitizeSampleHtml(sampleHtml);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none';">
  <style>
${safeCss}
  </style>
</head>
<body>
${safeHtml}
</body>
</html>`;
  }, [cssCode, sampleHtml]);

  // Width container based on device
  const containerWidth = useMemo(() => {
    switch (deviceWidth) {
      case 'mobile':
        return '375px';
      case 'tablet':
        return '768px';
      case 'desktop':
      default:
        return '100%';
    }
  }, [deviceWidth]);

  // Actions
  const handleCopy = async () => {
    try {
      await copyText(cssCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      alert(t('Could not copy to clipboard.'));
    }
  };

  const handleDownload = () => {
    const blob = new Blob([cssCode], { type: 'text/css;charset=utf-8' });
    downloadBlob(blob, 'styles.css');
  };

  return (
    <ToolPage title={title} description={description} currentId="css-viewer">
      <div className={styles.container}>
        <FileDrop
          accept=".css,text/css"
          multiple={false}
          label={t('Drop CSS file here or edit code below')}
          hint={t('CSS is rendered inside an isolated, sandboxed iframe. Nothing leaves your browser.')}
          onFiles={handleFileUpload}
        />

        {/* Top Controls Bar */}
        <div className={styles.topBar}>
          <div className={styles.deviceControls}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginRight: '0.25rem' }}>{t('Viewport:')}</span>
            <button
              type="button"
              className={`${styles.deviceBtn} ${deviceWidth === 'desktop' ? styles.deviceBtnActive : ''}`}
              onClick={() => setDeviceWidth('desktop')}
            >
              🖥️ {t('Desktop (100%)')}
            </button>
            <button
              type="button"
              className={`${styles.deviceBtn} ${deviceWidth === 'tablet' ? styles.deviceBtnActive : ''}`}
              onClick={() => setDeviceWidth('tablet')}
            >
              📱 {t('Tablet (768px)')}
            </button>
            <button
              type="button"
              className={`${styles.deviceBtn} ${deviceWidth === 'mobile' ? styles.deviceBtnActive : ''}`}
              onClick={() => setDeviceWidth('mobile')}
            >
              📱 {t('Mobile (375px)')}
            </button>
          </div>

          <div className={styles.actionBtns}>
            <Button variant="secondary" onClick={handleCopy}>
              {copied ? `✓ ${t('Copied')}` : t('Copy CSS')}
            </Button>
            <Button variant="primary" onClick={handleDownload}>
              {t('Download CSS')}
            </Button>
          </div>
        </div>

        {/* Split Editor and Preview Grid */}
        <div className={styles.editorGrid}>
          {/* Left: Code Editor Pane */}
          <div className={styles.editorPane}>
            <div className={styles.paneHeader}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className={`${styles.deviceBtn} ${activeTab === 'css' ? styles.deviceBtnActive : ''}`}
                  onClick={() => setActiveTab('css')}
                >
                  {t('CSS editor')}
                </button>
                <button
                  type="button"
                  className={`${styles.deviceBtn} ${activeTab === 'html' ? styles.deviceBtnActive : ''}`}
                  onClick={() => setActiveTab('html')}
                >
                  {t('Sample HTML')}
                </button>
              </div>

              {activeTab === 'html' && (
                <select
                  className={styles.presetSelect}
                  value={selectedPreset}
                  aria-label={t('HTML preset')}
                  onChange={(e) => handlePresetChange(e.target.value)}
                >
                  {Object.entries(HTML_PRESETS).map(([k, p]) => (
                    <option key={k} value={k}>
                      {t('Preset:')} {t(p.label)}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {activeTab === 'css' ? (
              <textarea
                className={styles.codeArea}
                value={cssCode}
                onChange={(e) => setCssCode(e.target.value)}
                placeholder={t('Paste or write CSS stylesheet here...')}
                aria-label={t('CSS stylesheet')}
                spellCheck={false}
              />
            ) : (
              <textarea
                className={styles.codeArea}
                value={sampleHtml}
                onChange={(e) => setSampleHtml(e.target.value)}
                placeholder={t('Edit sample HTML to test against the stylesheet...')}
                aria-label={t('Sample HTML code')}
                spellCheck={false}
              />
            )}
          </div>

          {/* Right: Sandboxed Preview Pane */}
          <div className={styles.previewWrapper}>
            <div className={styles.previewFrameContainer} style={{ width: containerWidth }}>
              <iframe title={t('CSS sandbox preview')} className={styles.previewFrame} sandbox="" srcDoc={iframeSrcDoc} />
            </div>
          </div>
        </div>

        {/* Browser CSS Parsing Diagnostics */}
        <div className={styles.diagPanel}>
          <div className={styles.diagHeader}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{t('Browser CSS parsing diagnostics')}</h2>
            <span className={styles.diagBadge}>{t('Partial preview analysis')}</span>
          </div>

          <div className={styles.diagStats}>
            <div className={styles.statCard}>
              <div className={styles.statNum}>{diagnostics.ruleCount}</div>
              <div className={styles.statLabel}>{t('Style rules')}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statNum}>{diagnostics.mediaQueryCount}</div>
              <div className={styles.statLabel}>{t('Media queries')}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statNum}>{diagnostics.keyframeCount}</div>
              <div className={styles.statLabel}>{t('Keyframe blocks')}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statNum}>{diagnostics.lineCount}</div>
              <div className={styles.statLabel}>{t('Lines of CSS')}</div>
            </div>
          </div>

          {diagnostics.warnings.length > 0 && (
            <ul className={styles.diagWarnings}>
              {diagnostics.warnings.map((w, idx) => (
                <li key={idx} className={styles.diagWarningItem}>
                  ⚠️ {diagnosticText(w)}
                </li>
              ))}
            </ul>
          )}

          <div className={styles.diagDisclaimer}>
            <strong>{t('Note on diagnostics:')}</strong>{' '}
            {t(
              'Modern browser CSS parsers discard invalid properties and malformed rules silently without generating fatal syntax exceptions. These diagnostics provide a partial preview inspection and do not constitute a full CSS standards validation.',
            )}
          </div>
        </div>
      </div>
    </ToolPage>
  );
}
