import { useState, useMemo } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button, Field } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { downloadBlob } from '../../lib/download';
import { peekPendingFiles } from '../../lib/handoff';
import { classifyFile } from '../../lib/toolInputs';
import { useI18n } from '../../lib/i18n';
import { copyText } from '../../lib/clipboard';
import { gpxToGeoData, kmlToGeoData, geoDataToGpx, geoDataToKml, getGeoSummary } from './gpxKml';
import styles from './Tool.module.css';

export default function GpxKmlTool() {
  const { t, locale } = useI18n();
  const meta = getToolMeta('gpx-kml');
  const title = meta.title !== 'gpx-kml' ? meta.title : t('GPX ↔ KML Converter');
  const description =
    meta.description ||
    t('Convert GPS tracks, routes, and waypoints between GPX and KML while preserving multi-segment boundaries and elevations.');

  const [direction, setDirection] = useState<'gpx-to-kml' | 'kml-to-gpx'>(() => {
    const pending = peekPendingFiles('/gpx-kml');
    if (pending && pending.length > 0) {
      const c = classifyFile(pending[0]);
      if (c.isKml) return 'kml-to-gpx';
      if (c.isGpx) return 'gpx-to-kml';
    }
    return 'gpx-to-kml';
  });

  const [inputTab, setInputTab] = useState<'paste' | 'upload'>('upload');
  const [inputText, setInputText] = useState<string>('');
  const [sourceName, setSourceName] = useState<string>('converted');
  const [copied, setCopied] = useState<boolean>(false);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const base = file.name.replace(/\.[^/.]+$/, '');
    setSourceName(base);

    const c = classifyFile(file);
    const text = await file.text();

    if (c.isKml) {
      setDirection('kml-to-gpx');
    } else if (c.isGpx) {
      setDirection('gpx-to-kml');
    } else if (c.ext === 'xml' || c.mime === 'application/xml' || c.mime === 'text/xml') {
      if (text.includes('<kml') || text.includes('<Document') || text.includes('<Placemark')) {
        setDirection('kml-to-gpx');
      } else if (text.includes('<gpx')) {
        setDirection('gpx-to-kml');
      }
    }

    setInputText(text);
  };

  const conversion = useMemo(() => {
    if (!inputText.trim()) {
      return { outputText: '', summary: null, error: null };
    }

    try {
      if (direction === 'gpx-to-kml') {
        if (inputText.includes('<kml') || inputText.includes('<Document') || inputText.includes('<Placemark')) {
          return {
            outputText: '',
            summary: null,
            error: 'Input appears to be KML, but GPX → KML mode is selected. Please switch to KML → GPX.',
          };
        }
        const geoData = gpxToGeoData(inputText);
        const kml = geoDataToKml(geoData);
        const summary = getGeoSummary(geoData);
        return { outputText: kml, summary, error: null };
      } else {
        if (inputText.includes('<gpx')) {
          return {
            outputText: '',
            summary: null,
            error: 'Input appears to be GPX, but KML → GPX mode is selected. Please switch to GPX → KML.',
          };
        }
        const geoData = kmlToGeoData(inputText);
        const gpx = geoDataToGpx(geoData);
        const summary = getGeoSummary(geoData);
        return { outputText: gpx, summary, error: null };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { outputText: '', summary: null, error: msg };
    }
    // Conversion helpers return localized errors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputText, direction, locale]);

  const outputFilename = useMemo(() => {
    const ext = direction === 'gpx-to-kml' ? '.kml' : '.gpx';
    return `${sourceName}${ext}`;
  }, [sourceName, direction]);

  const handleDownload = () => {
    if (!conversion.outputText) return;
    const mime = direction === 'gpx-to-kml' ? 'application/vnd.google-earth.kml+xml' : 'application/gpx+xml';
    const blob = new Blob([conversion.outputText], { type: `${mime};charset=utf-8` });
    downloadBlob(blob, outputFilename);
  };

  const handleCopy = async () => {
    if (!conversion.outputText) return;
    try {
      await copyText(conversion.outputText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      alert(t('Could not copy to clipboard.'));
    }
  };

  const handleReset = () => {
    setInputText('');
    setSourceName('converted');
  };

  return (
    <ToolPage title={title} description={description} currentId="gpx-kml">
      <div className={styles.container}>
        <div className={styles.directionToggle}>
          <button
            type="button"
            className={`${styles.directionBtn} ${direction === 'gpx-to-kml' ? styles.directionBtnActive : ''}`}
            onClick={() => setDirection('gpx-to-kml')}
          >
            GPX → KML
          </button>
          <button
            type="button"
            className={`${styles.directionBtn} ${direction === 'kml-to-gpx' ? styles.directionBtnActive : ''}`}
            onClick={() => setDirection('kml-to-gpx')}
          >
            KML → GPX
          </button>
        </div>

        <div className={styles.card}>
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${inputTab === 'upload' ? styles.tabActive : ''}`}
              onClick={() => setInputTab('upload')}
            >
              {t('Upload file')}
            </button>
            <button
              type="button"
              className={`${styles.tab} ${inputTab === 'paste' ? styles.tabActive : ''}`}
              onClick={() => setInputTab('paste')}
            >
              {t('Paste XML')}
            </button>
          </div>

          {inputTab === 'upload' ? (
            <FileDrop
              accept=".gpx,.kml,.xml,application/gpx+xml,application/vnd.google-earth.kml+xml"
              label={direction === 'gpx-to-kml' ? t('Choose or drag a GPX file') : t('Choose or drag a KML file')}
              hint={t('100% on device. No maps, tiles, or GPS location data leave your device.')}
              onFiles={handleFiles}
            />
          ) : (
            <Field
              label={direction === 'gpx-to-kml' ? t('GPX XML data') : t('KML XML data')}
              hint={t('Paste raw XML containing waypoints, routes, or tracks')}
            >
              <textarea
                className={styles.textarea}
                placeholder={
                  direction === 'gpx-to-kml'
                    ? '<gpx version="1.1">\n  <wpt lat="37.77" lon="-122.41"><name>Start</name></wpt>\n</gpx>'
                    : '<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document><Placemark><name>Start</name><Point><coordinates>-122.41,37.77,0</coordinates></Point></Placemark></Document>\n</kml>'
                }
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
            </Field>
          )}
        </div>

        {conversion.error && (
          <div className={styles.errorBanner}>
            <span>⚠️ {t(conversion.error)}</span>
          </div>
        )}

        {conversion.outputText && conversion.summary && (
          <div className={styles.summaryCard}>
            <div className={styles.summaryHeader}>
              <div className={styles.summaryTitle}>
                {t('Conversion summary')}
                <span className={styles.badge}>{outputFilename}</span>
              </div>
            </div>

            <div className={styles.statsGrid}>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>{t('Waypoints')}</span>
                <span className={styles.statValue}>{conversion.summary.waypointsCount}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>{t('Routes')}</span>
                <span className={styles.statValue}>{conversion.summary.routesCount}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>{t('Tracks')}</span>
                <span className={styles.statValue}>{conversion.summary.tracksCount}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>{t('Segments')}</span>
                <span className={styles.statValue}>{conversion.summary.segmentsCount}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>{t('Total points')}</span>
                <span className={styles.statValue}>{conversion.summary.totalPointsCount}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>{t('Elevation')}</span>
                <span className={styles.statValue}>{conversion.summary.hasElevations ? t('Yes') : t('No')}</span>
              </div>
            </div>

            {/* Unsupported loss disclosure */}
            <div className={styles.disclosureNotice}>
              <div className={styles.disclosureTitle}>{t('Data fidelity notice')}</div>
              <div>{t(conversion.summary.disclosure)}</div>
            </div>

            <pre className={styles.previewText} tabIndex={0} aria-label={t('Converted output preview')}>
              {conversion.outputText.slice(0, 1500)}...
            </pre>

            <div className={styles.actions}>
              <Button variant="primary" onClick={handleDownload}>
                {t('Download {file}', { file: outputFilename })}
              </Button>
              <Button variant="secondary" onClick={handleCopy}>
                {copied ? t('Copied to clipboard!') : t('Copy to clipboard')}
              </Button>
              <Button variant="secondary" onClick={handleReset}>
                {t('Clear')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
