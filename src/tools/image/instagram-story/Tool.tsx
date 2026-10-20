import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { getToolMeta } from '../../registry';
import { IMAGE_ACCEPT } from '../../../lib/image';
import { FitToFrameEditor } from '../_layout/FitToFrameEditor';
import type { FrameConfig } from '../_layout/types';

const CONFIG: FrameConfig = {
  id: 'instagram-story',
  name: 'Instagram Story',
  width: 1080,
  height: 1920,
  guides: [
    { type: 'top', label: 'Top safe zone (header UI: 250px)', size: 250 },
    { type: 'bottom', label: 'Bottom safe zone (reply bar: 340px)', size: 340 },
  ],
};

export default function InstagramStoryTool() {
  const meta = getToolMeta('img-instagram-story');
  const [file, setFile] = useState<File | null>(null);

  const handleFiles = (files: File[]) => {
    if (files.length > 0) setFile(files[0]);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-instagram-story">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label="Choose an image for your Instagram Story"
          hint="Supports JPG, PNG, WebP, HEIC and SVG. Exact 1080×1920 export."
          onFiles={handleFiles}
        />
      ) : (
        <FitToFrameEditor
          config={CONFIG}
          file={file}
          onReset={() => setFile(null)}
          additionalInfo={
            <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
              Keep essential text, stickers, and faces inside the safe center area (between 250 px from top and 340 px from bottom) to avoid being hidden by Instagram&apos;s UI elements.
            </div>
          }
        />
      )}
    </ToolPage>
  );
}
