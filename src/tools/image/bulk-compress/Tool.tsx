import { useState, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { ProgressBar } from '../../../components/ProgressBar';
import { BatchResults, type BatchResultItem } from '../../../components/BatchResults';
import { Field, Select, Slider, Button } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { IMAGE_ACCEPT, type EncodableMime } from '../../../lib/image';
import { formatBytes } from '../../../lib/format';
import { compressImage } from '../_basic';

type MaxDimensionOption = 'original' | '1920' | '1280' | '1080' | '800';
type FormatOption = 'auto' | 'image/jpeg' | 'image/webp';

export default function BulkCompressTool() {
  const meta = getToolMeta('img-bulk-compress');
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState<number>(75);
  const [maxDimensionOpt, setMaxDimensionOpt] = useState<MaxDimensionOption>('original');
  const [formatChoice, setFormatChoice] = useState<FormatOption>('auto');

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BatchResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const maxDimId = useId();
  const formatId = useId();

  const handleFiles = (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    setFiles(newFiles);
    setResults(null);
    setError(null);
  };

  const handleReset = () => {
    setFiles([]);
    setResults(null);
    setError(null);
    setProcessing(false);
    setProgress(0);
  };

  const handleProcess = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress(0);
    setError(null);

    const maxDim = maxDimensionOpt === 'original' ? undefined : parseInt(maxDimensionOpt, 10);
    const chosenFormat: EncodableMime | undefined = formatChoice === 'auto' ? undefined : formatChoice;

    const outputItems: BatchResultItem[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const res = await compressImage(file, {
          quality: quality / 100,
          maxDimension: maxDim,
          format: chosenFormat,
        });

        outputItems.push({
          name: res.filename,
          blob: res.blob,
          originalSize: file.size,
        });

        setProgress((i + 1) / files.length);
      }

      setResults(outputItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while compressing images.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-bulk-compress">
      {files.length === 0 ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          multiple
          label="Choose multiple images or drag them here"
          hint="Supports JPG, PNG, WEBP, GIF, BMP, SVG, HEIC and AVIF. Compress many at once."
          onFiles={handleFiles}
        />
      ) : results ? (
        <BatchResults items={results} onReset={handleReset} />
      ) : (
        <div>
          {error && <div className="error-banner">{error}</div>}

          <div className="meta-chips">
            <span className="meta-chip">
              Selected files: <strong>{files.length}</strong>
            </span>
            <span className="meta-chip">
              Total size: <strong>{formatBytes(files.reduce((acc, f) => acc + f.size, 0))}</strong>
            </span>
          </div>

          {processing ? (
            <div style={{ marginTop: '1.5rem' }}>
              <ProgressBar value={progress} label={`Compressing images (${Math.round(progress * files.length)} of ${files.length})...`} />
            </div>
          ) : (
            <div style={{ marginTop: '1.5rem' }}>
              <Field label="Quality" hint="Quality slider (default 75). Lower values produce smaller files.">
                <Slider value={quality} min={5} max={95} step={1} unit="%" onChange={setQuality} />
              </Field>

              <Field label="Max dimension" hint="Constrain the longest edge to reduce size further">
                <Select
                  id={maxDimId}
                  value={maxDimensionOpt}
                  onChange={(e) => setMaxDimensionOpt(e.target.value as MaxDimensionOption)}
                  options={[
                    { value: 'original', label: 'Keep original dimensions' },
                    { value: '1920', label: '1920 px (Full HD)' },
                    { value: '1280', label: '1280 px (HD)' },
                    { value: '1080', label: '1080 px (Square / Social)' },
                    { value: '800', label: '800 px (Web)' },
                  ]}
                />
              </Field>

              <Field label="Output format">
                <Select
                  id={formatId}
                  value={formatChoice}
                  onChange={(e) => setFormatChoice(e.target.value as FormatOption)}
                  options={[
                    { value: 'auto', label: 'Auto (JPG, or WEBP if transparent)' },
                    { value: 'image/jpeg', label: 'JPG' },
                    { value: 'image/webp', label: 'WEBP' },
                  ]}
                />
              </Field>

              <div className="action-buttons" style={{ marginTop: '2rem' }}>
                <Button variant="secondary" onClick={handleReset}>
                  Choose different files
                </Button>
                <Button variant="primary" onClick={handleProcess}>
                  Compress {files.length} {files.length === 1 ? 'image' : 'images'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolPage>
  );
}
