import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { useJob } from '../../../lib/useJob';
import { ConvertPanel } from '../_render/ConvertPanel';
import { PageSetupFields } from '../_render/PageSetupFields';
import { DEFAULT_PAGE_SETUP, type PageSetup } from '../_render/render';
import { checkHtml, htmlToPdf, sanitizeHtml, withDoctype } from './convert';
import styles from './Tool.module.css';

interface Source {
  name: string;
  html: string;
}

function Notice() {
  return (
    <p className={styles.notice}>
      Web addresses cannot be fetched: files stay on your device, so there are no network requests. Open the page, save it as an .html file,
      and drop it here. Images embedded as data: URIs show up. Linked or remote images and stylesheets will not load. Scripts are not run.
    </p>
  );
}

export default function HtmlToPdfTool() {
  const meta = getToolMeta('pdf-html-to-pdf');
  const job = useJob();

  const [source, setSource] = useState<Source | null>(null);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string>();
  const [pages, setPages] = useState<number>();
  const [setup, setSetup] = useState<PageSetup>(DEFAULT_PAGE_SETUP);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    setPages(undefined);

    try {
      const html = await files[0].text();
      const problem = checkHtml(html);
      if (problem) throw new Error(problem);
      setError(undefined);
      setSource({ name: files[0].name.replace(/\.[^.]+$/, '') || 'document', html });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUsePasted = () => {
    const problem = checkHtml(pasted);
    if (problem) {
      setError(problem);
      return;
    }
    job.reset();
    setPages(undefined);
    setError(undefined);
    setSource({ name: 'pasted-html', html: pasted });
  };

  const handleReset = () => {
    setSource(null);
    setError(undefined);
    setPages(undefined);
    job.reset();
  };

  const handleConvert = () => {
    if (!source) return;
    job.run(async (setProgress) => {
      const out = await htmlToPdf(source.html, setup, setProgress);
      setPages(out.pages);
      return out.blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {!source ? (
        <>
          <FileDrop
            accept=".html,.htm,text/html"
            label="Choose an HTML file or drag it here"
            hint="Rendered in your browser. Nothing is uploaded."
            onFiles={handleFiles}
          />

          <div className={styles.paste}>
            <label className="field-label" htmlFor="html-to-pdf-paste">
              Or paste HTML
            </label>
            <textarea
              id="html-to-pdf-paste"
              className={styles.textarea}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="<h1>Hello</h1><p>Paste your HTML here…</p>"
              spellCheck={false}
            />
            <div>
              <Button variant="secondary" onClick={handleUsePasted}>
                Use pasted HTML
              </Button>
            </div>
          </div>

          {error && <div className="error-banner">{error}</div>}
          <Notice />
        </>
      ) : (
        <ConvertPanel
          chips={
            <>
              <span className="meta-chip">
                Source: <strong>{source.name}</strong>
              </span>
              <span className="meta-chip">
                Size: <strong>{formatBytes(new Blob([source.html]).size)}</strong>
              </span>
            </>
          }
          job={job}
          pageCount={pages}
          outName={`${source.name}.pdf`}
          actionLabel="Convert to PDF"
          progressLabel="Rendering pages…"
          changeLabel="Change HTML"
          onConvert={handleConvert}
          onReset={handleReset}
          preview={
            <div className={styles.previewWrap}>
              <div className="preview-box-title">Preview</div>
              <iframe className={styles.preview} title="HTML preview" sandbox="" srcDoc={withDoctype(sanitizeHtml(source.html))} />
            </div>
          }
        >
          <PageSetupFields value={setup} onChange={setSetup} />
          <Notice />
        </ConvertPanel>
      )}
    </ToolPage>
  );
}
