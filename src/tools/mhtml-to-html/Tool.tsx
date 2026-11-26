import { useMemo, useState } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button, Field, Select } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { useI18n } from '../../lib/i18n';
import { downloadBlob } from '../../lib/download';
import { zipFiles } from '../../lib/zip';
import { convertMhtmlToHtml } from './mhtml';
import styles from './Tool.module.css';

export default function MhtmlToHtmlTool() {
  const { t } = useI18n();
  const meta = getToolMeta('mhtml-to-html');
  const title = meta.title !== 'mhtml-to-html' ? meta.title : t('MHTML to HTML Converter');
  const description = meta.description || t('Convert MHTML/MHT web archives into standalone HTML or ZIP with safely extracted assets.');

  const [rawMhtml, setRawMhtml] = useState<Uint8Array | null>(null);
  const [sourceName, setSourceName] = useState<string>('archive');
  const [outputMode, setOutputMode] = useState<'standalone' | 'zip'>('standalone');
  const [blockRemote, setBlockRemote] = useState<boolean>(true);
  const [stripScripts, setStripScripts] = useState<boolean>(true);
  const [readError, setReadError] = useState<string | null>(null);
  const { conversionResult, conversionError } = useMemo(() => {
    if (!rawMhtml) return { conversionResult: null, conversionError: null };
    try {
      return {
        conversionResult: convertMhtmlToHtml(rawMhtml, {
          mode: outputMode,
          blockRemoteUrls: blockRemote,
          stripScripts,
        }),
        conversionError: null,
      };
    } catch (err) {
      return { conversionResult: null, conversionError: err instanceof Error ? err.message : String(err) };
    }
  }, [rawMhtml, outputMode, blockRemote, stripScripts]);
  const error = readError ?? conversionError;

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const base = file.name.replace(/(?<=.)\.[^/.]+$/, '');
    setReadError(null);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setRawMhtml(bytes);
      setSourceName(base);
    } catch (err) {
      setRawMhtml(null);
      setReadError(err instanceof Error ? err.message : String(err));
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
    setRawMhtml(null);
    setReadError(null);
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
                onChange={(e) => setOutputMode(e.target.value as 'standalone' | 'zip')}
                options={[
                  { value: 'standalone', label: t('Standalone single HTML (inlined assets)') },
                  { value: 'zip', label: t('ZIP package (index.html + /assets)') },
                ]}
              />
            </Field>

            <label className="checkbox-label" style={{ paddingBottom: '0.65rem' }}>
              <input type="checkbox" checked={blockRemote} onChange={(e) => setBlockRemote(e.target.checked)} />
              {t('Block unmapped remote URLs (shields private data)')}
            </label>

            <label className="checkbox-label" style={{ paddingBottom: '0.65rem' }}>
              <input type="checkbox" checked={stripScripts} onChange={(e) => setStripScripts(e.target.checked)} />
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
                <span className={styles.badge}>{outputMode === 'standalone' ? `${sourceName}.html` : `${sourceName}.zip`}</span>
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
                {t('Download')}
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
