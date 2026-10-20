import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { Button, Field, Select, Slider } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import { useJob } from '../../../lib/useJob';
import { PdfPreview } from '../../image/_pdf/PdfPreview';
import { loadPdfDocument } from '../../image/_pdf/pdfRenderer';
import { baseName } from '../_pages/pdfPages';
import { QpdfError, runQpdf } from '../_qpdf/qpdf';
import { rasterizePdf } from '../_qpdf/rasterize';
import styles from './Tool.module.css';

type Level = 'lossless' | 'strong';

const LEVELS = [
  { value: 'lossless', label: 'Lossless: keep text and images, repack the file' },
  { value: 'strong', label: 'Strong: render pages as images' },
];

const LOSSLESS_ARGS = [
  '--object-streams=generate',
  '--compress-streams=y',
  '--recompress-flate',
  '--compression-level=9',
];

const LOCKED_MESSAGE = 'This PDF is password protected. Remove the password with the Unlock PDF tool first.';

export default function CompressPdfTool() {
  const meta = getToolMeta('pdf-compress');
  const [file, setFile] = useState<File | null>(null);
  const [level, setLevel] = useState<Level>('lossless');
  const [dpi, setDpi] = useState(110);
  const [quality, setQuality] = useState(60);
  const [outPages, setOutPages] = useState<number | undefined>(undefined);
  const job = useJob();

  const reset = () => {
    setFile(null);
    setOutPages(undefined);
    job.reset();
  };

  const run = () => {
    if (!file) return;
    const source = file;

    job.run(async (setProgress) => {
      setOutPages(undefined);
      setProgress(0.05);

      if (level === 'lossless') {
        const input = new Uint8Array(await source.arrayBuffer());
        setProgress(0.2);
        try {
          const output = await runQpdf(input, LOSSLESS_ARGS);
          return new Blob([output as BlobPart], { type: 'application/pdf' });
        } catch (err) {
          if (err instanceof QpdfError) throw new Error(err.badPassword ? LOCKED_MESSAGE : `Could not compress this PDF: ${err.message}`);
          throw err;
        }
      }

      let doc;
      try {
        doc = await loadPdfDocument(source);
      } catch (err) {
        if (err instanceof Error && err.name === 'PasswordException') throw new Error(LOCKED_MESSAGE);
        throw new Error(`Could not read this PDF: ${err instanceof Error ? err.message : 'the file may be damaged.'}`);
      }

      try {
        const output = await rasterizePdf(doc, {
          dpi,
          quality: quality / 100,
          onProgress: (ratio) => setProgress(0.05 + ratio * 0.9),
        });
        setOutPages(doc.numPages);
        return new Blob([output as BlobPart], { type: 'application/pdf' });
      } finally {
        void doc.loadingTask.destroy();
      }
    });
  };

  const result = job.status === 'done' ? job.result : undefined;
  const larger = result !== undefined && file !== null && result.size >= file.size;

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="pdf-compress">
      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          label="Choose a PDF file or drag it here"
          hint="Your PDF stays in this browser tab. Nothing is uploaded."
          onFiles={(files) => setFile(files[0] ?? null)}
        />
      ) : result ? (
        <div>
          <div className="meta-chips">
            <span className="meta-chip">
              Before: <strong>{formatBytes(file.size)}</strong>
            </span>
            <span className="meta-chip">
              After: <strong>{formatBytes(result.size)}</strong>
            </span>
          </div>

          {larger && (
            <div className="error-banner" role="status">
              The compressed file is {result.size === file.size ? 'the same size as' : 'larger than'} the original (
              {formatBytes(result.size)} vs {formatBytes(file.size)}). This PDF is already well compressed.
              <div className={styles.inlineAction}>
                <Button variant="secondary" onClick={() => downloadBlob(file, file.name)}>
                  Download the original instead
                </Button>
              </div>
            </div>
          )}

          <PdfPreview
            blob={result}
            filename={`${baseName(file.name)}-compressed.pdf`}
            pageCount={outPages}
            originalSize={file.size}
            onReset={reset}
          />
        </div>
      ) : (
        <div>
          {job.error && <div className="error-banner">{job.error}</div>}

          <div className="meta-chips">
            <span className="meta-chip" title={file.name}>
              File: <strong>{file.name}</strong>
            </span>
            <span className="meta-chip">
              Size: <strong>{formatBytes(file.size)}</strong>
            </span>
          </div>

          <Field label="Compression level">
            <Select
              value={level}
              disabled={job.status === 'running'}
              onChange={(e) => setLevel(e.target.value as Level)}
              options={LEVELS}
            />
          </Field>

          {level === 'lossless' ? (
            <p className="field-hint">
              Repacks the file structure and recompresses its streams at the highest level. Text stays selectable.
              Savings are usually small unless the file was saved inefficiently.
            </p>
          ) : (
            <>
              <div className="error-banner" role="note">
                Strong compression turns every page into a picture. Text can no longer be selected, searched or copied,
                and links and form fields are lost.
              </div>
              <Field label="Resolution" hint="Lower values give smaller files. 110 DPI suits reading on screen.">
                <Slider value={dpi} min={72} max={200} step={2} unit=" DPI" disabled={job.status === 'running'} onChange={setDpi} />
              </Field>
              <Field label="Image quality" hint="JPEG quality for each page image.">
                <Slider value={quality} min={20} max={95} step={5} unit="%" disabled={job.status === 'running'} onChange={setQuality} />
              </Field>
            </>
          )}

          {job.status === 'running' ? (
            <ProgressBar value={job.progress} label="Compressing…" />
          ) : (
            <div className="action-buttons" style={{ marginTop: '1.5rem' }}>
              <Button variant="secondary" onClick={reset}>
                Choose a different file
              </Button>
              <Button variant="primary" onClick={run}>
                Compress PDF
              </Button>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
