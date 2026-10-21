import { useState, useMemo } from 'react';
import { ToolPage } from '../../components/ToolPage';
import { FileDrop } from '../../components/FileDrop';
import { Button, Field } from '../../components/Controls';
import { getToolMeta } from '../registry';
import { downloadBlob } from '../../lib/download';
import { peekPendingFiles } from '../../lib/handoff';
import { classifyFile } from '../../lib/toolInputs';
import { gpxToGeoData, kmlToGeoData, geoDataToGpx, geoDataToKml, getGeoSummary } from './gpxKml';
import styles from './Tool.module.css';

export default function GpxKmlTool() {
  const meta = getToolMeta('gpx-kml');
  const title = meta.title !== 'gpx-kml' ? meta.title : 'GPX ↔ KML Converter';
  const description =
    meta.description ||
    'Convert GPS tracks, routes, and waypoints between GPX and KML while preserving multi-segment boundaries and elevations.';

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
  }, [inputText, direction]);

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
      await navigator.clipboard.writeText(conversion.outputText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
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
              Upload file
            </button>
            <button
              type="button"
              className={`${styles.tab} ${inputTab === 'paste' ? styles.tabActive : ''}`}
              onClick={() => setInputTab('paste')}
            >
              Paste XML
            </button>
          </div>

          {inputTab === 'upload' ? (
            <FileDrop
              accept=".gpx,.kml,.xml,application/gpx+xml,application/vnd.google-earth.kml+xml"
              label={direction === 'gpx-to-kml' ? 'Choose or drag a GPX file' : 'Choose or drag a KML file'}
              hint="100% on-device. No maps, tiles, or GPS location data leave your device."
              onFiles={handleFiles}
            />
          ) : (
            <Field
              label={direction === 'gpx-to-kml' ? 'GPX XML Data' : 'KML XML Data'}
              hint="Paste raw XML containing waypoints, routes, or tracks"
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
            <span>⚠️ {conversion.error}</span>
          </div>
        )}

        {conversion.outputText && conversion.summary && (
          <div className={styles.summaryCard}>
            <div className={styles.summaryHeader}>
              <div className={styles.summaryTitle}>
                Conversion Summary
                <span className={styles.badge}>{outputFilename}</span>
              </div>
            </div>

            <div className={styles.statsGrid}>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Waypoints</span>
                <span className={styles.statValue}>{conversion.summary.waypointsCount}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Routes</span>
                <span className={styles.statValue}>{conversion.summary.routesCount}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Tracks</span>
                <span className={styles.statValue}>{conversion.summary.tracksCount}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Segments</span>
                <span className={styles.statValue}>{conversion.summary.segmentsCount}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Total Points</span>
                <span className={styles.statValue}>{conversion.summary.totalPointsCount}</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statLabel}>Elevation</span>
                <span className={styles.statValue}>{conversion.summary.hasElevations ? 'Yes' : 'No'}</span>
              </div>
            </div>

            {/* Unsupported loss disclosure */}
            <div className={styles.disclosureNotice}>
              <div className={styles.disclosureTitle}>Data Fidelity Notice</div>
              <div>{conversion.summary.disclosure}</div>
            </div>

            <pre className={styles.previewText} tabIndex={0} aria-label="Converted output preview">
              {conversion.outputText.slice(0, 1500)}...
            </pre>

            <div className={styles.actions}>
              <Button variant="primary" onClick={handleDownload}>
                Download {outputFilename}
              </Button>
              <Button variant="secondary" onClick={handleCopy}>
                {copied ? 'Copied to clipboard!' : 'Copy to clipboard'}
              </Button>
              <Button variant="secondary" onClick={handleReset}>
                Clear
              </Button>
            </div>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
