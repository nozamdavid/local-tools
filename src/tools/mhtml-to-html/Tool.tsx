import { useState } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button, Field, Select } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { useI18n } from '../../lib/i18n';
import { downloadBlob } from '../../lib/download';
import { zipFiles } from '../../lib/zip';
import { convertMhtmlToHtml, type ConvertedMhtmlOutput } from './mhtml';
import styles from './Tool.module.css';

export default function MhtmlToHtmlTool() {
  const { t } = useI18n();
  const meta = getToolMeta('mhtml-to-html');
  const title = meta.title !== 'mhtml-to-html' ? meta.title : t('MHTML to HTML Converter');
  const description = meta.description || t('Convert MHTML/MHT web archives into standalone HTML or ZIP with safely extracted assets.');

  const [rawMhtml, setRawMhtml] = useState<string>('');
  const [sourceName, setSourceName] = useState<string>('archive');
  const [outputMode, setOutputMode] = useState<'standalone' | 'zip'>('standalone');
  const [blockRemote, setBlockRemote] = useState<boolean>(true);
  const [stripScripts, setStripScripts] = useState<boolean>(true);
  const [conversionResult, setConversionResult] = useState<ConvertedMhtmlOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const base = file.name.replace(/\.[^/.]+$/, '');
    setSourceName(base);
    setError(null);

    try {
      const text = await file.text();
      setRawMhtml(text);

      const res = convertMhtmlToHtml(text, {
        mode: outputMode,
        blockRemoteUrls: blockRemote,
        stripScripts,
      });
      setConversionResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setConversionResult(null);
    }
  };

  const reprocess = (mode: 'standalone' | 'zip', block: boolean, scripts: boolean) => {
    if (!rawMhtml) return;
    try {
      setError(null);
      const res = convertMhtmlToHtml(rawMhtml, {
        mode,
        blockRemoteUrls: block,
        stripScripts: scripts,
      });
      setConversionResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const handleDownload = async () => {
    if (!conversionResult) return;

    if (outputMode === 'standalone') {
      const blob = new Blob([conversionResult.html], { type: 'text/html;charset=utf-8' });
      downloadBlob(blob, `${sourceName}.html`);
    } else {
      // ZIP output
      const filesToZip: { name: string; blob: Blob }[] = [
        {
          name: 'index.html',
          blob: new Blob([conversionResult.html], { type: 'text/html;charset=utf-8' }),
        },
        ...(conversionResult.assets || []),
      ];
      const zipBlob = await zipFiles(filesToZip);
      downloadBlob(zipBlob, `${sourceName}.zip`);
    }
  };

  const handleReset = () => {
    setRawMhtml('');
    setConversionResult(null);
    setError(null);
    setSourceName('archive');
  };

  return (
    <ToolPage title={title} description={description} currentId="mhtml-to-html">
      <div className={styles.container}>
        <div className={styles.card}>
          <FileDrop
            accept=".mhtml,.mht,.mime,message/rfc822,text/html"
            label={t('Choose an MHTML or MHT web archive')}
            hint={t('Private and offline. All MIME parts and assets are extracted in your browser.')}
            onFiles={handleFiles}
          />

          <div className={styles.controlsRow}>
            <Field label={t('Output format')}>
              <Select
                value={outputMode}
                onChange={(e) => {
                  const mode = e.target.value as 'standalone' | 'zip';
                  setOutputMode(mode);
                  reprocess(mode, blockRemote, stripScripts);
                }}
                options={[
                  { value: 'standalone', label: t('Standalone single HTML (inlined assets)') },
                  { value: 'zip', label: t('ZIP package (index.html + /assets)') },
                ]}
              />
            </Field>

            <label className="checkbox-label" style={{ paddingBottom: '0.65rem' }}>
              <input
                type="checkbox"
                checked={blockRemote}
                onChange={(e) => {
                  const val = e.target.checked;
                  setBlockRemote(val);
                  reprocess(outputMode, val, stripScripts);
                }}
              />
              {t('Block unmapped remote URLs (shields private data)')}
            </label>

            <label className="checkbox-label" style={{ paddingBottom: '0.65rem' }}>
              <input
                type="checkbox"
                checked={stripScripts}
                onChange={(e) => {
                  const val = e.target.checked;
                  setStripScripts(val);
                  reprocess(outputMode, blockRemote, val);
                }}
              />
              {t('Strip JavaScript and event handlers')}
            </label>
          </div>
        </div>

        {error && (
          <div className={styles.errorBanner}>
            <span>⚠️ {t(error)}</span>
          </div>
        )}

        {conversionResult && (
          <div className={styles.previewCard}>
            <div className={styles.previewHeader}>
              <div className={styles.previewTitle}>
                {t('HTML preview')}
                <span className={styles.badge}>{outputMode === 'standalone' ? t('Standalone HTML') : t('ZIP package')}</span>
              </div>

              <div className={styles.statsRow}>
                <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                  {t('{count} assets resolved', { count: conversionResult.inlinedAssetsCount })}
                </span>
                {conversionResult.blockedRemoteCount > 0 && (
                  <span className={`${styles.badge} ${styles.badgeWarning}`}>
                    {t('{count} remote references blocked', { count: conversionResult.blockedRemoteCount })}
                  </span>
                )}
              </div>
            </div>

            {/* Sandboxed iframe preview: scripts disabled, no same-origin escalation, CSP enforced */}
            <div className={styles.iframeContainer}>
              <iframe title={t('Converted HTML preview')} sandbox="" srcDoc={conversionResult.html} className={styles.iframe} />
            </div>

            <div className={styles.actions}>
              <Button variant="primary" onClick={handleDownload}>
                {t('Download {file}', { file: outputMode === 'standalone' ? `${sourceName}.html` : `${sourceName}.zip` })}
              </Button>
              <Button variant="secondary" onClick={handleReset}>
                {t('Reset')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
