import { useState } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { getToolMeta } from '../../registry';
import { IMAGE_ACCEPT } from '../../../lib/image';
import { FitToFrameEditor } from '../_layout/FitToFrameEditor';
import type { FrameConfig } from '../_layout/types';

const CONFIG: FrameConfig = {
  id: 'og-image',
  name: 'Open Graph Link Preview',
  width: 1200,
  height: 630,
};

export default function OgImageTool() {
  const meta = getToolMeta('img-og-image');
  const [file, setFile] = useState<File | null>(null);

  const handleFiles = (files: File[]) => {
    if (files.length > 0) setFile(files[0]);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-og-image">
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          label="Choose an image for your Open Graph Preview"
          hint="Supports JPG, PNG, WebP, HEIC and SVG. Exact 1200×630 (1.91:1) standard export."
          onFiles={handleFiles}
        />
      ) : (
        <FitToFrameEditor
          config={CONFIG}
          file={file}
          onReset={() => setFile(null)}
          additionalInfo={
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              1200×630 px is the universal recommended size for Open Graph (og:image) previews across Facebook, X / Twitter Large Cards, LinkedIn, Discord, and Slack.
            </div>
          }
        />
      )}
    </ToolPage>
  );
}
