import { useEffect, useId, useRef, useState } from 'react';
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

function MobileNav({ onClose }: { onClose: () => void }) {
  return (
    <div className="mobile-nav" role="dialog" aria-modal="true" aria-label="Menu">
      <button
        type="button"
        className="search-trigger search-trigger-block"
        onClick={() => {
          onClose();
          openCommandPalette();
        }}
      >
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
    </div>
  );
}

export function Layout() {
  const [openMenu, setOpenMenu] = useState<Media | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const megaId = useId();

  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
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
      if (event.key === 'Escape') {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openMenu, mobileOpen]);

  const activeMedia = MEDIA_LIST.find(
    (m) => location.pathname === m.path || TOOL_METAS.some((t) => t.media === m.media && t.path === location.pathname),
  )?.media;

  return (
    <div className="layout">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <header className="site-header" ref={headerRef}>
        <div className="container header-inner">
          <Link to="/" className="brand" aria-label="Loconvert home">
            <LogoMark />
            <span className="brand-name">Loconvert</span>
          </Link>

          <nav className="primary-nav" aria-label="Tool categories">
            {MEDIA_LIST.map(({ media, label }) => {
              const open = openMenu === media;
              return (
                <button
                  key={media}
                  type="button"
                  className={`nav-trigger ${open ? 'is-open' : ''} ${activeMedia === media ? 'is-active' : ''}`}
                  aria-expanded={open}
                  aria-controls={open ? megaId : undefined}
                  onClick={() => setOpenMenu(open ? null : media)}
                >
                  {label}
                  <ChevronDown aria-hidden="true" />
                </button>
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
              type="button"
              className="btn btn-ghost btn-icon menu-toggle"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>

        {openMenu && <MegaMenu media={openMenu} id={megaId} onClose={() => setOpenMenu(null)} />}
        {mobileOpen && <MobileNav onClose={() => setMobileOpen(false)} />}
      </header>

      {(openMenu || mobileOpen) && <div className="nav-scrim" aria-hidden="true" />}

      <main id="main" className="main-content">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <Link to="/" className="brand">
              <LogoMark size={26} />
              <span className="brand-name">Loconvert</span>
            </Link>
            <p>
              Private file tools that run entirely in your browser. Your files are processed on your device and never uploaded.
            </p>
            <span className="badge badge-success">
              <ShieldCheck />
              No uploads · No accounts · No tracking
            </span>
          </div>

          <div className="footer-col">
            <div className="footer-col-title">Tools</div>
            {MEDIA_LIST.map((m) => (
              <Link key={m.media} to={m.path}>
                {m.title}
              </Link>
            ))}
          </div>

          <div className="footer-col">
            <div className="footer-col-title">Popular</div>
            <Link to="/file-converter">File converter</Link>
            <Link to="/image/compress">Compress image</Link>
            <Link to="/pdf/merge">Merge PDF</Link>
            <Link to="/video/trim">Trim video</Link>
          </div>

          <div className="footer-col">
            <div className="footer-col-title">Project</div>
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
