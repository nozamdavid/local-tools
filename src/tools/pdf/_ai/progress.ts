type Translate = (sourceEnglish: string, params?: Record<string, string | number>) => string;

/** Formats the AI engine's fixed English progress messages in the selected interface language. */
export function translateAiProgressLabel(label: string, t: Translate): string {
  const download = label.match(/^Downloading model weights: (\d+)% \((.+) MB \/ (.+) MB\)\.\.\.$/);
  if (download)
    return t('Downloading model weights: {percent}% ({loaded} MB / {total} MB)...', {
      percent: download[1],
      loaded: download[2],
      total: download[3],
    });

  const elapsed = label.match(/^Running model inference\.\.\. \((\d+)s elapsed\)$/);
  if (elapsed) return t('Running model inference... ({seconds}s elapsed)', { seconds: elapsed[1] });

  const chunk = label.match(/^Running inference \(chunk (\d+) of (\d+)\)\.\.\.$/);
  if (chunk) return t('Running inference (chunk {current} of {total})...', { current: chunk[1], total: chunk[2] });

  if (label === 'Running inference...') return t('Running inference...');
  if (label === 'Complete') return t('Complete');
  if (label === 'Preparing translation model...') return t('Preparing translation model...');
  if (label === 'Preparing model...') return t('Preparing model...');

  const section = label.match(/^Processing section (\d+) of (\d+)\.\.\.$/);
  if (section) return t('Processing section {current} of {total}...', { current: section[1], total: section[2] });
  return t(label);
}
