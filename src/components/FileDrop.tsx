import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ShieldCheck, Upload } from 'lucide-react';
import { matchesAccept, takePendingFiles } from '../lib/handoff';
import { isRecentEditorPath, rememberRecentFiles } from '../lib/recentFiles';
import { isToolEligibleForBatch, isToolEligibleForFile } from '../lib/toolInputs';
import { findToolByPath } from '../tools/registry';
import { Button, Kbd } from './Controls';
import { useFocusFallback } from './useFocusFallback';
import { useI18n } from '../lib/i18n';

export interface FileDropProps {
  accept?: string;
  multiple?: boolean;
  label?: string;
  hint?: string;
  icon?: React.ReactNode;
  rememberInHistory?: boolean;
  onFiles: (files: File[]) => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function FileDrop({
  accept,
  multiple = false,
  label = multiple ? 'Drop files here' : 'Drop a file here',
  hint,
  icon = <Upload />,
  rememberInHistory = true,
  onFiles,
}: FileDropProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [notice, setNotice] = useState<{ source: string; params?: Record<string, string | number> } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusFallback(rootRef);
  const dragDepth = useRef(0);
  const labelId = useId();
  const hintId = useId();
  const privacyId = useId();
  const { pathname } = useLocation();
  const { t } = useI18n();
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  function deliver(files: File[]) {
    if (files.length === 0) return;
    const accepted = files.filter((f) => matchesAccept(f, accept));
    if (accepted.length !== files.length) {
      const rejected = files.filter((f) => !accepted.includes(f));
      setNotice({
        source: "{files} aren't supported by this tool. Choose supported files to continue.",
        params: { files: rejected.map((f) => f.name).join(', ') },
      });
      return;
    }
    setNotice(null);
    const selection = multiple ? accepted : [accepted[0]];
    onFilesRef.current(selection);

    if (!rememberInHistory) return;
    const tool = findToolByPath(pathname);
    // The editors record a source after they decode it successfully.
    if (!tool || isRecentEditorPath(tool.path)) return;
    const canReopen = selection.length === 1 ? isToolEligibleForFile(tool, selection[0]) : isToolEligibleForBatch(tool, selection);
    if (canReopen) void rememberRecentFiles(selection, tool.path);
  }

  // Pick up a handoff without recording the selection again.
  useEffect(() => {
    let active = true;
    // Strict Mode may clean up this mount before the destination can finish decoding.
    queueMicrotask(() => {
      if (!active) return;
      const handed = takePendingFiles(pathname, accept, multiple);
      if (!handed) return;
      if (handed.rejected.length > 0)
        setNotice({
          source: "{files} can't be opened by this tool. Choose supported files to continue.",
          params: { files: handed.rejected.map((f) => f.name).join(', ') },
        });
      else if (handed.accepted.length > 0) onFilesRef.current(handed.accepted);
    });
    return () => {
      active = false;
    };
  }, [pathname, accept, multiple]);

  // Paste files (e.g. a screenshot) while the drop zone is on screen.
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      const zone = target?.closest('.file-drop') ?? document.querySelector('.file-drop');
      if (zone !== rootRef.current) return;
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
      aria-describedby={[hint ? hintId : null, privacyId].filter(Boolean).join(' ')}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={openPicker}
    >
      <input ref={fileInputRef} type="file" accept={accept} multiple={multiple} hidden tabIndex={-1} onChange={handleChange} />
      {icon && (
        <span className="file-drop-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="file-drop-label" id={labelId}>
        {t(isDragOver ? 'Release to open' : label)}
      </div>
      {hint && (
        <div className="file-drop-hint" id={hintId}>
          {t(hint)}
        </div>
      )}

      <div className="file-drop-actions">
        <Button
          variant="primary"
          aria-describedby={[labelId, hint ? hintId : null, privacyId].filter(Boolean).join(' ')}
          onClick={(e) => {
            e.stopPropagation();
            openPicker();
          }}
        >
          {t(multiple ? 'Choose files' : 'Choose file')}
        </Button>
        <span className="file-drop-paste">
          {t('or paste with')} <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd> <Kbd>V</Kbd>
        </span>
      </div>

      {notice && (
        <div className="field-error" role="alert">
          {t(notice.source, notice.params)}
        </div>
      )}

      <div className="file-drop-privacy">
        <ShieldCheck aria-hidden="true" />
        <span id={privacyId}>{t('Processed on this device. Nothing is uploaded.')}</span>
      </div>
    </div>
  );
}
