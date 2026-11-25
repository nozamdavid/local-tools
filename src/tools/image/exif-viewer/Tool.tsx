import { useState } from 'react';
import exifr from 'exifr';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { useI18n } from '../../../lib/i18n';
import { copyText } from '../../../lib/clipboard';
import { downloadBlob } from '../../../lib/download';
import { formatBytes } from '../../../lib/format';
import styles from './Tool.module.css';

interface TagRow {
  key: string;
  label: string;
  value: string;
  sensitive?: boolean;
}

interface GroupedTags {
  camera: TagRow[];
  exposure: TagRow[];
  image: TagRow[];
  datetime: TagRow[];
  gps: TagRow[];
  other: TagRow[];
}

const CAMERA_KEYS = new Set([
  'make',
  'model',
  'software',
  'lensmake',
  'lensmodel',
  'lensinfo',
  'lensspecification',
  'lensserialnumber',
  'cameraownername',
  'ownername',
  'artist',
  'copyright',
  'bodyserialnumber',
  'serialnumber',
  'cameraserialnumber',
  'hostcomputer',
  'devicesettingdescription',
]);

const EXPOSURE_KEYS = new Set([
  'fnumber',
  'aperturevalue',
  'exposuretime',
  'shutterspeedvalue',
  'iso',
  'isospeedratings',
  'photographicsensitivity',
  'exposureprogram',
  'exposurebiasvalue',
  'meteringmode',
  'flash',
  'flashenergy',
  'focallength',
  'focallengthin35mmformat',
  'whitebalance',
  'digitalzoomratio',
  'scenecapturetype',
  'scenetype',
  'lightsource',
  'exposuremode',
  'contrast',
  'saturation',
  'sharpness',
]);

const IMAGE_KEYS = new Set([
  'imagewidth',
  'imageheight',
  'exifimagewidth',
  'exifimageheight',
  'orientation',
  'colorspace',
  'bitspersample',
  'samplesperpixel',
  'compression',
  'photometricinterpretation',
  'planarconfiguration',
  'xresolution',
  'yresolution',
  'resolutionunit',
  'filesource',
  'interoperabilityindex',
]);

const DATETIME_KEYS = new Set([
  'datetimeoriginal',
  'createdate',
  'modifydate',
  'datetimedigitized',
  'datetime',
  'offsettime',
  'offsettimeoriginal',
  'offsettimedigitized',
  'subsectime',
  'subsectimeoriginal',
  'subsectimedigitized',
]);

const GPS_KEYS = new Set([
  'latitude',
  'longitude',
  'altitude',
  'gpslatitude',
  'gpslongitude',
  'gpsaltitude',
  'gpslatituderef',
  'gpslongituderef',
  'gpsaltituderef',
  'gpsspeed',
  'gpsspeedref',
  'gpsdirection',
  'gpsdirectionref',
  'gpsdestbearing',
  'gpsdatestamp',
  'gpstimestamp',
  'gpsposition',
  'gpsstatus',
  'gpsmapdatum',
  'gpsimgdirection',
  'gpsprocessingmethod',
]);

function formatTagValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return value.toLocaleString();
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map((v) => String(v)).join(', ');
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function isPrivacySensitive(key: string): boolean {
  const lower = key.toLowerCase();
  if (GPS_KEYS.has(lower) || lower.startsWith('gps')) return true;
  if (/serial|owner|artist|copyright|author|creator|name/i.test(lower)) return true;
  return false;
}

