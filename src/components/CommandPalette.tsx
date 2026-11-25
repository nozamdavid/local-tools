import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { TOOL_METAS, type ToolMeta } from '../tools/registry';
import { searchTools } from '../lib/search';
import { getMediaInfo } from '../design/media';
import { getToolIcon } from '../design/tool-icons';
import { Kbd, MediaTile } from './Controls';
import { useI18n } from '../lib/i18n';

const OPEN_EVENT = 'loconvert:open-search';

/** Opens the tool search palette from anywhere. */
export function openCommandPalette(query = '') {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: query }));
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const listId = useId();
  const { t, locale } = useI18n();

  const results: ToolMeta[] = useMemo(() => (query.trim() ? searchTools(query, 30) : []), [query, locale]);

  useEffect(() => {
    function show(initial: string) {
      if (!open) restoreFocus.current = document.activeElement as HTMLElement | null;
      setQuery(initial);
      setActive(0);
      setOpen(true);
    }
    function onOpen(event: Event) {
      show((event as CustomEvent<string>).detail ?? '');
    }
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable="true"]');
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (open) setOpen(false);
        else show('');
      } else if (event.key === '/' && !typing) {
        event.preventDefault();
        show('');
      }
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      // Return focus to whatever opened the palette; if that element has since left the page, fall back to the header search button.
      const opener = restoreFocus.current;
      restoreFocus.current = null;
      if (!opener) return;
      (opener.isConnected && opener.getClientRects().length > 0
        ? opener
        : document.querySelector<HTMLElement>('.site-header .search-trigger')
      )?.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  function close() {
    setOpen(false);
  }

  function choose(tool: ToolMeta | undefined) {
    if (!tool) return;
    close();
    if (tool.path === pathname) return;
    // Navigation moves focus to the new page, so skip the usual focus return.
    restoreFocus.current = null;
    navigate(tool.path);
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      (event.target === inputRef.current ? closeRef.current : inputRef.current)?.focus();
    } else if (event.target !== inputRef.current) {
      return;
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    }
  }

  return createPortal(
    <div className="palette-backdrop" onMouseDown={close}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('Search tools')}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-search">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={t('Search {count} tools, formats, or actions…', { count: TOOL_METAS.length })}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            aria-label={t('Search tools')}
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={results.length > 0 ? listId : undefined}
            aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            ref={closeRef}
            type="button"
            className="btn btn-ghost btn-icon palette-close"
            aria-label={t('Close search')}
            aria-keyshortcuts="Escape"
            onClick={close}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="sr-only" role="status">
          {query.trim()
            ? results.length > 0
              ? results.length === 1
                ? t('One result')
                : t('{count} results', { count: results.length })
              : t('No tools match')
            : ''}
        </div>

        <div className="palette-body">
          {results.length > 0 ? (
            <ul className="palette-list" id={listId} role="listbox" ref={listRef} aria-label={t('Tools')}>
              {results.map((tool, index) => {
                const mediaInfo = getMediaInfo(tool.media);
                const Icon = getToolIcon(tool);
                return (
                  <li
                    key={tool.id}
                    id={`${listId}-${tool.id}`}
                    role="option"
                    aria-selected={index === active}
                    data-index={index}
                    className="palette-item"
                    onMouseMove={() => setActive(index)}
                    onClick={() => choose(tool)}
                  >
                    <MediaTile media={tool.media} size="sm">
                      <Icon aria-hidden="true" />
                    </MediaTile>
                    <span className="palette-item-text">
                      <span className="palette-item-title">{tool.title}</span>
                    </span>
                    <span className="palette-item-media">{mediaInfo.label}</span>
                    <CornerDownLeft className="palette-item-enter" aria-hidden="true" />
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="empty-state">
              {query.trim() ? (
                <>
                  <div className="empty-state-title">{t('No tools match “{query}”', { query })}</div>
                  <div>{t('Try another format or action.')}</div>
                </>
              ) : (
                <div className="empty-state-title">{t('Search by tool, format, or action.')}</div>
              )}
            </div>
          )}
        </div>

        <div className="palette-footer">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> {t('to move')}
          </span>
          <span>
            <Kbd>↵</Kbd> {t('to open')}
          </span>
          <span className="palette-footer-privacy">{t('Search runs locally too.')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
