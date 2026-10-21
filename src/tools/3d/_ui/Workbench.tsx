import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button, Select, Alert, Badge } from '../../../components/Controls';
import { downloadBlob } from '../../../lib/download';
import { formatBytes } from '../../../lib/format';
import { ALL_MESH_FORMATS, detectFormatFromFilename, type MeshFormat, type MeshModel } from './types';
import { importModel, exportModel, cancelMeshJobs, MESH_ACCEPT } from '../_mesh/client';
import { Download, RotateCcw } from 'lucide-react';
import styles from './Workbench.module.css';

export const ACCEPT_MESH_EXTENSIONS = MESH_ACCEPT || '.stl,.obj,.ply,.3mf';

export function stripMeshExtension(filename: string): string {
  const basename = filename.split(/[/\\]/).pop() || filename;
  return basename.replace(/\.(stl|obj|ply|3mf|step|stp|iges|igs|brep)$/i, '');
}

export function buildExportFilename(baseName: string, suffix = '', format: string): string {
  const cleanBase = stripMeshExtension(baseName || 'model');
  const cleanExt = format.replace(/^\./, '');
  return `${cleanBase}${suffix}.${cleanExt}`;
}

export interface Use3DWorkbenchOptions {
  multiple?: boolean;
}

export function use3DWorkbench({ multiple = false }: Use3DWorkbenchOptions = {}) {
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [originalModel, setOriginalModel] = useState<MeshModel | null>(null);
  const [currentModel, setCurrentModel] = useState<MeshModel | null>(null);
  const [multiModels, setMultiModels] = useState<MeshModel[]>([]);

  const [loading, setLoading] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [processing, setProcessing] = useState<boolean>(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [lastExportedBlob, setLastExportedBlob] = useState<{ blob: Blob; filename: string } | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);

  const [exportFormat, setExportFormat] = useState<MeshFormat>('stl');

  const jobIdRef = useRef<number>(0);

  // Unmount cleanup: terminate background worker and cancel jobs on navigation
  useEffect(() => {
    return () => {
      jobIdRef.current += 1;
      try {
        cancelMeshJobs();
      } catch {
        // ignore
      }
    };
  }, []);

  // Load single or multiple files
  const loadFiles = useCallback(
    async (incoming: File[]) => {
      if (incoming.length === 0) return;

      const currentJob = ++jobIdRef.current;
      setImportError(null);
      setProcessError(null);
      setLastExportedBlob(null);
      setLoading(true);

      try {
        if (multiple) {
          // Multi-file loading: import each file before committing
          const loadedPairs: { file: File; model: MeshModel }[] = [];
          for (const f of incoming) {
            const m = await importModel(f);
            if (currentJob !== jobIdRef.current) return;
            loadedPairs.push({ file: f, model: m });
          }

          if (currentJob !== jobIdRef.current) return;
          // Atomic commit of loaded pairs prevents files/multiModels misalignment on failure
          setFiles((prev) => [...prev, ...loadedPairs.map((p) => p.file)]);
          setMultiModels((prev) => {
            const merged = [...prev, ...loadedPairs.map((p) => p.model)];
            if (!currentModel && merged.length > 0) {
              setCurrentModel(merged[0]);
            }
            return merged;
          });
        } else {
          // Single file loading: import model before committing file and model
          const selected = incoming[0];
          const initialFormat = detectFormatFromFilename(selected.name);
          setExportFormat(initialFormat);

          const m = await importModel(selected);
          if (currentJob !== jobIdRef.current) return;

          setFile(selected);
          setOriginalModel(m);
          setCurrentModel(m);
        }
      } catch (err: unknown) {
        if (currentJob === jobIdRef.current) {
          setImportError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (currentJob === jobIdRef.current) {
          setLoading(false);
        }
      }
    },
    [currentModel, multiple],
  );

  // Remove a file in multi-mode
  const removeMultiFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setMultiModels((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setCurrentModel((curr) => {
        if (curr === prev[index]) {
          return next.length > 0 ? next[0] : null;
        }
        return curr;
      });
      return next;
    });
  }, []);

  // Cancel running job
  const cancelProcessing = useCallback(() => {
    jobIdRef.current += 1;
    try {
      cancelMeshJobs();
    } catch (e) {
      console.warn('cancelMeshJobs error:', e);
    }
    setLoading(false);
    setProcessing(false);
    setExporting(false);
    setProcessError('Processing cancelled by user.');
  }, []);

  // Reset entire workbench
  const reset = useCallback(() => {
    jobIdRef.current += 1;
    try {
      cancelMeshJobs();
    } catch {
      // ignore
    }
    setFile(null);
    setFiles([]);
    setOriginalModel(null);
    setCurrentModel(null);
    setMultiModels([]);
    setLoading(false);
    setImportError(null);
    setProcessing(false);
    setProcessError(null);
    setLastExportedBlob(null);
    setExporting(false);
  }, []);

  // Export and trigger browser download
  const handleExport = useCallback(
    async (modelToExport?: MeshModel | null, formatOverride?: MeshFormat, customSuffix = '') => {
      const targetModel = modelToExport || currentModel;
      if (!targetModel) return;

      const fmt = formatOverride || exportFormat;
      const currentJob = ++jobIdRef.current;
      setExporting(true);
      setProcessError(null);

      try {
        const blob = await exportModel(targetModel, fmt);
        if (currentJob !== jobIdRef.current) return;

        const rawName = targetModel.name || file?.name || 'model';
        const outName = buildExportFilename(rawName, customSuffix, fmt);

        setLastExportedBlob({ blob, filename: outName });
        downloadBlob(blob, outName);
      } catch (err: unknown) {
        if (currentJob === jobIdRef.current) {
          setProcessError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (currentJob === jobIdRef.current) {
          setExporting(false);
        }
      }
    },
    [currentModel, exportFormat, file],
  );

  return {
    file,
    files,
    originalModel,
    currentModel,
    setCurrentModel,
    multiModels,
    setMultiModels,
    loading,
    importError,
    processing,
    setProcessing,
    processError,
    setProcessError,
    lastExportedBlob,
    exporting,
    exportFormat,
    setExportFormat,
    jobIdRef,
    loadFiles,
    removeMultiFile,
    cancelProcessing,
    reset,
    handleExport,
  };
}

