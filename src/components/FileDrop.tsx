import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ShieldCheck, Upload } from 'lucide-react';
import { matchesAccept, takePendingFiles } from '../lib/handoff';
import { Button, Kbd } from './Controls';
import { useFocusFallback } from './useFocusFallback';

export interface FileDropProps {
  accept?: string;
  multiple?: boolean;
  label?: string;
  hint?: string;
  onFiles: (files: File[]) => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function FileDrop({
  accept,
  multiple = false,
  label = multiple ? 'Drop files here' : 'Drop a file here',
  hint,
  onFiles,
}: FileDropProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusFallback(rootRef);
  const dragDepth = useRef(0);
  const labelId = useId();
  const hintId = useId();
  const { pathname } = useLocation();
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  function deliver(files: File[]) {
    if (files.length === 0) return;
    const accepted = files.filter((f) => matchesAccept(f, accept));
    if (accepted.length === 0) {
      setNotice(`${files[0].name} isn't a supported file type for this tool.`);
      return;
    }
    setNotice(null);
    onFilesRef.current(multiple ? accepted : [accepted[0]]);
  }

  // Pick up a file handed over from the home page drop zone.
  useEffect(() => {
    const handed = takePendingFiles(pathname, accept, multiple);
    if (!handed) return;
    if (handed.accepted.length > 0) onFilesRef.current(handed.accepted);
    else if (handed.rejected.length > 0) setNotice(`${handed.rejected[0].name} can't be opened by this tool. Choose a different file.`);
  }, [pathname, accept, multiple]);

  // Paste files (e.g. a screenshot) while the drop zone is on screen.
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      deliver(files);
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  });

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setIsDragOver(false);
    deliver(Array.from(e.dataTransfer.files ?? []));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      deliver(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const openPicker = () => fileInputRef.current?.click();

  // The "Choose file" button is the keyboard and screen reader control. Clicking anywhere on the zone is a pointer shortcut for it.
  return (
    <div
      className={`file-drop ${isDragOver ? 'drag-over' : ''}`}
      ref={rootRef}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint ? hintId : undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={openPicker}
    >
      <input ref={fileInputRef} type="file" accept={accept} multiple={multiple} hidden tabIndex={-1} onChange={handleChange} />
      <span className="file-drop-icon" aria-hidden="true">
        <Upload />
      </span>
      <div className="file-drop-label" id={labelId}>
        {isDragOver ? 'Release to open' : label}
      </div>
      {hint && (
        <div className="file-drop-hint" id={hintId}>
          {hint}
        </div>
      )}

      <div className="file-drop-actions">
        <Button
          variant="primary"
          aria-describedby={labelId}
          onClick={(e) => {
            e.stopPropagation();
            openPicker();
          }}
        >
          {multiple ? 'Choose files' : 'Choose file'}
        </Button>
        <span className="file-drop-paste">
          or paste with <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd> <Kbd>V</Kbd>
        </span>
      </div>

      {notice && (
        <div className="field-error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
          {notice}
        </div>
      )}

      <div className="file-drop-privacy">
        <ShieldCheck aria-hidden="true" />
        Processed on this device. Nothing is uploaded.
      </div>
    </div>
  );
}
