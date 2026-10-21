import { useState, useCallback, useEffect, useRef } from 'react';
import { CanvasDocument } from './types';

const MAX_HISTORY = 40;

function cloneDoc(doc: CanvasDocument): CanvasDocument {
  return {
    ...doc,
    adjustments: doc.adjustments ? { ...doc.adjustments } : undefined,
    layers: doc.layers.map((l) => {
      if (l.type === 'path') {
        return { ...l, points: l.points.map((p) => ({ ...p })) };
      }
      return { ...l };
    }),
  };
}

export function useCanvasHistory(initialDoc: CanvasDocument) {
  const [history, setHistory] = useState<CanvasDocument[]>([cloneDoc(initialDoc)]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);

  // Keep a ref to the current doc to avoid stale closures in event handlers
  const currentDocRef = useRef<CanvasDocument>(initialDoc);
  currentDocRef.current = history[currentIndex] || initialDoc;

  const pushDoc = useCallback(
    (newDoc: CanvasDocument) => {
      const cloned = cloneDoc(newDoc);
      setHistory((prev) => {
        const upToCurrent = prev.slice(0, currentIndex + 1);
        const updated = [...upToCurrent, cloned];
        if (updated.length > MAX_HISTORY) {
          return updated.slice(updated.length - MAX_HISTORY);
        }
        return updated;
      });
      setCurrentIndex((prev) => Math.min(prev + 1, MAX_HISTORY - 1));
    },
    [currentIndex],
  );

  const updateDocSilent = useCallback(
    (updater: (prev: CanvasDocument) => CanvasDocument) => {
      setHistory((prev) => {
        const updated = [...prev];
        const newDoc = updater(updated[currentIndex]);
        updated[currentIndex] = newDoc;
        return updated;
      });
    },
    [currentIndex],
  );

  const resetHistory = useCallback((newInitial: CanvasDocument) => {
    const cloned = cloneDoc(newInitial);
    setHistory([cloned]);
    setCurrentIndex(0);
  }, []);

  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < history.length - 1;

  const undo = useCallback(() => {
    if (canUndo) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [canUndo]);

  const redo = useCallback(() => {
    if (canRedo) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [canRedo]);

  // Global undo/redo keyboard listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return {
    document: history[currentIndex] || initialDoc,
    canUndo,
    canRedo,
    undo,
    redo,
    pushDoc,
    updateDocSilent,
    resetHistory,
  };
}
