import { useLayoutEffect, type RefObject } from 'react';

/**
 * Tool views swap whole panels (drop zone, form, result). When the element that holds focus is removed with the panel,
 * the browser drops focus to the document body and keyboard users lose their place. This hands focus to the main region
 * instead, unless something else (for example a result panel that focuses itself) has already taken it.
 */
export function useFocusFallback(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (!node?.contains(document.activeElement)) return;
      requestAnimationFrame(() => {
        if (!document.activeElement || document.activeElement === document.body) {
          document.getElementById('main')?.focus({ preventScroll: true });
        }
      });
    };
  }, [ref]);
}
