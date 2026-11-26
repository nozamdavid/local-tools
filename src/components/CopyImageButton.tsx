import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, type ButtonProps } from './Controls';
import { copyImage } from '../lib/copyImage';
import { useI18n } from '../lib/i18n';
import { useObjectUrl } from '../lib/useObjectUrl';
import styles from './CopyImageButton.module.css';

interface CopyImageButtonProps {
  getImage: () => Blob | Promise<Blob>;
  disabled?: boolean;
  size?: ButtonProps['size'];
  filename?: string;
}

type Feedback = 'idle' | 'pending' | 'copied' | 'error' | Blob;

export function CopyImageButton({ getImage, disabled, size, filename }: CopyImageButtonProps) {
  const { t } = useI18n();
  const [feedback, setFeedback] = useState<Feedback>('idle');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const hintId = useId();
  const manualImage = feedback instanceof Blob ? feedback : null;
  const url = useObjectUrl(manualImage);
  const pending = feedback === 'pending';

  useEffect(() => {
    if (feedback !== 'copied') return;
    const timeout = window.setTimeout(() => setFeedback('idle'), 1500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!manualImage || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [manualImage]);

  async function handleCopy() {
    if (disabled || pending) return;
    setFeedback('pending');
    try {
      setFeedback((await copyImage(getImage, filename)) ?? 'copied');
    } catch {
      setFeedback('error');
    }
  }

  const label = pending ? t('Copying…') : feedback === 'copied' ? t('Copied') : t('Copy');

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        disabled={disabled}
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        icon={pending ? <span className="spinner" aria-hidden="true" /> : feedback === 'copied' ? <Check /> : <Copy />}
        onClick={handleCopy}
      >
        {label}
      </Button>
      <span className="sr-only" role="status">
        {pending || feedback === 'copied' ? label : ''}
      </span>
      {feedback === 'error' && (
        <span className="field-error" role="alert">
          {t('Could not copy the image.')}
        </span>
      )}
      {manualImage && (
        <dialog
          className={styles.dialog}
          ref={dialogRef}
          aria-labelledby={titleId}
          aria-describedby={hintId}
          onClose={() => setFeedback('idle')}
        >
          <h2 id={titleId}>{t('Copy image')}</h2>
          <p id={hintId}>{t('Right-click or press and hold the image, then choose Copy Image.')}</p>
          {url && <img className={styles.image} src={url} alt={t('Result')} onError={() => setFeedback('error')} />}
          <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
            {t('Close')}
          </Button>
        </dialog>
      )}
    </>
  );
}
