import { useState, useRef, useEffect, useId, type KeyboardEvent } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { categories, toolsByCategory, type Media } from '../tools/registry';

const MENUS: { media: Media; label: string }[] = [
  { media: 'file', label: 'File' },
  { media: 'video', label: 'Video' },
  { media: 'image', label: 'Image' },
  { media: 'pdf', label: 'PDF' },
];

interface NavMenuProps {
  media: Media;
  label: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

function NavMenu({ media, label, open, onToggle, onClose }: NavMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function focusItem(step: 1 | -1 | 'first') {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? []);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLAnchorElement);
    const next = step === 'first' ? 0 : (index + step + items.length) % items.length;
    items[next].focus();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) onToggle();
      // Wait for the menu to mount before moving focus into it.
      if (!open) setTimeout(() => focusItem('first'), 0);
      else focusItem(document.activeElement === triggerRef.current ? 'first' : 1);
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      focusItem(-1);
    }
  }

  return (
    <div className="dropdown" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="dropdown-trigger"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? menuId : undefined}
      >
        <span>{label}</span>
        <span style={{ fontSize: '0.75rem', marginLeft: '0.2rem' }}>▾</span>
      </button>

      {open && (
        <div id={menuId} className="dropdown-menu" ref={menuRef} aria-label={`${label} tools`}>
          <Link to={`/${media}`} className="dropdown-item dropdown-item-all" onClick={onClose}>
            <span>All {label.toLowerCase()} tools</span>
          </Link>
          {categories
            .filter((c) => c.media === media)
            .map((category) => (
              <div key={category.id} className="dropdown-group" role="group" aria-label={category.title}>
                <div className="dropdown-group-title">{category.title}</div>
                {toolsByCategory(category.id).map((tool) => (
                  <Link key={tool.id} to={tool.path} className="dropdown-item" onClick={onClose}>
                    <span className="dropdown-item-icon">{tool.icon}</span>
                    <span>{tool.title}</span>
                  </Link>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const [openMenu, setOpenMenu] = useState<Media | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const location = useLocation();

  useEffect(() => {
    setOpenMenu(null);
  }, [location.pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="layout">
      <header className="header">
        <div className="header-container">
          <Link to="/" className="brand-link">
            <img src="/assets/icon.svg" alt="Loconvert Logo" className="brand-logo" />
            <span>Loconvert</span>
          </Link>

          <nav className="nav-actions" ref={navRef}>
            <Link to="/file-converter" className="dropdown-trigger" style={{ textDecoration: 'none' }}>
              <span>🔄 Convert any file</span>
            </Link>
            {MENUS.map(({ media, label }) => (
              <NavMenu
                key={media}
                media={media}
                label={label}
                open={openMenu === media}
                onToggle={() => setOpenMenu((prev) => (prev === media ? null : media))}
                onClose={() => setOpenMenu(null)}
              />
            ))}
          </nav>
        </div>
      </header>

      <main className="main-content">
        <Outlet />
      </main>

      <footer className="footer">
        <div className="footer-badge">🔒 Private &amp; Secure</div>
        <p>100% on-device. Your files never leave your browser.</p>
      </footer>
    </div>
  );
}
