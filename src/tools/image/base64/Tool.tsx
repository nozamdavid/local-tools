import { useState, useId } from 'react';
import { ToolPage } from '../../../components/ToolPage';
import { FileDrop } from '../../../components/FileDrop';
import { Button, Field } from '../../../components/Controls';
import { getToolMeta } from '../../registry';
import { formatBytes } from '../../../lib/format';
import { downloadBlob } from '../../../lib/download';
import { loadImage } from '../../../lib/image';
import styles from './Tool.module.css';

interface EncodeResult {
  filename: string;
  originalSize: number;
  base64Length: number;
  overheadPercent: number;
  dataUri: string;
  rawBase64: string;
  imgSnippet: string;
  cssSnippet: string;
}

interface DecodeResult {
  blob: Blob;
  previewUrl: string;
  mime: string;
  size: number;
  width: number;
  height: number;
}

export default function Base64Tool() {
  const meta = getToolMeta('img-base64');
  const [activeTab, setActiveTab] = useState<'encode' | 'decode'>('encode');

  // Encode mode state
  const [encodeFile, setEncodeFile] = useState<File | null>(null);
  const [encodeResult, setEncodeResult] = useState<EncodeResult | null>(null);
  const [encodeError, setEncodeError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Decode mode state
  const [pasteInput, setPasteInput] = useState<string>('');
  const [decodeResult, setDecodeResult] = useState<DecodeResult | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  const textareaId = useId();

  const handleFiles = (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    setEncodeFile(file);
    setEncodeError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      const commaIdx = dataUri.indexOf(',');
      const rawBase64 = commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;

      // UTF-8 length of data URI
      const base64Bytes = new Blob([dataUri]).size;
      const overheadPercent = Math.round(((base64Bytes - file.size) / file.size) * 100);

      const imgSnippet = `<img src="${dataUri}" alt="${file.name}" />`;
      const cssSnippet = `background-image: url('${dataUri}');`;

      setEncodeResult({
        filename: file.name,
        originalSize: file.size,
        base64Length: base64Bytes,
        overheadPercent,
        dataUri,
        rawBase64,
        imgSnippet,
        cssSnippet,
      });
    };
    reader.onerror = () => {
      setEncodeError('Failed to read image as Base64.');
    };
    reader.readAsDataURL(file);
  };

  const handleResetEncode = () => {
    setEncodeFile(null);
    setEncodeResult(null);
    setEncodeError(null);
  };

  const copySnippet = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const downloadTextFile = (content: string, extSuffix: string) => {
    if (!encodeFile) return;
    const base = encodeFile.name.replace(/\.[^.]+$/, '');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `${base}-${extSuffix}.txt`);
  };

  // Reverse mode (decode)
  const handleDecode = async () => {
    setDecodeError(null);
    const cleaned = pasteInput.trim().replace(/^['"]|['"]$/g, '');
    if (!cleaned) {
      setDecodeError('Please paste a Base64 string or Data URI.');
      return;
    }

    try {
      let mime = 'image/png';
      let b64 = cleaned;

      // Extract MIME if data URI
      if (cleaned.startsWith('data:')) {
        const matches = cleaned.match(/^data:([^;]+);base64,(.+)$/s);
        if (matches) {
          mime = matches[1];
          b64 = matches[2];
        } else {
          throw new Error('Invalid data URI format.');
        }
      }

      // Remove any whitespace or newlines inside base64 string
      b64 = b64.replace(/\s+/g, '');

      // Decode base64 to binary
      const binaryStr = atob(b64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Auto-detect MIME if generic
      if (bytes[0] === 0xff && bytes[1] === 0xd8) mime = 'image/jpeg';
      else if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = 'image/png';
      else if (bytes[0] === 0x47 && bytes[1] === 0x49) mime = 'image/gif';
      else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) mime = 'image/webp';

      const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
      const img = await loadImage(blob);
      const previewUrl = URL.createObjectURL(blob);

      if (decodeResult?.previewUrl) {
        URL.revokeObjectURL(decodeResult.previewUrl);
      }

      setDecodeResult({
        blob,
        previewUrl,
        mime,
        size: blob.size,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      });
    } catch (err) {
      setDecodeError(
        err instanceof Error
          ? `Could not decode Base64: ${err.message}`
          : 'Could not decode Base64 string. Please verify the format.',
      );
    }
  };

  const downloadDecoded = () => {
    if (!decodeResult) return;
    const ext = decodeResult.mime.split('/')[1] || 'png';
    downloadBlob(decodeResult.blob, `decoded-image.${ext}`);
  };

  return (
    <ToolPage title={meta.title} description={meta.description} currentId="img-base64">
      <div className={styles.container}>
        <div className={styles.modeTabs}>
          <Button
            variant={activeTab === 'encode' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('encode')}
          >
            Image to Base64
          </Button>
          <Button
            variant={activeTab === 'decode' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('decode')}
          >
            Base64 to Image (Decode)
          </Button>
        </div>

        {activeTab === 'encode' ? (
          <div>
            {encodeError && <div className="error-banner">{encodeError}</div>}

            {!encodeResult ? (
              <FileDrop
                accept="image/*"
                label="Drop an image here to encode as Base64"
                hint="Supports JPG, PNG, WEBP, SVG, GIF and more."
                onFiles={handleFiles}
              />
            ) : (
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '1rem',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '1rem' }}>
                    Encoded: {encodeResult.filename}
                  </div>
                  <Button variant="secondary" onClick={handleResetEncode}>
                    Choose different image
                  </Button>
                </div>

                <div className={styles.statsRow}>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Original image size</span>
                    <span className={styles.statValue}>
                      {formatBytes(encodeResult.originalSize)}
                    </span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Base64 data size</span>
                    <span className={styles.statValue}>
                      {formatBytes(encodeResult.base64Length)}
                    </span>
                  </div>
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Data size overhead</span>
                    <span className={`${styles.statValue} ${styles.overheadBadge}`}>
                      +{encodeResult.overheadPercent}% larger
                    </span>
                  </div>
                </div>

                <div className={styles.outputCards} style={{ marginTop: '1.5rem' }}>
                  {/* Data URI */}
                  <div className={styles.snippetCard}>
                    <div className={styles.snippetHeader}>
                      <span className={styles.snippetTitle}>Data URI</span>
                      <div className={styles.snippetActions}>
                        <Button
                          variant="secondary"
                          onClick={() => downloadTextFile(encodeResult.dataUri, 'datauri')}
                          style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                        >
                          Download .txt
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => copySnippet(encodeResult.dataUri, 'datauri')}
                          style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                        >
                          {copiedKey === 'datauri' ? 'Copied!' : 'Copy Data URI'}
                        </Button>
                      </div>
                    </div>
                    <textarea
                      readOnly
                      className={styles.snippetTextarea}
                      value={encodeResult.dataUri}
                    />
                  </div>

                  {/* Raw Base64 */}
                  <div className={styles.snippetCard}>
                    <div className={styles.snippetHeader}>
                      <span className={styles.snippetTitle}>Raw Base64 string</span>
                      <div className={styles.snippetActions}>
                        <Button
                          variant="secondary"
                          onClick={() => downloadTextFile(encodeResult.rawBase64, 'base64')}
                          style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                        >
                          Download .txt
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => copySnippet(encodeResult.rawBase64, 'raw')}
                          style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                        >
                          {copiedKey === 'raw' ? 'Copied!' : 'Copy Base64'}
                        </Button>
                      </div>
                    </div>
                    <textarea
                      readOnly
                      className={styles.snippetTextarea}
                      value={encodeResult.rawBase64}
                    />
                  </div>

                  {/* HTML img tag */}
                  <div className={styles.snippetCard}>
                    <div className={styles.snippetHeader}>
                      <span className={styles.snippetTitle}>HTML &lt;img&gt; snippet</span>
                      <Button
                        variant="secondary"
                        onClick={() => copySnippet(encodeResult.imgSnippet, 'img')}
                        style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                      >
                        {copiedKey === 'img' ? 'Copied!' : 'Copy snippet'}
                      </Button>
                    </div>
                    <textarea
                      readOnly
                      className={styles.snippetTextarea}
                      value={encodeResult.imgSnippet}
                    />
                  </div>

                  {/* CSS Background */}
                  <div className={styles.snippetCard}>
                    <div className={styles.snippetHeader}>
                      <span className={styles.snippetTitle}>CSS background snippet</span>
                      <Button
                        variant="secondary"
                        onClick={() => copySnippet(encodeResult.cssSnippet, 'css')}
                        style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                      >
                        {copiedKey === 'css' ? 'Copied!' : 'Copy snippet'}
                      </Button>
                    </div>
                    <textarea
                      readOnly
                      className={styles.snippetTextarea}
                      value={encodeResult.cssSnippet}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            {decodeError && <div className="error-banner">{decodeError}</div>}

            <div className={styles.reverseInputCard}>
              <Field
                label="Paste Base64 string or Data URI"
                hint="Accepts data:image/...;base64,... or raw base64 string."
              >
                <textarea
                  id={textareaId}
                  className={styles.snippetTextarea}
                  style={{ height: '140px' }}
                  value={pasteInput}
                  onChange={(e) => setPasteInput(e.target.value)}
                  placeholder="Paste data:image/png;base64,iVBORw0KGgo... or raw Base64"
                />
              </Field>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Button variant="primary" onClick={handleDecode} disabled={!pasteInput.trim()}>
                  Decode to Image
                </Button>
                {pasteInput && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPasteInput('');
                      setDecodeResult(null);
                      setDecodeError(null);
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {decodeResult && (
              <div className={styles.reversePreviewGrid} style={{ marginTop: '1.5rem' }}>
                <div className={styles.previewThumbWrapper}>
                  <img
                    src={decodeResult.previewUrl}
                    alt="Decoded preview"
                    className={styles.previewImg}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                    Successfully Decoded
                  </div>

                  <div className="meta-chips">
                    <span className="meta-chip">
                      Format: <strong>{decodeResult.mime}</strong>
                    </span>
                    <span className="meta-chip">
                      Dimensions: <strong>{decodeResult.width}×{decodeResult.height} px</strong>
                    </span>
                    <span className="meta-chip">
                      Size: <strong>{formatBytes(decodeResult.size)}</strong>
                    </span>
                  </div>

                  <div style={{ marginTop: '0.5rem' }}>
                    <Button variant="primary" onClick={downloadDecoded}>
                      Download decoded image
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ToolPage>
  );
}
