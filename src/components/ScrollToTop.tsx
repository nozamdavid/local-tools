import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Scrolls to the top on navigation, or to the #hash target when there is one. */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A literal percent sign is valid in an element ID.
    }
    // Wait a frame so the target section has rendered.
    const frame = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView();
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);

  return null;
}
