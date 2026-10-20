import { useState, useId } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { BatchResults, type BatchResultItem } from '../../../components/BatchResults';
import { Field, Select, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { loadPdfDocument, extractEmbeddedImagesOrPages } from '../_pdf/pdfRenderer';
import { PasswordDialog } from '../_pdf/PasswordDialog';

type ImageFormat = 'image/jpeg' | 'image/png';
type ExtractMode = 'embedded' | 'pages';

export default function ExtractPdfImagesTool() {
  const meta = getToolMeta('img-extract-pdf-images');
  const [file, setFile] = useState<File | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [format, setFormat] = useState<ImageFormat>('image/jpeg');
  const [mode, setMode] = useState<ExtractMode>('embedded');
  const [dpi, setDpi] = useState<number>(150);
  const [items, setItems] = useState<BatchResultItem[] | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  const [passwordState, setPasswordState] = useState<{
    isOpen: boolean;
    reason: number;
    verify?: (password: string) => void;
  } | null>(null);

  const [docLoading, setDocLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const job = useJob();
  const formatId = useId();
  const modeId = useId();
  const dpiId = useId();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const selected = files[0];
    setFile(selected);
    setPdfDoc(null);
    setItems(null);
    setFallbackNote(null);
    setLoadError(null);
    setDocLoading(true);
    job.reset();

    try {
      const doc = await loadPdfDocument(selected, {
        onPassword: (verify, reason) => {
          setPasswordState({ isOpen: true, reason, verify });
        },
      });

      setPdfDoc(doc);
      setPasswordState(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load PDF document.');
    } finally {
      setDocLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPdfDoc(null);
    setItems(null);
    setFallbackNote(null);
    setLoadError(null);
    setPasswordState(null);
    job.reset();
  };

  const handleExtract = () => {
    if (!pdfDoc || !file) return;

    job.run(async (setProgress) => {
      setFallbackNote(null);
      const res = await extractEmbeddedImagesOrPages(pdfDoc, file.name, {
        mode,
        format,
        dpi,
        onProgress: (cur, tot) => {
          setProgress(tot > 0 ? cur / tot : 0);
        },
      });

      if (res.usedFallback) {
        setFallbackNote(
          'No standalone raster images were found embedded in the PDF. Successfully rendered every page as an image instead.'
        );
      }

      setItems(res.items);
      return res.items[0]?.blob ?? new Blob([]);
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-extract-pdf-images">
      {passwordState?.isOpen && passwordState.verify && (
        <PasswordDialog
          reason={passwordState.reason}
          onSubmit={(pw) => {
            passwordState.verify!(pw);
          }}
          onCancel={handleReset}
        />
      )}

      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label="Choose a PDF file or drag it here"
          hint="Extract photos, illustrations and page renders into a ZIP archive. 100% on-device."
          onFiles={handleFiles}
        />
      ) : (
        <div>
          {loadError && <div className="error-banner">{loadError}</div>}
          {job.error && <div className="error-banner">{job.error}</div>}

          {items && items.length > 0 ? (
            <div>
              {fallbackNote && (
                <div
                  style={{
                    backgroundColor: 'var(--color-brand-light)',
                    border: '1px solid var(--color-brand)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.75rem 1rem',
                    marginBottom: '1rem',
                    fontSize: '0.9rem',
                  }}
                >
                  ℹ️ {fallbackNote}
                </div>
              )}
              <BatchResults items={items} onReset={handleReset} />
            </div>
          ) : (
            <div>
              <div className="meta-chips">
                <span className="meta-chip">
                  File: <strong>{file.name}</strong>
                </span>
                <span className="meta-chip">
                  Size: <strong>{formatBytes(file.size)}</strong>
                </span>
                {pdfDoc && (
                  <span className="meta-chip">
                    Pages: <strong>{pdfDoc.numPages}</strong>
                  </span>
                )}
              </div>

              {docLoading ? (
                <div style={{ margin: '2rem 0', textAlign: 'center' }}>
                  <p>Opening PDF document...</p>
                </div>
              ) : (
                pdfDoc && (
                  <div>
                    {job.status === 'running' ? (
                      <ProgressBar value={job.progress} label="Extracting images from PDF..." />
                    ) : (
                      <div style={{ marginTop: '1.5rem' }}>
                        <Field
                          label="Extraction mode"
                          hint="Embedded mode pulls photos and graphics directly from the document. Page render mode rasterizes each full page."
                        >
                          <Select
                            id={modeId}
                            value={mode}
                            onChange={(e) => setMode(e.target.value as ExtractMode)}
                            options={[
                              {
                                value: 'embedded',
                                label: 'Extract embedded photos & illustrations (recommended)',
                              },
                              {
                                value: 'pages',
                                label: 'Render all document pages as images',
                              },
                            ]}
                          />
                        </Field>

                        <Field label="Output image format" hint="JPG creates smaller files; PNG is lossless.">
                          <Select
                            id={formatId}
                            value={format}
                            onChange={(e) => setFormat(e.target.value as ImageFormat)}
                            options={[
                              { value: 'image/jpeg', label: 'JPG' },
                              { value: 'image/png', label: 'PNG' },
                            ]}
                          />
                        </Field>

                        {mode === 'pages' && (
                          <Field label="Page resolution / DPI" hint="Controls the sharpness of the rendered pages.">
                            <Select
                              id={dpiId}
                              value={String(dpi)}
                              onChange={(e) => setDpi(Number(e.target.value))}
                              options={[
                                { value: '72', label: '72 DPI (Standard screen)' },
                                { value: '150', label: '150 DPI (Balanced / Medium - recommended)' },
                                { value: '300', label: '300 DPI (High resolution / Print)' },
                              ]}
                            />
                          </Field>
                        )}

                        <div className="action-buttons" style={{ marginTop: '2rem' }}>
                          <Button variant="secondary" onClick={handleReset}>
                            Choose different file
                          </Button>
                          <Button variant="primary" onClick={handleExtract}>
                            Extract images (.zip)
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
