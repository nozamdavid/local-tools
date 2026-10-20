import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { getToolMeta } from '../../registry';
import { useJob } from '../../../lib/useJob';
import { ConvertPanel, FileChips } from '../_render/ConvertPanel';
import { PageSetupFields } from '../_render/PageSetupFields';
import { DEFAULT_PAGE_SETUP, pdfFileName, type PageSetup } from '../_render/render';
import { checkXlsx, excelToPdf } from './convert';
import styles from './Tool.module.css';

export default function ExcelToPdfTool() {
  const meta = getToolMeta('pdf-excel-to-pdf');
  const job = useJob();

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [pages, setPages] = useState<number>();
  const [setup, setSetup] = useState<PageSetup>({
    ...DEFAULT_PAGE_SETUP,
    orientation: 'landscape',
    marginMm: 10,
  });

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    setPages(undefined);

    const problem = await checkXlsx(files[0]);
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
      const out = await excelToPdf(file, setup, setProgress);
      setPages(out.pages);
      return out.blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {!file ? (
        <>
          <FileDrop
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            label="Choose an XLSX file or drag it here"
            hint="Converted in your browser. Legacy .xls files are not supported."
            onFiles={handleFiles}
          />
          {fileError && <div className="error-banner">{fileError}</div>}
        </>
      ) : (
        <ConvertPanel
          chips={<FileChips file={file} />}
          job={job}
          pageCount={pages}
          outName={pdfFileName(file, 'spreadsheet.pdf')}
          sourceSize={file.size}
          actionLabel="Convert to PDF"
          actionDisabled={!!fileError}
          progressLabel="Rendering spreadsheet…"
          changeLabel="Change file"
          loadError={fileError}
          onConvert={handleConvert}
          onReset={handleReset}
        >
          <PageSetupFields value={setup} onChange={setSetup} />
          <p className={styles.note}>
            Each worksheet is converted to PDF pages with its cell data and formatting. Wide tables
            are scaled to fit the page width. Embedded charts, macros, and floating drawings are not
            rendered.
          </p>
        </ConvertPanel>
      )}
    </ToolPage>
  );
}
