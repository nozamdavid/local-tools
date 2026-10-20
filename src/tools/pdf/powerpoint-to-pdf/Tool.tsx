import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { getToolMeta } from '../../registry';
import { useJob } from '../../../lib/useJob';
import { ConvertPanel, FileChips } from '../_render/ConvertPanel';
import { PageSetupFields } from '../_render/PageSetupFields';
import { DEFAULT_PAGE_SETUP, pdfFileName, type PageSetup } from '../_render/render';
import { checkPptx, powerpointToPdf } from './convert';
import styles from './Tool.module.css';

export default function PowerpointToPdfTool() {
  const meta = getToolMeta('pdf-powerpoint-to-pdf');
  const job = useJob();

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [pages, setPages] = useState<number>();
  const [setup, setSetup] = useState<PageSetup>({
    ...DEFAULT_PAGE_SETUP,
    size: 'match',
    marginMm: 10,
  });

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    setPages(undefined);

    const problem = await checkPptx(files[0]);
    setFileError(problem ?? undefined);
    setFile(files[0]);
  };

  const handleReset = () => {
    setFile(null);
    setFileError(undefined);
    setPages(undefined);
    job.reset();
  };

  const handleConvert = () => {
    if (!file) return;
    job.run(async (setProgress) => {
      const out = await powerpointToPdf(file, setup, setProgress);
      setPages(out.pages);
      return out.blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {!file ? (
        <>
          <FileDrop
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            label="Choose a PPTX file or drag it here"
            hint="Converted in your browser. Legacy .ppt files are not supported."
            onFiles={handleFiles}
          />
          {fileError && <div className="error-banner">{fileError}</div>}
        </>
      ) : (
        <ConvertPanel
          chips={<FileChips file={file} />}
          job={job}
          pageCount={pages}
          outName={pdfFileName(file, 'presentation.pdf')}
          sourceSize={file.size}
          actionLabel="Convert to PDF"
          actionDisabled={!!fileError}
          progressLabel="Rendering slides…"
          changeLabel="Change file"
          loadError={fileError}
          onConvert={handleConvert}
          onReset={handleReset}
        >
          <PageSetupFields value={setup} onChange={setSetup} allowMatch showOrientation={false} />
          <p className={styles.note}>
            Each slide becomes one landscape page at the slide aspect ratio. Complex charts,
            SmartArt, animations and some effects may not render exactly as in PowerPoint.
          </p>
        </ConvertPanel>
      )}
    </ToolPage>
  );
}
