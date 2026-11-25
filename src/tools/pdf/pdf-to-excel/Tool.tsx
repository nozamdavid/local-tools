import { useEffect, useId, useMemo, useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button, Field, Select } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { useI18n } from '../../../lib/i18n';
import { PasswordDialog } from '../../image/_pdf/PasswordDialog';
import { usePdfSource } from '../_thumbs/usePdfSource';
import { DownloadResult } from '../_layout/DownloadResult';
import { parseNumber } from '../_layout/tables';
import { analyzePdf, buildXlsx, toGrids, type PageBlocks, type SheetMode } from './buildXlsx';
import styles from './Tool.module.css';

const PREVIEW_GRIDS = 8;
const PREVIEW_ROWS = 12;

export default function PdfToExcelTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-pdf-to-excel');
  const source = usePdfSource();
  const job = useJob();
  const modeId = useId();

  const [mode, setMode] = useState<SheetMode>('per-page');
  const [includeText, setIncludeText] = useState(false);
  const [analysis, setAnalysis] = useState<PageBlocks[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const doc = source.doc;

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setAnalyzing(true);
    setAnalysis(null);
    setError(null);
    setAnalysisProgress(0);

    analyzePdf(doc, (ratio) => {
      if (!cancelled) setAnalysisProgress(ratio);
    })
      .then((pages) => {
        if (!cancelled) setAnalysis(pages);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to read the PDF.');
      })
      .finally(() => {
        if (!cancelled) setAnalyzing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [doc]);

  const grids = useMemo(() => (analysis ? toGrids(analysis, includeText) : []), [analysis, includeText]);
  const tableCount = useMemo(() => grids.filter((g) => g.kind === 'table').length, [grids]);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    setAnalysis(null);
    await source.open(files[0]);
  };

  const handleReset = () => {
    source.reset();
    job.reset();
    setAnalysis(null);
    setError(null);
  };

  const handleConvert = () => {
    job.run(async (setProgress) => {
      setProgress(0.3);
      const blob = await buildXlsx(grids, mode);
      setProgress(1);
      return blob;
    });
  };

  const file = source.file;
  const outName = file ? `${file.name.replace(/\.pdf$/i, '')}.xlsx` : 'tables.xlsx';
  const ready = analysis !== null && !analyzing;
  const modes = [
    { value: 'per-page', label: t('One sheet per page') },
    { value: 'combined', label: t('One combined sheet') },
  ];

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {source.password && <PasswordDialog reason={source.password.reason} onSubmit={source.password.submit} onCancel={handleReset} />}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label={t('Choose a PDF file or drag it here')}
          hint={t('Tables are detected from the text positions and become spreadsheet cells.')}
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {source.error && <div className="error-banner">{t(source.error)}</div>}
          {error && <div className="error-banner">{t(error)}</div>}
          {job.error && <div className="error-banner">{t(job.error)}</div>}

          <div className={styles.topRow}>
            <div className="meta-chips">
              <span className="meta-chip">
                {t('File:')} <strong>{file.name}</strong>
              </span>
              <span className="meta-chip">
                {t('Size:')} <strong>{formatBytes(file.size)}</strong>
              </span>
              {doc && (
                <span className="meta-chip">
                  {t('Pages:')} <strong>{source.pages.length}</strong>
                </span>
              )}
              {ready && (
                <span className="meta-chip">
                  {t('Tables found:')} <strong>{tableCount}</strong>
                </span>
              )}
            </div>
            <Button variant="secondary" onClick={handleReset}>
              {t('Change PDF')}
            </Button>
          </div>

          {source.loading && <p className={styles.status}>{t('Opening PDF document…')}</p>}
          {analyzing && <ProgressBar value={analysisProgress} label={t('Looking for tables…')} />}

          {job.result ? (
            <DownloadResult
              blob={job.result}
              filename={outName}
              summary={t('{count} {unit} written to {target}.', {
                count: tableCount,
                unit: tableCount === 1 ? t('table') : t('tables'),
                target: mode === 'combined' ? t('one sheet') : t('one sheet per page'),
              })}
              onReset={handleReset}
            />
          ) : (
            ready && (
              <>
                <div className={styles.controls}>
                  <Field label={t('Sheets')}>
                    <Select id={modeId} value={mode} onChange={(e) => setMode(e.target.value as SheetMode)} options={modes} />
                  </Field>
                  <details className="tool-options">
                    <summary>{t('Export options')}</summary>
                    <div className="tool-options-body">
                      <label className={styles.check}>
                        <input type="checkbox" checked={includeText} onChange={(e) => setIncludeText(e.target.checked)} />
                        <span>{t('Include text outside tables')}</span>
                      </label>
                    </div>
                  </details>
                </div>

                {grids.length === 0 ? (
                  <p className={styles.status}>
                    {t('No tables found. Turn on “Include text outside tables” to export the page text instead.')}
                  </p>
                ) : (
                  <div className={styles.previews} aria-label={t('Preview')}>
                    {grids.slice(0, PREVIEW_GRIDS).map((grid, index) => (
                      <figure key={index} className={styles.preview} data-kind={grid.kind}>
                        <figcaption>
                          {t('Page {number} · {kind} · {count} rows', {
                            number: grid.page,
                            kind: grid.kind === 'table' ? t('Table') : t('Text'),
                            count: grid.rows.length,
                          })}
                        </figcaption>
                        <div className={styles.scroll}>
                          <table className={styles.table}>
                            <tbody>
                              {grid.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                                <tr key={r}>
                                  {row.map((cell, c) => (
                                    <td
                                      key={c}
                                      className={grid.kind === 'table' && parseNumber(cell.text) ? styles.num : undefined}
                                      style={cell.bold ? { fontWeight: 700 } : undefined}
                                    >
                                      {cell.text}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {grid.rows.length > PREVIEW_ROWS && (
                          <p className={styles.more}>{t('+ {count} more rows', { count: grid.rows.length - PREVIEW_ROWS })}</p>
                        )}
                      </figure>
                    ))}
                    {grids.length > PREVIEW_GRIDS && (
                      <p className={styles.more}>{t('+ {count} more not shown in the preview', { count: grids.length - PREVIEW_GRIDS })}</p>
                    )}
                  </div>
                )}

                {job.status === 'running' ? (
                  <ProgressBar value={job.progress} label={t('Writing spreadsheet…')} />
                ) : (
                  <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
                    <Button variant="primary" onClick={handleConvert} disabled={grids.length === 0}>
                      {t('Convert to XLSX')}
                    </Button>
                  </div>
                )}
              </>
            )
          )}
        </div>
      )}
    </ToolPage>
  );
}
