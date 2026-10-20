/**
 * Pure batch renaming utilities:
 * - Parsing dotfiles (.gitignore), extensionless files (Makefile), and compound extensions (.tar.gz)
 * - Safe filename sanitization (directory separators, illegal chars, Windows reserved device names)
 * - Numbering (padding, prefix/suffix, custom start, separators)
 * - Collision detection and auto-resolution
 */

export interface RenameConfig {
  mode: 'custom' | 'original';
  baseName: string;
  enableNumbering: boolean;
  numberStart: number;
  numberPadding: number; // e.g. 1 -> '1', 2 -> '01', 3 -> '001'
  numberPosition: 'prefix' | 'suffix';
  separator: string; // '-', '_', ' ', '.'
  preserveExtension: boolean;
  caseTransform: 'none' | 'lower' | 'upper' | 'title';
  findText?: string;
  replaceText?: string;
  autoResolveCollisions: boolean;
}

export interface ParsedFileName {
  base: string;
  ext: string; // includes leading dot if present (e.g. ".png"), or empty ""
}

const COMPOUND_EXTENSIONS = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst'];

const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Accurately parses filename into base and extension.
 * Correctly preserves dotfiles (e.g. ".gitignore") and extensionless files (e.g. "Makefile").
 */
export function parseFileName(filename: string): ParsedFileName {
  const trimmed = filename.trim();

  // Check for compound extensions like .tar.gz
  const lower = trimmed.toLowerCase();
  for (const compound of COMPOUND_EXTENSIONS) {
    if (lower.endsWith(compound) && lower.length > compound.length) {
      return {
        base: trimmed.slice(0, trimmed.length - compound.length),
        ext: trimmed.slice(trimmed.length - compound.length),
      };
    }
  }

  // Dotfiles like .gitignore, .bashrc with no additional dots
  if (trimmed.startsWith('.') && trimmed.lastIndexOf('.') === 0) {
    return {
      base: trimmed,
      ext: '',
    };
  }

  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0) {
    // Extensionless or dot at 0
    return {
      base: trimmed,
      ext: '',
    };
  }

  return {
    base: trimmed.slice(0, lastDot),
    ext: trimmed.slice(lastDot),
  };
}

/**
 * Sanitizes a filename:
 * - Strips directory separators (/ and \)
 * - Replaces invalid filesystem characters (< > : " | ? * and ASCII controls)
 * - Resolves Windows reserved device names (CON, PRN, AUX, NUL, COM*, LPT*)
 * - Trims trailing dots and spaces
 */
export function sanitizeFileName(name: string, fallback = 'file'): { name: string; changed: boolean } {
  let cleaned = name
    // Replace directory separators and null bytes
    .replace(/[/\\]/g, '_')
    // Remove control characters (0-31)
    .replace(/[\x00-\x1f\x7f]/g, '')
    // Replace illegal characters for cross-platform safety
    .replace(/[<>:"|?*]/g, '_')
    // Remove leading/trailing spaces and trailing dots
    .trim()
    .replace(/\.+$/, '');

  if (!cleaned) {
    cleaned = fallback;
  }

  // Check Windows reserved names
  const dotIdx = cleaned.indexOf('.');
  const checkBase = (dotIdx === -1 ? cleaned : cleaned.slice(0, dotIdx)).toLowerCase();
  if (WINDOWS_RESERVED_NAMES.has(checkBase)) {
    cleaned = `_${cleaned}`;
  }

  return {
    name: cleaned,
    changed: cleaned !== name,
  };
}

/**
 * Transforms string case (lower, upper, title).
 */
export function transformCase(text: string, mode: 'none' | 'lower' | 'upper' | 'title'): string {
  switch (mode) {
    case 'lower':
      return text.toLowerCase();
    case 'upper':
      return text.toUpperCase();
    case 'title':
      return text.replace(/\b[a-z]/g, (char) => char.toUpperCase());
    default:
      return text;
  }
}

export interface RenameResultItem {
  id: string;
  originalName: string;
  newName: string;
  size: number;
  hasCollision: boolean;
  sanitized: boolean;
  base: string;
  ext: string;
}

/**
 * Computes live batch renaming for a list of items with collision detection.
 */
export function computeBatchRename(
  items: { id: string; name: string; size: number }[],
  config: RenameConfig
): RenameResultItem[] {
  // First pass: generate preliminary new names
  const preliminary: { item: (typeof items)[0]; parsed: ParsedFileName; preliminaryName: string; sanitized: boolean }[] = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const parsed = parseFileName(item.name);

    // 1. Base name determine
    let base = config.mode === 'custom' ? (config.baseName.trim() || 'file') : parsed.base;

    // 2. Find and replace if specified
    if (config.findText) {
      base = base.replaceAll(config.findText, config.replaceText ?? '');
    }

    // 3. Case transform
    base = transformCase(base, config.caseTransform);

    // 4. Numbering
    let numberedBase = base;
    if (config.enableNumbering) {
      const numVal = config.numberStart + index;
      const formattedNum = String(numVal).padStart(config.numberPadding, '0');
      const sep = config.separator;

      if (config.numberPosition === 'prefix') {
        numberedBase = `${formattedNum}${sep}${base}`;
      } else {
        numberedBase = `${base}${sep}${formattedNum}`;
      }
    }

    // 5. Extension
    let ext = config.preserveExtension ? parsed.ext : '';
    if (config.caseTransform === 'lower' && ext) {
      ext = ext.toLowerCase();
    } else if (config.caseTransform === 'upper' && ext) {
      ext = ext.toUpperCase();
    }

    const uncleanedFullName = `${numberedBase}${ext}`;
    const { name: cleanedFullName, changed } = sanitizeFileName(uncleanedFullName, `file_${index + 1}${ext}`);

    preliminary.push({
      item,
      parsed,
      preliminaryName: cleanedFullName,
      sanitized: changed,
    });
  }

  // Second pass: Collision detection and optional auto-resolution
  const finalResults: RenameResultItem[] = [];
  const nameCounts = new Map<string, number>();

  for (const entry of preliminary) {
    const count = (nameCounts.get(entry.preliminaryName.toLowerCase()) || 0) + 1;
    nameCounts.set(entry.preliminaryName.toLowerCase(), count);
  }

  const seenInResolution = new Map<string, number>();

  for (const entry of preliminary) {
    const rawLower = entry.preliminaryName.toLowerCase();
    const isColliding = (nameCounts.get(rawLower) || 0) > 1;

    let resolvedName = entry.preliminaryName;
    if (isColliding && config.autoResolveCollisions) {
      const idx = (seenInResolution.get(rawLower) || 0) + 1;
      seenInResolution.set(rawLower, idx);

      if (idx > 1) {
        const parsed = parseFileName(entry.preliminaryName);
        resolvedName = `${parsed.base}_${idx}${parsed.ext}`;
      }
    }

    finalResults.push({
      id: entry.item.id,
      originalName: entry.item.name,
      newName: resolvedName,
      size: entry.item.size,
      hasCollision: isColliding && !config.autoResolveCollisions,
      sanitized: entry.sanitized,
      base: entry.parsed.base,
      ext: entry.parsed.ext,
    });
  }

  return finalResults;
}
