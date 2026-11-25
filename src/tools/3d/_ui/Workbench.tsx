import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button, Select, Alert } from '../../../components/Controls';
import { ContinueWith } from '../../../components/ContinueWith';
import { downloadBlob } from '../../../lib/download';
import { formatBytes } from '../../../lib/format';
import { ALL_MESH_FORMATS, detectFormatFromFilename, type MeshFormat, type MeshModel } from './types';
import { importModel, exportModel, cancelMeshJobs, MESH_ACCEPT } from '../_mesh/client';
import { Download, RotateCcw } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import styles from './Workbench.module.css';

export const ACCEPT_MESH_EXTENSIONS = MESH_ACCEPT || '.stl,.obj,.ply,.3mf';

type Translator = (sourceEnglish: string, params?: Record<string, string | number>) => string;
type ExportedMesh = { blob: Blob; filename: string };

/** Translate shared 3D parser diagnostics while keeping file names and measurements intact. */
export function translate3DMessage(message: string, t: Translator): string {
  const patterns: Array<[RegExp, string, (match: RegExpMatchArray) => Record<string, string | number>]> = [
    [/^File "(.+)" is empty \(0 bytes\)\.$/, 'File "{filename}" is empty (0 bytes).', (match) => ({ filename: match[1] })],
    [
      /^CAD file size \((.+) MB\) exceeds maximum allowed limit of 25 MB\.$/,
      'CAD file size ({size} MB) exceeds maximum allowed limit of 25 MB.',
      (match) => ({ size: match[1] }),
    ],
    [
      /^File "(.+)" \((.+) MB\) exceeds maximum supported size of (.+) MB\.$/,
      'File "{filename}" ({size} MB) exceeds maximum supported size of {limit} MB.',
      (match) => ({ filename: match[1], size: match[2], limit: match[3] }),
    ],
    [
      /^Unsupported 3D model format for "(.+)"\. Supported formats are STL, OBJ, PLY, 3MF, STEP, IGES, and BREP\.$/,
      'Unsupported 3D model format for "{filename}". Supported formats are STL, OBJ, PLY, 3MF, STEP, IGES, and BREP.',
      (match) => ({ filename: match[1] }),
    ],
    [
      /^Unsupported file format for "(.+)"\. Supported CAD formats are STEP \(\.step, \.stp\), IGES \(\.iges, \.igs\), and BREP \(\.brep\)\.$/,
      'Unsupported file format for "{filename}". Supported CAD formats are STEP (.step, .stp), IGES (.iges, .igs), and BREP (.brep).',
      (match) => ({ filename: match[1] }),
    ],
    [/^Unsupported CAD format "(.+)"\.$/, 'Unsupported CAD format "{format}".', (match) => ({ format: match[1] })],
    [/^Unsupported 3D mesh format: \.([A-Za-z0-9]+)$/, 'Unsupported 3D mesh format: .{format}', (match) => ({ format: match[1] })],
    [/^Unsupported export format: (.+)$/, 'Unsupported export format: {format}', (match) => ({ format: match[1] })],
    [/^Unknown mesh operation: (.+)$/, 'Unknown mesh operation: {operation}', (match) => ({ operation: match[1] })],
    [/^Unknown request type: (.+)$/, 'Unknown request type: {type}', (match) => ({ type: match[1] })],
    [
      /^Failed to parse (STEP|IGES|BREP) model\. File may be corrupted or contain unsupported CAD entity types\.$/,
      'Failed to parse {format} model. The file may be corrupted or may contain unsupported CAD entity types.',
      (match) => ({ format: match[1] }),
    ],
    [
      /^Corrupt binary STL: expected at least (.+) bytes for (.+) triangles, found (.+) bytes\.$/,
      'Corrupt binary STL: expected at least {expectedBytes} bytes for {triangles} triangles, found {actualBytes} bytes.',
      (match) => ({ expectedBytes: match[1], triangles: match[2], actualBytes: match[3] }),
    ],
    [
      /^Corrupt OBJ file: face index (.+) is out of bounds \(vertex count: (.+)\)\.$/,
      'Corrupt OBJ file: face index {index} is out of bounds (vertex count: {count}).',
      (match) => ({ index: match[1], count: match[2] }),
    ],
    [
      /^Invalid positions buffer length: (.+) is not a multiple of 3 \(X, Y, Z\)\.$/,
      'Invalid positions buffer length: {length} is not a multiple of 3 (X, Y, Z).',
      (match) => ({ length: match[1] }),
    ],
    [
      /^Invalid indices buffer length: (.+) is not a multiple of 3 \(triangle indices\)\.$/,
      'Invalid indices buffer length: {length} is not a multiple of 3 (triangle indices).',
      (match) => ({ length: match[1] }),
    ],
    [
      /^Triangle count \((.+)\) exceeds maximum allowed limit of (.+)\.$/,
      'Triangle count ({count}) exceeds maximum allowed limit of {limit}.',
      (match) => ({ count: match[1], limit: match[2] }),
    ],
    [
      /^Vertex coordinate count \((.+)\) exceeds maximum allowed limit\.$/,
      'Vertex coordinate count ({count}) exceeds maximum allowed limit.',
      (match) => ({ count: match[1] }),
    ],
    [
      /^Invalid mesh: coordinate at index (.+) is non-finite \((.+)\)\.$/,
      'Invalid mesh: coordinate at index {index} is non-finite ({value}).',
      (match) => ({ index: match[1], value: match[2] }),
    ],
    [
      /^Invalid mesh: triangle index (.+) at position (.+) is out of bounds \(vertex count: (.+)\)\.$/,
      'Invalid mesh: triangle index {index} at position {position} is out of bounds (vertex count: {count}).',
      (match) => ({ index: match[1], position: match[2], count: match[3] }),
    ],
    [
      /^Corrupted CAD vertex buffer: length (.+) not divisible by 3\.$/,
      'Corrupted CAD vertex buffer: length {length} is not divisible by 3.',
      (match) => ({ length: match[1] }),
    ],
    [
      /^Corrupted CAD index buffer: length (.+) not divisible by 3\.$/,
      'Corrupted CAD index buffer: length {length} is not divisible by 3.',
      (match) => ({ length: match[1] }),
    ],
    [
      /^Corrupted index buffer: total indices \((.+)\) not divisible by 3\.$/,
      'Corrupted index buffer: total indices ({count}) are not divisible by 3.',
      (match) => ({ count: match[1] }),
    ],
    [
      /^CAD model exceeds vertex limit: tessellated to (.+) vertices \(limit is (.+)\)\. Try selecting 'coarse' quality\.$/,
      'CAD model exceeds the vertex limit: tessellation produced {count} vertices (limit: {limit}). Try selecting the coarse quality setting.',
      (match) => ({ count: match[1], limit: match[2] }),
    ],
    [
      /^CAD model exceeds triangle limit: tessellated to (.+) triangles \(limit is (.+)\)\. Try selecting 'coarse' quality\.$/,
      'CAD model exceeds the triangle limit: tessellation produced {count} triangles (limit: {limit}). Try selecting the coarse quality setting.',
      (match) => ({ count: match[1], limit: match[2] }),
    ],
    [
      /^Invalid non-finite coordinate \((.+)\) encountered in CAD mesh\.$/,
      'Invalid non-finite coordinate ({value}) encountered in CAD mesh.',
      (match) => ({ value: match[1] }),
    ],
    [
      /^Invalid index (.+) for mesh face with (.+) vertices\.$/,
      'Invalid index {index} for mesh face with {count} vertices.',
      (match) => ({ index: match[1], count: match[2] }),
    ],
    [/^Failed to parse PLY file: (.+)$/, 'Failed to parse PLY file: {detail}', (match) => ({ detail: match[1] })],
    [/^Failed to read 3MF archive: (.+)$/, 'Failed to read 3MF archive: {detail}', (match) => ({ detail: match[1] })],
    [
      /^3MF archive contains too many entries \((.+)\)\.$/,
      '3MF archive contains too many entries ({count}).',
      (match) => ({ count: match[1] }),
    ],
    [
      /^3MF archive contains forbidden relative\/absolute path: "(.+)"$/s,
      '3MF archive contains a forbidden relative or absolute path: "{path}".',
      (match) => ({ path: match[1] }),
    ],
    [
      /^3MF archive declared uncompressed size \((.+) MB\) exceeds maximum limit of (.+) MB\.$/,
      '3MF archive declared uncompressed size ({size} MB) exceeds the maximum limit of {limit} MB.',
      (match) => ({ size: match[1], limit: match[2] }),
    ],
    [
      /^Invalid 3MF: malformed XML in (relationships|3D model) document \((.+)\)\.$/,
      'Invalid 3MF: malformed XML in the {document} document ({detail}).',
      (match) => ({ document: match[1], detail: match[2] }),
    ],
    [
      /^Invalid 3MF: malformed XML in 3D model document "(.+)" \((.+)\)\.$/s,
      'Invalid 3MF: malformed XML in 3D model document "{path}" ({detail}).',
      (match) => ({ path: match[1], detail: match[2] }),
    ],
    [
      /^Invalid 3MF Production model path "(.*)"\. Expected an absolute path inside the archive\.$/s,
      'Invalid 3MF Production model path "{path}". Expected an absolute path inside the archive.',
      (match) => ({ path: match[1] }),
    ],
    [
      /^Invalid 3MF: referenced model part "(.+)" was not found in the archive\.$/s,
      'Invalid 3MF: referenced model part "{path}" was not found in the archive.',
      (match) => ({ path: match[1] }),
    ],
    [
      /^Invalid 3MF: Production path on a component in non-root model part "(.+)"\.$/s,
      'Invalid 3MF: Production path on a component in non-root model part "{path}".',
      (match) => ({ path: match[1] }),
    ],
    [
      /^3MF archive declared root model at "(.+)" in _rels\/.rels, but the file was not found in the archive\.$/,
      '3MF archive names "{path}" as the root model in _rels/.rels, but the file was not found in the archive.',
      (match) => ({ path: match[1] }),
    ],
    [
      /^Invalid 3MF: multiple \.model files found \((.+)\) but _rels\/.rels is missing to determine the primary model\.$/,
      'Invalid 3MF: multiple .model files were found ({paths}), but _rels/.rels is missing, so the primary model cannot be determined.',
      (match) => ({ paths: match[1] }),
    ],
    [
      /^3MF archive missing 3D model document \(expected "(.+)"\)\.$/,
      '3MF archive is missing the 3D model document (expected "{path}").',
      (match) => ({ path: match[1] }),
    ],
    [
      /^Unsupported 3MF: unknown namespace "(.+)"\. Expected 3MF Core namespace\.$/,
      'Unsupported 3MF namespace "{namespace}". The 3MF Core namespace is required.',
      (match) => ({ namespace: match[1] }),
    ],
    [
      /^Unsupported 3MF: required extension "(.+)" is not supported\.$/,
      'Unsupported 3MF extension: required extension "{extension}" is not supported.',
      (match) => ({ extension: match[1] }),
    ],
    [/^Unsupported or invalid 3MF unit: "(.+)"\.$/, 'Unsupported or invalid 3MF unit: "{unit}".', (match) => ({ unit: match[1] })],
    [
      /^Circular component reference detected in 3MF object "(.+)"\.$/,
      'Circular component reference detected in 3MF object "{objectId}".',
      (match) => ({ objectId: match[1] }),
    ],
    [
      /^3MF model exceeds maximum allowed triangles \((.+) > (.+)\)\.$/,
      '3MF model exceeds the maximum allowed triangle count ({count} > {limit}).',
      (match) => ({ count: match[1], limit: match[2] }),
    ],
    [
      /^Quality preset "(.+)" applied \(linear deflection: (.+), angular deflection: (.+) rad\) with units normalized to millimeters\.$/,
      'Quality preset "{quality}" applied (linear deflection: {linear}, angular deflection: {angular} rad) with units normalized to millimeters.',
      (match) => ({ quality: match[1], linear: match[2], angular: match[3] }),
    ],
    [
      /^Flattened assembly containing (.+) parts into a unified single-mesh model\.$/,
      'Flattened assembly containing {count} parts into a unified single-mesh model.',
      (match) => ({ count: match[1] }),
    ],
    [
      /^Simplification achieved: (.+) triangles \((.+)% of original (.+)\) with relative error (.+)\.$/,
      'Simplification achieved: {triangles} triangles ({percent}% of original {original}) with relative error {error}.',
      (match) => ({ triangles: match[1], percent: match[2], original: match[3], error: match[4] }),
    ],
  ];

  for (const [pattern, source, params] of patterns) {
    const match = message.match(pattern);
    if (match) return t(source, params(match));
  }

  const directTranslation = t(message);
  return directTranslation;
}

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
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [originalModel, setOriginalModel] = useState<MeshModel | null>(null);
  const [currentModel, setCurrentModel] = useState<MeshModel | null>(null);
  const [multiModels, setMultiModels] = useState<MeshModel[]>([]);

  const [loading, setLoading] = useState<boolean>(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [processing, setProcessing] = useState<boolean>(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [lastExportedBlob, setLastExportedBlob] = useState<ExportedMesh | null>(null);
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
    [currentModel, multiple, t],
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
  }, [t]);

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
    [currentModel, exportFormat, file, t],
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
  const { t } = useI18n();
  if (!file && !model) return null;

  const vertCount = model ? model.positions.length / 3 : 0;
  const triCount = model ? model.indices.length / 3 : 0;

  return (
    <div className={styles.fileHeader}>
      <div className={styles.fileInfo}>
        <span className={styles.fileName}>{file?.name || model?.name || t('3D Model')}</span>
        {file && <span className={styles.fileMeta}>{formatBytes(file.size)}</span>}
        <span className={styles.fileMeta}>
          {t('{triangles} triangles • {vertices} vertices', { triangles: triCount.toLocaleString(), vertices: vertCount.toLocaleString() })}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {action}
        <Button variant="secondary" size="sm" icon={<RotateCcw size={14} />} onClick={onReset}>
          {t('Choose another file')}
        </Button>
      </div>
    </div>
  );
}