export default function ExifViewerTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-exif-viewer');

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [rawExif, setRawExif] = useState<Record<string, unknown> | null>(null);
  const [grouped, setGrouped] = useState<GroupedTags | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setError(null);
    setLoading(true);
    setRawExif(null);
    setGrouped(null);
    setThumbnailUrl(null);
    setCoords(null);

    try {
      // Parse full metadata
      const parsed = await exifr.parse(selected, {
        tiff: true,
        xmp: true,
        icc: true,
        jfif: true,
        iptc: true,
        gps: true,
        mergeOutput: true,
      });

      if (!parsed || Object.keys(parsed).length === 0) {
        setError(t('No EXIF or metadata tags were found in this file.'));
        setLoading(false);
        return;
      }

      setRawExif(parsed);

      // Extract GPS coordinates if present
      if (typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
        setCoords({ lat: parsed.latitude, lon: parsed.longitude });
      }

      // Try thumbnail extraction
      try {
        const thumbUrl = await exifr.thumbnailUrl(selected);
        if (thumbUrl) {
          setThumbnailUrl(thumbUrl);
        }
      } catch {
        // Thumbnail extraction failed or absent
      }

      // Group tags
      const groups: GroupedTags = {
        camera: [],
        exposure: [],
        image: [],
        datetime: [],
        gps: [],
        other: [],
      };

      for (const [key, val] of Object.entries(parsed)) {
        const lower = key.toLowerCase();
        const row: TagRow = {
          key,
          label: key.replace(/([A-Z])/g, ' $1').trim(),
          value: formatTagValue(val),
          sensitive: isPrivacySensitive(key),
        };

        if (CAMERA_KEYS.has(lower)) {
          groups.camera.push(row);
        } else if (EXPOSURE_KEYS.has(lower)) {
          groups.exposure.push(row);
        } else if (IMAGE_KEYS.has(lower)) {
          groups.image.push(row);
        } else if (DATETIME_KEYS.has(lower)) {
          groups.datetime.push(row);
        } else if (GPS_KEYS.has(lower) || lower.startsWith('gps')) {
          groups.gps.push(row);
        } else {
          groups.other.push(row);
        }
      }

      setGrouped(groups);
    } catch (err) {
      setError(err instanceof Error ? t(err.message) : t('Failed to parse EXIF metadata'));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (thumbnailUrl) {
      URL.revokeObjectURL(thumbnailUrl);
    }
    setFile(null);
    setRawExif(null);
    setGrouped(null);
    setThumbnailUrl(null);
    setCoords(null);
    setError(null);
  };

  const copyJson = async () => {
    if (!rawExif) return;
    try {
      await copyText(JSON.stringify(rawExif, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      alert(t('Could not copy to clipboard.'));
    }
  };

  const downloadJson = () => {
    if (!rawExif || !file) return;
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const jsonBlob = new Blob([JSON.stringify(rawExif, null, 2)], {
      type: 'application/json',
    });
    downloadBlob(jsonBlob, `${baseName}-metadata.json`);
  };

  const hasSensitiveData =
    grouped && (grouped.gps.length > 0 || grouped.camera.some((r) => r.sensitive) || grouped.other.some((r) => r.sensitive));

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-exif-viewer">
      <div className={styles.container}>
        <div className={styles.topBar}>
          <div className="meta-chips">
            {file && (
              <>
                <span className="meta-chip">
                  {t('File')}: <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  {t('Size')}: <strong>{formatBytes(file.size)}</strong>
                </span>
              </>
            )}
          </div>
          {file && (
            <div className={styles.actionsRow}>
              <Button variant="secondary" onClick={handleReset}>
                {t('Choose different file')}
              </Button>
              <Button variant="secondary" onClick={copyJson} disabled={!rawExif}>
                {copied ? t('Copied!') : t('Copy as JSON')}
              </Button>
              <Button variant="primary" onClick={downloadJson} disabled={!rawExif}>
                {t('Download JSON')}
              </Button>
            </div>
          )}
        </div>

        {error && <div className="error-banner">{t(error)}</div>}
        {loading && <div style={{ textAlign: 'center', padding: '2rem' }}>{t('Reading metadata…')}</div>}

        {!file ? (
          <FileDrop
            accept="image/jpeg,image/heic,image/heif,image/png,image/webp,image/tiff,.jpg,.jpeg,.heic,.heif,.png,.webp,.tiff,.tif"
            label={t('Drop a photo here to inspect its EXIF data')}
            hint={t('Supports JPG, HEIC, PNG, WEBP, TIFF.')}
            onFiles={handleFiles}
          />
        ) : (
          grouped && (
            <>
              {hasSensitiveData && (
                <div className={styles.privacyBanner}>
                  <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                  <div>
                    <strong>{t('Privacy warning:')}</strong>{' '}
                    {t(
                      'This photo contains privacy-sensitive information such as GPS location or device serial numbers. Anyone with this original file can view these details.',
                    )}
                  </div>
                </div>
              )}

              {thumbnailUrl && (
                <div className={styles.thumbnailCard}>
                  <img src={thumbnailUrl} alt={t('Embedded EXIF thumbnail')} className={styles.thumbImg} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: '0.25rem' }}>{t('Embedded EXIF thumbnail')}</strong>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {t('A low-resolution preview image stored directly inside the metadata header.')}
                    </span>
                  </div>
                </div>
              )}

              <div className={styles.groupsContainer}>
                {/* GPS */}
                {grouped.gps.length > 0 && (
                  <div className={styles.groupCard}>
                    <div className={styles.groupHeader}>
                      <span>{t('📍 GPS & location')}</span>
                      <span className={styles.groupBadge}>{t('{count} tags', { count: grouped.gps.length })}</span>
                    </div>
                    {coords && (
                      <div style={{ padding: '0.75rem 1.25rem', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                          {t('Decimal coordinates')}: {coords.lat.toFixed(6)}, {coords.lon.toFixed(6)}
                        </div>
                        <a
                          href={`https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lon}#map=16/${coords.lat}/${coords.lon}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.outboundLink}
                        >
                          {t('View coordinates on OpenStreetMap')} ↗
                        </a>
                      </div>
                    )}
                    <div className={styles.tableWrapper}>
                      <table className={styles.table}>
                        <tbody>
                          {grouped.gps.map((row) => (
                            <tr key={row.key} className={styles.sensitiveRow}>
                              <th>
                                {row.label}
                                <span className={styles.sensitiveTag}>{t('Sensitive')}</span>
                              </th>
                              <td>{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Camera */}
                {grouped.camera.length > 0 && (
                  <div className={styles.groupCard}>
                    <div className={styles.groupHeader}>
                      <span>{t('📷 Camera & lens')}</span>
                      <span className={styles.groupBadge}>{t('{count} tags', { count: grouped.camera.length })}</span>
                    </div>
                    <div className={styles.tableWrapper}>
                      <table className={styles.table}>
                        <tbody>
                          {grouped.camera.map((row) => (
                            <tr key={row.key} className={row.sensitive ? styles.sensitiveRow : undefined}>
                              <th>
                                {row.label}
                                {row.sensitive && <span className={styles.sensitiveTag}>{t('Sensitive')}</span>}
                              </th>
                              <td>{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Exposure */}
                {grouped.exposure.length > 0 && (
                  <div className={styles.groupCard}>
                    <div className={styles.groupHeader}>
                      <span>{t('⏱️ Exposure & shutter')}</span>
                      <span className={styles.groupBadge}>{t('{count} tags', { count: grouped.exposure.length })}</span>
                    </div>
                    <div className={styles.tableWrapper}>
                      <table className={styles.table}>
                        <tbody>
                          {grouped.exposure.map((row) => (
                            <tr key={row.key}>
                              <th>{row.label}</th>
                              <td>{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Image */}
                {grouped.image.length > 0 && (
                  <div className={styles.groupCard}>
                    <div className={styles.groupHeader}>
                      <span>{t('🖼️ Image characteristics')}</span>
                      <span className={styles.groupBadge}>{t('{count} tags', { count: grouped.image.length })}</span>
                    </div>
                    <div className={styles.tableWrapper}>
                      <table className={styles.table}>
                        <tbody>
                          {grouped.image.map((row) => (
                            <tr key={row.key}>
                              <th>{row.label}</th>
                              <td>{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Date/Time */}
                {grouped.datetime.length > 0 && (
                  <div className={styles.groupCard}>
                    <div className={styles.groupHeader}>
                      <span>{t('📅 Date & time')}</span>
                      <span className={styles.groupBadge}>{t('{count} tags', { count: grouped.datetime.length })}</span>
                    </div>
                    <div className={styles.tableWrapper}>
                      <table className={styles.table}>
                        <tbody>
                          {grouped.datetime.map((row) => (
                            <tr key={row.key}>
                              <th>{row.label}</th>
                              <td>{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Other */}
                {grouped.other.length > 0 && (
                  <div className={styles.groupCard}>
                    <div className={styles.groupHeader}>
                      <span>{t('⚙️ Other metadata')}</span>
                      <span className={styles.groupBadge}>{t('{count} tags', { count: grouped.other.length })}</span>
                    </div>
                    <div className={styles.tableWrapper}>
                      <table className={styles.table}>
                        <tbody>
                          {grouped.other.map((row) => (
                            <tr key={row.key} className={row.sensitive ? styles.sensitiveRow : undefined}>
                              <th>
                                {row.label}
                                {row.sensitive && <span className={styles.sensitiveTag}>{t('Sensitive')}</span>}
                              </th>
                              <td>{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </>
          )
        )}
      </div>
    </ToolPage>
  );
}
