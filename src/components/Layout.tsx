import React, { useEffect, useId, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Menu, Search, X } from 'lucide-react';
import { TOOL_METAS, type Media } from '../tools/registry';
import { MEDIA_LIST, localizeMediaInfo } from '../design/media';
import { CommandPalette, openCommandPalette } from './CommandPalette';
import { Kbd } from './Controls';
import { LogoMark } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { LanguageSwitcher } from './LanguageSwitcher';
import { translate, useI18n } from '../lib/i18n';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function MobileNav({
  id,
  onNavigate,
  activeMedia,
  pathname,
}: {
  id: string;
  onNavigate: (path: string) => void;
  activeMedia: Media | undefined;
  pathname: string;
}) {
  const { t } = useI18n();
  return (
    <nav className="mobile-nav" id={id} aria-label={t('Tool categories')}>
      <div className="mobile-nav-links">
        {MEDIA_LIST.map((rawInfo) => {
          const info = localizeMediaInfo(rawInfo);
          const Icon = info.icon;
          const active = activeMedia === info.media;
          return (
            <Link
              key={info.media}
              to={info.path}
              className={`mobile-nav-link ${active ? 'is-active' : ''}`}
              aria-current={pathname === info.path ? 'page' : undefined}
              onClick={() => onNavigate(info.path)}
            >
              <Icon aria-hidden="true" />
              {info.title}
            </Link>
          );
        })}
        <Link to="/file-converter" className="mobile-nav-link" onClick={() => onNavigate('/file-converter')}>
          {t('Convert any file')}
        </Link>
      </div>
    </nav>
  );
}

/** Document title for the current route, so each page has its own name in tabs, history and screen readers. */
function titleForPath(pathname: string): string | null {
  if (pathname === '/') return translate('Tools. In your browser.');
  const tool = TOOL_METAS.find((t) => t.path === pathname);
  if (tool) return translate(tool.title);
  const media = MEDIA_LIST.find((m) => m.path === pathname);
  if (media) return localizeMediaInfo(media).title;
  if (pathname === '/design') return translate('Design system');
  return translate('Page not found');
}

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const previousPath = useRef<string | null>(null);
  const location = useLocation();
  const mobileId = useId();
  const { t, locale } = useI18n();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.hash]);

  // Name each page, and move focus to the main region after in-app navigation so keyboard and
  // screen reader users start at the new content instead of the link they just activated.
  useEffect(() => {
    const name = titleForPath(location.pathname);
    if (name) document.title = `${name} · Loconvert`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', translate('Free image, PDF, video and file tools that run entirely in your browser. Nothing is uploaded.'));
    if (previousPath.current !== null && previousPath.current !== location.pathname && !location.hash) {
      mainRef.current?.focus({ preventScroll: true });
    }
    previousPath.current = location.pathname;
  }, [location.pathname, location.hash, locale]);

  useEffect(() => {
    if (!mobileOpen) return;
    const desktop = window.matchMedia('(width > 860px)');
    function handleResize(event: MediaQueryListEvent) {
      if (event.matches) setMobileOpen(false);
    }
    function handlePointer(event: MouseEvent) {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) setMobileOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setMobileOpen(false);
      menuToggleRef.current?.focus();
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    desktop.addEventListener('change', handleResize);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      desktop.removeEventListener('change', handleResize);
    };
  }, [mobileOpen]);

  // Tabbing out of the mobile menu closes it.
  function handleHeaderBlur(event: React.FocusEvent<HTMLElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) setMobileOpen(false);
  }

  function openSearch() {
    setMobileOpen(false);
    openCommandPalette();
  }

  const activeMedia = MEDIA_LIST.find(
    (m) => location.pathname === m.path || TOOL_METAS.some((t) => t.media === m.media && t.path === location.pathname),
  )?.media;
  const mediaList = MEDIA_LIST.map(localizeMediaInfo);

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
        {t('Skip to content')}
      </a>

      <header className="site-header" ref={headerRef} onBlur={handleHeaderBlur}>
        <div className="container header-inner">
          <Link to="/" className="brand" aria-label={t('Loconvert home')}>
            <LogoMark />
            <span className="brand-name">Loconvert</span>
          </Link>

          <nav className="primary-nav" aria-label={t('Tool categories')}>
            {mediaList.map(({ media, label, path }) => {
              const active = activeMedia === media;
              return (
                <Link
                  key={media}
                  to={path}
                  className={`nav-trigger ${active ? 'is-active' : ''}`}
                  aria-current={location.pathname === path ? 'page' : undefined}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="header-actions">
            <button type="button" className="search-trigger" aria-label={t('Search all tools')} onClick={openSearch}>
              <Search aria-hidden="true" />
              <span className="search-trigger-label">{t('Search tools')}</span>
              <span className="search-trigger-keys" aria-hidden="true">
                <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <LanguageSwitcher />
            <ThemeToggle />
            <button
              ref={menuToggleRef}
              type="button"
              className="btn btn-ghost btn-icon menu-toggle"
              aria-label={mobileOpen ? t('Close menu') : t('Open menu')}
              aria-expanded={mobileOpen}
              aria-controls={mobileOpen ? mobileId : undefined}
              onClick={() => setMobileOpen((value) => !value)}
            >
              {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <MobileNav
            id={mobileId}
            activeMedia={activeMedia}
            pathname={location.pathname}
            onNavigate={(path) => {
              setMobileOpen(false);
              if (path === location.pathname) menuToggleRef.current?.focus();
            }}
          />
        )}
      </header>

      <main id="main" className="main-content" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="container footer-bottom">
          <span>{t('Powered by WebAssembly, WebCodecs and WebGPU.')}</span>
          <span>
            <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>+<Kbd>K</Kbd> {t('to search')}
          </span>
        </div>
      </footer>

      <CommandPalette />
    </div>
  );
}
