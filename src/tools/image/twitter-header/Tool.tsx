import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { getToolMeta } from '../../registry';
import { IMAGE_ACCEPT } from '../../../lib/image';
import { useI18n } from '../../../lib/i18n';
import { FitToFrameEditor } from '../_layout/FitToFrameEditor';
import type { FrameConfig } from '../_layout/types';

const CONFIG: FrameConfig = {
  id: 'twitter-header',
  name: 'Twitter / X Header',
  width: 1500,
  height: 500,
  guides: [
    {
      type: 'circle',
      label: 'Avatar overlap area',
      cx: 170,
      cy: 440,
      radius: 120,
    },
  ],
};

export default function TwitterHeaderTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-twitter-header');
  const [file, setFile] = useState<File | null>(null);

  const handleFiles = (files: File[]) => {
    if (files.length > 0) setFile(files[0]);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-twitter-header">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label={t('Choose an image for your Twitter / X Header')}
          hint={t('Supports JPG, PNG, WebP, HEIC and SVG. Exact 1500×500 3:1 banner.')}
          onFiles={handleFiles}
        />
      ) : (
        <FitToFrameEditor
          config={CONFIG}
          file={file}
          onReset={() => setFile(null)}
          additionalInfo={
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              {t(
                'Twitter / X headers are 1500×500 px. Notice the avatar overlap area on the bottom-left; keep vital imagery or logos away from this corner.',
              )}
            </div>
          }
        />
      )}
    </ToolPage>
  );
}
