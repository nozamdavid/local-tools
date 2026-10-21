import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { getToolMeta } from '../../registry';
import { IMAGE_ACCEPT } from '../../../lib/image';
import { FitToFrameEditor } from '../_layout/FitToFrameEditor';
import type { FrameConfig } from '../_layout/types';

const CONFIG: FrameConfig = {
  id: 'instagram-profile',
  name: 'Instagram Profile Picture',
  width: 1080,
  height: 1080,
  isCirclePreview: true,
  allowCircularExport: true,
};

export default function InstagramProfileTool() {
  const meta = getToolMeta('img-instagram-profile');
  const [file, setFile] = useState<File | null>(null);

  const handleFiles = (files: File[]) => {
    if (files.length > 0) setFile(files[0]);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-instagram-profile">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label="Choose an image for your Instagram Profile Picture"
          hint="Supports JPG, PNG, WebP, HEIC and SVG. Circle preview with high-res 1080×1080 export."
          onFiles={handleFiles}
        />
      ) : (
        <FitToFrameEditor
          config={CONFIG}
          file={file}
          onReset={() => setFile(null)}
          additionalInfo={
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Instagram displays profile pictures as circles (320×320 on desktop), but stores them at 1080×1080. You can export a crisp
              1080×1080 square or a transparent circular PNG.
            </div>
          }
        />
      )}
    </ToolPage>
  );
}
