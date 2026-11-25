export async function copyText(text: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return;
  }

  const focused = document.activeElement;
  const field = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement ? focused : null;
  const start = field?.selectionStart;
  const end = field?.selectionEnd;
  const direction = field?.selectionDirection;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const anchorNode = selection?.anchorNode;
  const anchorOffset = selection?.anchorOffset ?? 0;
  const focusNode = selection?.focusNode;
  const focusOffset = selection?.focusOffset ?? 0;

  // Run the fallback synchronously in the copy button's click handler.
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.append(textarea);

  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    if (!document.execCommand('copy')) {
      throw new Error('Could not copy to clipboard.');
    }
  } finally {
    textarea.remove();
    if (focused instanceof HTMLElement || focused instanceof SVGElement) {
      focused.focus({ preventScroll: true });
    }
    if (selection && ranges.length === 1 && anchorNode?.isConnected && focusNode?.isConnected) {
      selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
    } else if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
    if (field && start != null && end != null) {
      field.setSelectionRange(start, end, direction ?? undefined);
    }
  }
}