export interface WorkbenchWarningsProps {
  warnings?: string[];
}

export function WorkbenchWarnings({ warnings }: WorkbenchWarningsProps) {
  const { t } = useI18n();
  if (!warnings || warnings.length === 0) return null;

  return (
    <Alert tone="warning" title={t('Model Import Notices')}>
      <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
        {warnings.map((w, idx) => (
          <li key={idx}>{translate3DMessage(w, t)}</li>
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
  lastExportedBlob: ExportedMesh | null;
  disabled?: boolean;
  label?: string;
}

export function ExportCard({
  model,
  exportFormat,
  onFormatChange,
  onExport,
  exporting,
  lastExportedBlob,
  disabled = false,
  label = 'Export 3D Model',
}: ExportCardProps) {
  const { t } = useI18n();
  if (!model) return null;

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>
        <span>{label}</span>
      </h3>

      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        <Select
          value={exportFormat}
          options={ALL_MESH_FORMATS}
          onChange={(e) => onFormatChange(e.target.value as MeshFormat)}
          style={{ flex: 1 }}
          aria-label={t('Export format')}
        />
        <Button variant="primary" icon={<Download size={15} />} loading={exporting} disabled={disabled || exporting} onClick={onExport}>
          {t('Download')}
        </Button>
      </div>
      {lastExportedBlob && <ContinueWith results={[{ name: lastExportedBlob.filename, blob: lastExportedBlob.blob }]} />}
    </div>
  );
}
