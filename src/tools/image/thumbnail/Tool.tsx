import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { getToolMeta } from '../../registry';
import { IMAGE_ACCEPT } from '../../../lib/image';
import { FitToFrameEditor } from '../_layout/FitToFrameEditor';
import type { FrameConfig } from '../_layout/types';

const CONFIG: FrameConfig = {
  id: 'thumbnail',
  name: 'YouTube Thumbnail',
  width: 1280,
  height: 720,
  warnIfOverBytes: 2 * 1024 * 1024, // YouTube max thumbnail size is 2MB
  guides: [
    // YouTube displays video timestamp duration in the bottom right corner: roughly 110x35 px on desktop
    {
      type: 'box',
      label: 'Time badge area (bottom-right)',
      x: 1280 - 160,
      y: 720 - 70,
      width: 140,
      height: 50,
    },
  ],
};

export default function ThumbnailTool() {
  const meta = getToolMeta('img-thumbnail');
  const [file, setFile] = useState<File | null>(null);

  const handleFiles = (files: File[]) => {
    if (files.length > 0) setFile(files[0]);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-thumbnail">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label="Choose an image for your YouTube Thumbnail"
          hint="Supports JPG, PNG, WebP, HEIC and SVG. Exact 1280×720 16:9 standard export."
          onFiles={handleFiles}
        />
      ) : (
        <FitToFrameEditor
          config={CONFIG}
          file={file}
          onReset={() => setFile(null)}
          additionalInfo={
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              YouTube thumbnails must be 1280×720 and under 2 MB. Avoid putting critical text in the bottom right where YouTube places the video time badge.
            </div>
          }
        />
      )}
    </ToolPage>
  );
}