export interface WorkbenchHeaderProps {
  file: File | null;
  model: MeshModel | null;
  onReset: () => void;
  action?: React.ReactNode;
}

export function WorkbenchHeader({ file, model, onReset, action }: WorkbenchHeaderProps) {
  if (!file && !model) return null;

  const vertCount = model ? model.positions.length / 3 : 0;
  const triCount = model ? model.indices.length / 3 : 0;

  return (
    <div className={styles.fileHeader}>
      <div className={styles.fileInfo}>
        <span className={styles.fileName}>{file?.name || model?.name || '3D Model'}</span>
        {file && <span className={styles.fileMeta}>{formatBytes(file.size)}</span>}
        <span className={styles.fileMeta}>
          {triCount.toLocaleString()} triangles • {vertCount.toLocaleString()} vertices
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {action}
        <Button variant="secondary" size="sm" icon={<RotateCcw size={14} />} onClick={onReset}>
          Choose another file
        </Button>
      </div>
    </div>
  );
}

export interface WorkbenchWarningsProps {
  warnings?: string[];
}

export function WorkbenchWarnings({ warnings }: WorkbenchWarningsProps) {
  if (!warnings || warnings.length === 0) return null;

  return (
    <Alert tone="warning" title="Model Import Notices">
      <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
        {warnings.map((w, idx) => (
          <li key={idx}>{w}</li>
        ))}
      </ul>
    </Alert>
  );
}

export interface ExportCardProps {
  model: MeshModel | null;
  exportFormat: MeshFormat;
  onFormatChange: (fmt: MeshFormat) => void;
  onExport: () => void;
  exporting: boolean;
  disabled?: boolean;
  label?: string;
}

export function ExportCard({
  model,
  exportFormat,
  onFormatChange,
  onExport,
  exporting,
  disabled = false,
  label = 'Export 3D Model',
}: ExportCardProps) {
  if (!model) return null;

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>
        <span>{label}</span>
        <Badge tone="brand">{exportFormat.toUpperCase()}</Badge>
      </h3>
      <p className={styles.cardSub}>Save and download the model in your preferred 3D format.</p>

      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        <Select
          value={exportFormat}
          options={ALL_MESH_FORMATS}
          onChange={(e) => onFormatChange(e.target.value as MeshFormat)}
          style={{ flex: 1 }}
          aria-label="Export format"
        />
        <Button variant="primary" icon={<Download size={15} />} loading={exporting} disabled={disabled || exporting} onClick={onExport}>
          Download .{exportFormat}
        </Button>
      </div>
    </div>
  );
}
