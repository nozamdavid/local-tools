import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { TOOL_METAS, type ToolMeta } from '../tools/registry';
import { searchTools } from '../lib/search';
import { MEDIA_INFO } from '../design/media';
import { Kbd, MediaTile } from './Controls';

const OPEN_EVENT = 'loconvert:open-search';

/** Opens the tool search palette from anywhere. */
export function openCommandPalette(query = '') {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: query }));
}

const SUGGESTED = TOOL_METAS.filter((t) => t.popular).slice(0, 8);

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const listId = useId();

  const results: ToolMeta[] = useMemo(() => (query.trim() ? searchTools(query, 30) : SUGGESTED), [query]);

  useEffect(() => {
    function show(initial: string) {
      restoreFocus.current = document.activeElement as HTMLElement | null;
      setQuery(initial);
      setActive(0);
      setOpen(true);
    }
    function onOpen(event: Event) {
      show((event as CustomEvent<string>).detail ?? '');
    }
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable="true"]');
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((was) => {
          if (!was) restoreFocus.current = document.activeElement as HTMLElement | null;
          return !was;
        });
        setQuery('');
        setActive(0);
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
  }, []);

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
      (opener.isConnected ? opener : document.querySelector<HTMLElement>('.site-header .search-trigger'))?.focus?.();
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
    // Navigation moves focus to the new page, so skip the usual focus return.
    restoreFocus.current = null;
    close();
    navigate(tool.path);
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      // Keep focus in the input; the list is navigated with arrows.
      event.preventDefault();
    }
  }

  return createPortal(
    <div className="palette-backdrop" onMouseDown={close}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search tools"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-search">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={`Search ${TOOL_METAS.length} tools…  e.g. “heic to jpg”, “merge pdf”`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            aria-label="Search tools"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={results.length > 0 ? listId : undefined}
            aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
          />
          <Kbd>Esc</Kbd>
        </div>

        <div className="sr-only" role="status">
          {query.trim() ? (results.length > 0 ? `${results.length} result${results.length === 1 ? '' : 's'}` : 'No tools match') : ''}
        </div>

        <div className="palette-body" tabIndex={0}>
          {results.length > 0 ? (
            <>
              <div className="palette-group-label">
                {query.trim() ? `${results.length} result${results.length === 1 ? '' : 's'}` : 'Popular tools'}
              </div>
              <ul className="palette-list" id={listId} role="listbox" ref={listRef} aria-label="Tools">
                {results.map((tool, index) => (
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
                      {tool.icon}
                    </MediaTile>
                    <span className="palette-item-text">
                      <span className="palette-item-title">{tool.title}</span>
                      <span className="palette-item-desc">{tool.description}</span>
                    </span>
                    <span className="palette-item-media">{MEDIA_INFO[tool.media].label}</span>
                    <CornerDownLeft className="palette-item-enter" aria-hidden="true" />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="empty-state">
              <Search aria-hidden="true" />
              <div className="empty-state-title">No tools match “{query}”</div>
              <div>Try a format (png, mp4, docx) or an action (compress, merge, crop).</div>
            </div>
          )}
        </div>

        <div className="palette-footer">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
          </span>
          <span>
            <Kbd>↵</Kbd> to open
          </span>
          <span className="palette-footer-privacy">Search runs locally too.</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
