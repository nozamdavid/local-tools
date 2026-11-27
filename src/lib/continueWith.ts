import { findToolByPath, TOOL_METAS, type ToolMeta } from '../tools/registry';
import { classifyFile, isToolEligibleForBatch, isToolEligibleForFile } from './toolInputs';
import { suggestToolsForFiles } from './handoff';

export interface ResultFileBlob {
  name: string;
  blob: Blob;
}

const CONTEXTUAL_NEXT_TOOLS: Record<string, string[]> = {
  'pdf-scan-to-pdf': ['pdf-ocr'],
  'img-resize': ['img-compress'],
  'img-convert': ['img-compress'],
  'audio-extract': ['audio-trim'],
};

/** Wraps output blobs in named Files for the in-memory tool handoff. */
export function createResultFiles(results: ResultFileBlob[]): File[] {
  return results.map(({ name, blob }) => new File([blob], name, { type: blob.type }));
}

function acceptsAllFiles(tool: ToolMeta, files: File[]): boolean {
  if (files.length === 1) return isToolEligibleForFile(tool, files[0]);
  return files.length > 1 && isToolEligibleForBatch(tool, files);
}

/** Returns relevant next tools ranked for this source route and complete output set. */
export function getContinueWithTools(sourcePath: string, files: File[]): ToolMeta[] {
  if (files.length === 0) return [];

  const source = findToolByPath(sourcePath);
  const preferredIds = [...(source ? (CONTEXTUAL_NEXT_TOOLS[source.id] ?? []) : [])];

  if (files.length === 1) {
    const output = classifyFile(files[0]);
    if (output.isPdf) preferredIds.push('pdf-metadata-cleaner');
    else if (output.isAnyImage) preferredIds.push('img-compress');
    else if (output.isAudio) preferredIds.push('audio-trim');
    else if (output.isSubtitle) preferredIds.push('subtitles');
  }

  const candidates = [...preferredIds, ...suggestToolsForFiles(files).map((tool) => tool.id)];
  const seen = new Set<string>();
  const targets: ToolMeta[] = [];

  for (const id of candidates) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === source?.id || id === 'file-inspector' || id === 'batch-rename') continue;

    const target = TOOL_METAS.find((tool) => tool.id === id);
    if (!target || !acceptsAllFiles(target, files)) continue;
    targets.push(target);
  }

  return targets;
}
