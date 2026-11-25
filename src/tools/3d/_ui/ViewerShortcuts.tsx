import { useId, type KeyboardEvent, type Ref } from 'react';
import { ChevronDown } from 'lucide-react';
import { Kbd } from '../../../components/Controls';
import { useI18n } from '../../../lib/i18n';
import styles from './MeshViewer.module.css';

interface ViewerShortcutsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buttonRef: Ref<HTMLButtonElement>;
  onReturnToViewport: () => void;
}

export function ViewerShortcuts({ open, onOpenChange, buttonRef, onReturnToViewport }: ViewerShortcutsProps) {
  const { t } = useI18n();
  const guideId = useId();
  const arrows = '↑ ↓ ← →';
  const groups = [
    {
      title: 'Camera controls',
      shortcuts: [
        ['Orbit', 'O'],
        ['Pan', 'P'],
        ['Move in the selected mode', arrows, t('Arrow keys')],
        ['Pan temporarily', `${t('Shift')} + ${arrows}`, t('Shift and arrow keys')],
        ['Zoom in', t('+ or ='), t('Plus or equals')],
        ['Zoom out', '-', t('Minus')],
        ['Fit model to view', 'F'],
      ],
    },
    {
      title: 'Camera view',
      shortcuts: [
        ['Isometric', '0'],
        ['Front', '1'],
        ['Back', '2'],
        ['Left', '3'],
        ['Right', '4'],
        ['Top', '5'],
        ['Bottom', '6'],
      ],
    },
    {
      title: 'View settings',
      shortcuts: [
        ['Solid', 'S'],
        ['Wireframe', 'W'],
        ['Normals', 'N'],
        ['Next environment', 'E'],
        ['Toggle grid', 'G'],
        ['Toggle axes', 'X'],
        ['Focus light intensity', 'L'],
        ['Focus first position input', 'T'],
      ],
    },
    {
      title: 'Shortcut guide',
      shortcuts: [
        ['Toggle guide', '?', t('Question mark')],
        ['Close guide', t('Esc'), t('Escape key')],
      ],
    },
  ];

  function handleToggleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key !== '?' && (event.key !== 'Escape' || event.shiftKey)) return;

    event.preventDefault();
    onOpenChange(false);
    onReturnToViewport();
  }

  return (
    <div className={styles.shortcuts}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.shortcutsToggle}
        aria-expanded={open}
        aria-controls={guideId}
        aria-keyshortcuts="?"
        onClick={() => onOpenChange(!open)}
        onKeyDown={handleToggleKey}
      >
        <ChevronDown size={14} aria-hidden="true" className={styles.shortcutsChevron} />
        {t('Keyboard shortcuts')}
        <span aria-hidden="true">
          <Kbd>?</Kbd>
        </span>
      </button>
      <div id={guideId} hidden={!open} className={styles.shortcutsGuide}>
        <p>{t('Click the model or press Tab until the 3D viewport has focus to use these shortcuts.')}</p>
        <div className={styles.shortcutsGroups}>
          {groups.map(({ title, shortcuts }) => (
            <div key={title}>
              <h3>{t(title)}</h3>
              <dl className={styles.shortcutsList}>
                {shortcuts.map(([action, key, spokenKey]) => (
                  <div key={action}>
                    <dt>{t(action)}</dt>
                    <dd>
                      {spokenKey ? (
                        <>
                          <span className="sr-only">{spokenKey}</span>
                          <span aria-hidden="true">
                            <Kbd>{key}</Kbd>
                          </span>
                        </>
                      ) : (
                        <Kbd>{key}</Kbd>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
