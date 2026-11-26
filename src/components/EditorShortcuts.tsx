import { useEffect, useId, useRef } from 'react';
import { Keyboard, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Kbd } from './Controls';
import styles from './EditorShortcuts.module.css';

interface EditorShortcutsProps {
  shortcuts: readonly { label: string; keys: readonly string[] }[];
}

const workspaceSelector = '[data-editor-workspace]';
const dialogSelector = 'dialog[open], [role="dialog"], [role="alertdialog"]';
const editableSelector = 'input, textarea, select, [role="textbox"], [role="combobox"], [role="spinbutton"]';
const iconButtonClass = 'btn btn-ghost btn-sm btn-icon';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const keyNames: Readonly<Record<string, string>> = {
  Control: 'Ctrl',
  Meta: 'Cmd',
  Command: 'Cmd',
  '⌘': 'Cmd',
  Escape: 'Esc',
  Spacebar: 'Space',
  Delete: 'Del',
  Home: 'Home key',
  End: 'End key',
};
const arrowSymbols: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};
const arrowNames: Readonly<Record<string, string>> = {
  '←': 'Left arrow',
  '→': 'Right arrow',
  '↑': 'Up arrow',
  '↓': 'Down arrow',
};

function chordKeys(chord: string) {
  return chord.trim().split(/\s*\+(?!$)\s*/);
}

function platformChords(chords: readonly string[]) {
  const preferred = isMac ? 'Cmd' : 'Ctrl';
  const other = isMac ? 'Ctrl' : 'Cmd';
  const normalized = chords.map((chord) => chordKeys(chord).map((key) => keyNames[key] ?? arrowSymbols[key] ?? key));
  const available = new Set(normalized.map((chord) => chord.join('+')));
  return normalized.filter(([first, ...rest]) => first !== other || !available.has([preferred, ...rest].join('+')));
}

function hasOtherDialog(workspace: HTMLElement) {
  return Array.from(document.querySelectorAll(dialogSelector)).some(
    (dialog) =>
      !dialog.contains(workspace) &&
      !dialog.closest('[hidden], [inert], [aria-hidden="true"]') &&
      dialog.getClientRects().length > 0 &&
      getComputedStyle(dialog).visibility === 'visible',
  );
}

/** Place inside the loaded editor's data-editor-workspace root. Labels are already translated. */
export function EditorShortcuts({ shortcuts }: EditorShortcutsProps) {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDListElement>(null);
  const titleId = useId();
  const title = t('Keyboard shortcuts');

  useEffect(() => {
    const workspace = triggerRef.current?.closest<HTMLElement>(workspaceSelector);
    const dialog = dialogRef.current;
    if (!workspace || !dialog) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return;
      // Shift can be required to type '?' depending on the keyboard layout.
      if (event.ctrlKey || event.metaKey || event.altKey || event.getModifierState('AltGraph') || dialog.open) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest(workspaceSelector) !== workspace) return;
      if (target.closest(editableSelector) || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (hasOtherDialog(workspace)) return;

      event.preventDefault();
      dialog.showModal();
    };

    workspace.addEventListener('keydown', onKeyDown);
    return () => workspace.removeEventListener('keydown', onKeyDown);
  }, []);

  function showFromButton(trigger: HTMLButtonElement) {
    const dialog = dialogRef.current;
    const workspace = trigger.closest<HTMLElement>(workspaceSelector);
    if (!dialog || dialog.open || (workspace && hasOtherDialog(workspace))) return;
    // Safari does not focus buttons on pointer activation. Let the native dialog restore focus to this trigger.
    trigger.focus({ preventScroll: true });
    dialog.showModal();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={iconButtonClass}
        aria-label={title}
        aria-haspopup="dialog"
        aria-keyshortcuts="?"
        title={title}
        onClick={(event) => showFromButton(event.currentTarget)}
      >
        <Keyboard aria-hidden="true" />
      </button>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          const opensSearch = event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k');
          if (opensSearch) event.preventDefault();
          if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;

          const first = closeRef.current;
          const last = listRef.current;
          const from = event.shiftKey ? first : last;
          const to = event.shiftKey ? last : first;
          if (event.target === from && to) {
            event.preventDefault();
            to.focus({ preventScroll: true });
          }
        }}
      >
        <header className={styles.header}>
          <h2 id={titleId}>{title}</h2>
          <button
            ref={closeRef}
            type="button"
            className={iconButtonClass}
            aria-label={t('Close')}
            aria-keyshortcuts="Escape"
            title={t('Close')}
            onClick={() => dialogRef.current?.close()}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <dl ref={listRef} className={styles.list} tabIndex={0}>
          {shortcuts.map(({ label, keys }) => {
            const chords = platformChords(keys);
            const arrowsOnly = chords.every((chord) => Boolean(arrowNames[chord.at(-1) ?? '']));
            return (
              <div className={styles.row} key={label}>
                <dt>{label}</dt>
                <dd className={styles.keys}>
                  {chords.map((chord, index) => {
                    const visual = chord.map((key) => t(key)).join(' + ');
                    const spoken = chord.map((key) => t(arrowNames[key] ?? key)).join(' + ');
                    return (
                      <span className={styles.alternative} key={chord.join('+')}>
                        {index > 0 && <span className={arrowsOnly ? 'sr-only' : undefined}>{t('or')}</span>}
                        {visual === spoken ? (
                          <Kbd>{visual}</Kbd>
                        ) : (
                          <>
                            <span className="sr-only">{spoken}</span>
                            <span className={styles.key} aria-hidden="true">
                              <Kbd>{visual}</Kbd>
                            </span>
                          </>
                        )}
                      </span>
                    );
                  })}
                </dd>
              </div>
            );
          })}
        </dl>
      </dialog>
    </>
  );
}
