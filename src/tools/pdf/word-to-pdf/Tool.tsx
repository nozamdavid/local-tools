import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { getToolMeta } from '../../registry';
import { useJob } from '../../../lib/useJob';
import { ConvertPanel, FileChips } from '../_render/ConvertPanel';
import { PageSetupFields } from '../_render/PageSetupFields';
import { DEFAULT_PAGE_SETUP, pdfFileName, type PageSetup } from '../_render/render';
import { checkDocx, wordToPdf } from './convert';
import styles from './Tool.module.css';
import { useI18n } from '../../../lib/i18n';

export default function WordToPdfTool() {
  const { t } = useI18n();
  const meta = getToolMeta('pdf-word-to-pdf');
  const job = useJob();

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string>();
  const [pages, setPages] = useState<number>();
  const [setup, setSetup] = useState<PageSetup>({ ...DEFAULT_PAGE_SETUP, size: 'match' });

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    job.reset();
    setPages(undefined);

    const problem = await checkDocx(files[0]);
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
      const out = await wordToPdf(file, setup, setProgress);
      setPages(out.pages);
      return out.blob;
    });
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId={meta.id}>
      {!file ? (
        <>
          <FileDrop
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            label={t('Choose a DOCX file or drag it here')}
            hint={t("DOCX only; legacy DOC files aren't supported.")}
            onFiles={handleFiles}
          />
          {fileError && <div className="error-banner">{t(fileError)}</div>}
        </>
      ) : (
        <ConvertPanel
          chips={<FileChips file={file} />}
          job={job}
          pageCount={pages}
          outName={pdfFileName(file, 'document.pdf')}
          sourceSize={file.size}
          actionLabel={t('Convert to PDF')}
          actionDisabled={!!fileError}
          progressLabel={t('Rendering pages…')}
          changeLabel={t('Change file')}
          loadError={fileError}
          onConvert={handleConvert}
          onReset={handleReset}
        >
          <PageSetupFields value={setup} onChange={setSetup} allowMatch showOrientation={false} showMargin={false} />
          <p className={styles.note}>
            {t(
              'Each page of the document becomes one PDF page. The result is rendered from the DOCX layout in your browser, so text is stored as an image and fonts may differ from Word.',
            )}
          </p>
        </ConvertPanel>
      )}
    </ToolPage>
  );
}
