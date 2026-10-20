export interface FontOption {
  id: string;
  label: string;
  stack: string;
}

export const SYSTEM_FONTS: FontOption[] = [
  {
    id: 'sans',
    label: 'Sans-Serif',
    stack: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  {
    id: 'serif',
    label: 'Serif',
    stack: 'Georgia, Cambria, "Times New Roman", Times, serif',
  },
  {
    id: 'mono',
    label: 'Monospace',
    stack: 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace',
  },
  {
    id: 'impact',
    label: 'Impact',
    stack: 'Impact, "Arial Black", "Trebuchet MS", sans-serif',
  },
  {
    id: 'rounded',
    label: 'Rounded',
    stack: '"Arial Rounded MT Bold", ui-rounded, system-ui, sans-serif',
  },
];

export function getFontStack(fontIdOrStack: string): string {
  const found = SYSTEM_FONTS.find((f) => f.id === fontIdOrStack);
  return found ? found.stack : fontIdOrStack;
}
