import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { getToolMeta } from '../../registry';
import { IMAGE_ACCEPT } from '../../../lib/image';
import { FitToFrameEditor } from '../_layout/FitToFrameEditor';
import type { FrameConfig } from '../_layout/types';

const CONFIG: FrameConfig = {
  id: 'linkedin-banner',
  name: 'LinkedIn Banner',
  width: 1584,
  height: 396,
  guides: [
    {
      type: 'circle',
      label: 'Profile picture overlap area',
      cx: 190,
      cy: 396,
      radius: 125,
    },
  ],
};

export default function LinkedInBannerTool() {
  const meta = getToolMeta('img-linkedin-banner');
  const [file, setFile] = useState<File | null>(null);

  const handleFiles = (files: File[]) => {
    if (files.length > 0) setFile(files[0]);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-linkedin-banner">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label="Choose an image for your LinkedIn Banner"
          hint="Supports JPG, PNG, WebP, HEIC and SVG. Exact 1584×396 4:1 banner."
          onFiles={handleFiles}
        />
      ) : (
        <FitToFrameEditor
          config={CONFIG}
          file={file}
          onReset={() => setFile(null)}
          additionalInfo={
            <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
              LinkedIn profile banners are 1584×396 px (4:1 aspect ratio). The lower-left corner is covered by your round profile picture on desktop browsers.
            </div>
          }
        />
      )}
    </ToolPage>
  );
}
