import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { getToolMeta } from '../../registry';
import { IMAGE_ACCEPT } from '../../../lib/image';
import { useI18n } from '../../../lib/i18n';
import { FitToFrameEditor } from '../_layout/FitToFrameEditor';
import type { FrameConfig } from '../_layout/types';

const CONFIG: FrameConfig = {
  id: 'facebook-cover',
  name: 'Facebook Cover Photo',
  width: 820,
  height: 312,
  guides: [
    {
      type: 'box',
      label: 'Mobile safe area (640px center)',
      x: 90,
      y: 0,
      width: 640,
      height: 312,
    },
  ],
};

export default function FacebookCoverTool() {
  const { t } = useI18n();
  const meta = getToolMeta('img-facebook-cover');
  const [file, setFile] = useState<File | null>(null);

  const handleFiles = (files: File[]) => {
    if (files.length > 0) setFile(files[0]);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-facebook-cover">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label={t('Choose an image for your Facebook Cover Photo')}
          hint={t('Supports JPG, PNG, WebP, HEIC and SVG. Exact 820×312 export.')}
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
                'Facebook displays cover photos at 820×312 px on computers. On smartphones, Facebook displays a centered 640×360 crop, clipping the left and right ~90 px. Center your text and subjects inside the 640 px mobile safe zone.',
              )}
            </div>
          }
        />
      )}
    </ToolPage>
  );
}
