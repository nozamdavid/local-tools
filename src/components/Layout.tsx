import React, { Fragment, useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, Menu, Search, ShieldCheck, X } from 'lucide-react';
import { categories, toolsByCategory, toolsByMedia, TOOL_METAS, type Media } from '../tools/registry';
import { MEDIA_INFO, MEDIA_LIST } from '../design/media';
import { CommandPalette, openCommandPalette } from './CommandPalette';
import { Kbd, MediaTile } from './Controls';
import { LogoMark } from './Logo';
import { ThemeToggle } from './ThemeToggle';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function MegaMenu({ media, id, onClose }: { media: Media; id: string; onClose: () => void }) {
  const info = MEDIA_INFO[media];
  const Icon = info.icon;
  const count = toolsByMedia(media).length;

  return (
    <div className="mega" id={id} role="region" aria-label={`${info.label} tools`}>
      <div className="container mega-inner">
        <div className="mega-intro" data-media={media}>
          <MediaTile media={media} size="lg">
            <Icon />
          </MediaTile>
          <div className="mega-intro-title">{info.title}</div>
          <p className="mega-intro-desc">{info.description}</p>
          <Link to={info.path} className="section-link" onClick={onClose}>
            Browse all {count}
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
        <div className="mega-columns">
          {categories
            .filter((c) => c.media === media)
            .map((category) => (
              <div key={category.id} className="mega-col">
                <Link to={`${info.path}#${category.id}`} className="mega-col-title" onClick={onClose}>
                  {category.title}
                </Link>
                <ul>
                  {toolsByCategory(category.id).map((tool) => (
                    <li key={tool.id}>
                      <Link to={tool.path} className="mega-link" onClick={onClose}>
                        <span className="mega-link-icon" aria-hidden="true">
                          {tool.icon}
                        </span>
                        {tool.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function MobileNav({ id, onClose, onSearch }: { id: string; onClose: () => void; onSearch: () => void }) {
  return (
    <nav className="mobile-nav" id={id} aria-label="Menu">
      <button type="button" className="search-trigger search-trigger-block" onClick={onSearch}>
        <Search aria-hidden="true" />
        <span>Search {TOOL_METAS.length} tools</span>
      </button>
      {MEDIA_LIST.map((info) => (
        <details key={info.media} className="mobile-nav-group">
          <summary>
            <MediaTile media={info.media} size="sm">
              <info.icon />
            </MediaTile>
            {info.title}
            <ChevronDown className="mobile-nav-chevron" aria-hidden="true" />
          </summary>
          <Link to={info.path} className="mobile-nav-all" onClick={onClose}>
            All {info.label.toLowerCase()} tools
          </Link>
          {categories
            .filter((c) => c.media === info.media)
            .map((category) => (
              <div key={category.id} className="mobile-nav-category">
                <div className="mobile-nav-category-title">{category.title}</div>
                {toolsByCategory(category.id).map((tool) => (
                  <Link key={tool.id} to={tool.path} className="mega-link" onClick={onClose}>
                    <span className="mega-link-icon" aria-hidden="true">
                      {tool.icon}
                    </span>
                    {tool.title}
                  </Link>
                ))}
              </div>
            ))}
        </details>
      ))}
    </nav>
  );
}

/** Document title for the current route, so each page has its own name in tabs, history and screen readers. */
function titleForPath(pathname: string): string | null {
  const tool = TOOL_METAS.find((t) => t.path === pathname);
  if (tool) return tool.title;
  const media = MEDIA_LIST.find((m) => m.path === pathname);
  if (media) return media.title;
  if (pathname === '/design') return 'Design system';
  return null;
}

export function Layout() {
  const [openMenu, setOpenMenu] = useState<Media | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const previousPath = useRef<string | null>(null);
  const location = useLocation();
  const megaId = useId();
  const mobileId = useId();

  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, [location.pathname, location.hash]);

  // Name each page, and move focus to the main region after in-app navigation so keyboard and
  // screen reader users start at the new content instead of the link they just activated.
  useEffect(() => {
    const name = titleForPath(location.pathname);
    if (name) document.title = `${name} · Loconvert`;
    if (previousPath.current !== null && previousPath.current !== location.pathname && !location.hash) {
      mainRef.current?.focus({ preventScroll: true });
    }
    previousPath.current = location.pathname;
  }, [location.pathname, location.hash]);

  useEffect(() => {
    if (!openMenu && !mobileOpen) return;
    function handlePointer(event: MouseEvent) {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Hand focus back to the control that opened the menu.
      const trigger = openMenu ? headerRef.current?.querySelector<HTMLElement>(`[data-nav-media="${openMenu}"]`) : menuToggleRef.current;
      setOpenMenu(null);
      setMobileOpen(false);
      trigger?.focus();
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openMenu, mobileOpen]);

  // Tabbing out of the header closes whichever menu is open.
  function handleHeaderBlur(event: React.FocusEvent<HTMLElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) {
      setOpenMenu(null);
      setMobileOpen(false);
    }
  }

  function openSearchFromMobileNav() {
    setMobileOpen(false);
    // The menu button is where focus returns when the palette closes; the nav that held the search button unmounts.
    menuToggleRef.current?.focus();
    openCommandPalette();
  }

  const activeMedia = MEDIA_LIST.find(
    (m) => location.pathname === m.path || TOOL_METAS.some((t) => t.media === m.media && t.path === location.pathname),
  )?.media;

  return (
    <div className="layout">
      <a
        href="#main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>

      <header className="site-header" ref={headerRef} onBlur={handleHeaderBlur}>
        <div className="container header-inner">
          <Link to="/" className="brand" aria-label="Loconvert home">
            <LogoMark />
            <span className="brand-name">Loconvert</span>
          </Link>

          <nav className="primary-nav" aria-label="Tool categories">
            {MEDIA_LIST.map(({ media, label }) => {
              const open = openMenu === media;
              return (
                <Fragment key={media}>
                  <button
                    type="button"
                    data-nav-media={media}
                    className={`nav-trigger ${open ? 'is-open' : ''} ${activeMedia === media ? 'is-active' : ''}`}
                    aria-expanded={open}
                    aria-controls={open ? megaId : undefined}
                    onClick={() => setOpenMenu(open ? null : media)}
                  >
                    {label}
                    <ChevronDown aria-hidden="true" />
                  </button>
                  {/* Rendered right after its trigger so Tab moves from the button into the open menu. */}
                  {open && <MegaMenu media={media} id={megaId} onClose={() => setOpenMenu(null)} />}
                </Fragment>
              );
            })}
            <NavLink to="/file-converter" className={({ isActive }) => `nav-trigger ${isActive ? 'is-active' : ''}`}>
              Convert any file
            </NavLink>
          </nav>

          <div className="header-actions">
            <button type="button" className="search-trigger" onClick={() => openCommandPalette()}>
              <Search aria-hidden="true" />
              <span className="search-trigger-label">Search tools</span>
              <span className="search-trigger-keys" aria-hidden="true">
                <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <ThemeToggle />
            <button
              ref={menuToggleRef}
              type="button"
              className="btn btn-ghost btn-icon menu-toggle"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              aria-controls={mobileOpen ? mobileId : undefined}
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
          </div>
        </div>

        {mobileOpen && <MobileNav id={mobileId} onClose={() => setMobileOpen(false)} onSearch={openSearchFromMobileNav} />}
      </header>

      {(openMenu || mobileOpen) && <div className="nav-scrim" aria-hidden="true" />}

      <main id="main" className="main-content" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <Link to="/" className="brand">
              <LogoMark size={26} />
              <span className="brand-name">Loconvert</span>
            </Link>
            <p>Private file tools that run entirely in your browser. Your files are processed on your device and never uploaded.</p>
            <span className="badge badge-success">
              <ShieldCheck />
              No uploads · No accounts · No tracking
            </span>
          </div>

          <div className="footer-col">
            <h2 className="footer-col-title">Tools</h2>
            {MEDIA_LIST.map((m) => (
              <Link key={m.media} to={m.path}>
                {m.title}
              </Link>
            ))}
          </div>

          <div className="footer-col">
            <h2 className="footer-col-title">Popular</h2>
            <Link to="/file-converter">File converter</Link>
            <Link to="/image/compress">Compress image</Link>
            <Link to="/pdf/merge">Merge PDF</Link>
            <Link to="/video/trim">Trim video</Link>
          </div>

          <div className="footer-col">
            <h2 className="footer-col-title">Project</h2>
            <Link to="/design">Design system</Link>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>Powered by WebAssembly, WebCodecs and WebGPU.</span>
          <span>
            Press <Kbd>/</Kbd> to search
          </span>
        </div>
      </footer>

      <CommandPalette />
    </div>
  );
}
