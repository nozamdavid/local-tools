import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { VideoEdit } from './engine';

type Segments = VideoEdit['segments'];
type Grab = {
  pointerId: number;
  index: number;
  startX: number;
  segments: Segments;
  active: boolean;
  cancelled: boolean;
};

function dropAt(track: HTMLDivElement, x: number, y: number, { index, segments }: Grab) {
  const bounds = track.getBoundingClientRect();
  if (y < bounds.top - 12 || y > bounds.bottom + 12) return null;

  let slot = 0;
  for (; slot < segments.length; slot += 1) {
    const clip = track.children[slot].getBoundingClientRect();
    if (x < clip.left + clip.width / 2) break;
  }

  // The two gaps touching the clip give the same order.
  const destination = slot > index ? slot - 1 : slot;
  if (destination === index) return null;
  const edge = slot === segments.length ? bounds.right : track.children[slot].getBoundingClientRect().left;
  return { destination, marker: edge - bounds.left };
}

export function useClipDrag(segments: Segments, onDrop: (from: number, to: number) => void) {
  const grab = useRef<Grab | null>(null);
  const suppressClick = useRef(false);
  const [feedback, setFeedback] = useState<{ index: number; marker: number | null; segments: Segments } | null>(null);

  useEffect(() => {
    function cancel(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !grab.current?.active) return;
      grab.current.cancelled = true;
      setFeedback(null);
    }

    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);

  function start(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (!event.isPrimary || event.button !== 0 || grab.current) return;
    suppressClick.current = false;
    if (segments.length < 2) return;
    grab.current = {
      pointerId: event.pointerId,
      index,
      startX: event.clientX,
      segments,
      active: false,
      cancelled: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = grab.current;
    if (current?.pointerId !== event.pointerId || current.cancelled || current.segments !== segments) return;
    if (!current.active && Math.abs(event.clientX - current.startX) < 6) return;

    current.active = true;
    const marker = dropAt(event.currentTarget, event.clientX, event.clientY, current)?.marker ?? null;
    setFeedback((previous) =>
      previous?.index === current.index && previous.marker === marker && previous.segments === segments
        ? previous
        : { index: current.index, marker, segments },
    );
  }

  function clear(event: PointerEvent<HTMLDivElement>) {
    if (grab.current?.pointerId !== event.pointerId) return;
    suppressClick.current = grab.current.active;
    grab.current = null;
    setFeedback(null);
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const current = grab.current;
    if (current?.pointerId !== event.pointerId) return;
    clear(event);
    if (!current.active || current.cancelled || current.segments !== segments) return;
    const track = event.currentTarget;
    const drop = dropAt(track, event.clientX, event.clientY, current);
    if (!drop) return;

    onDrop(current.index, drop.destination);
    if (document.activeElement === track.children[current.index]) {
      (track.children[drop.destination] as HTMLButtonElement).focus({ preventScroll: true });
    }
  }

  function preventDragClick(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current || event.detail === 0) return;
    suppressClick.current = false;
    event.stopPropagation();
  }

  return {
    start,
    feedback: feedback?.segments === segments ? feedback : null,
    trackEvents: {
      onPointerMove: move,
      onPointerUp: finish,
      onPointerCancel: clear,
      onLostPointerCapture: clear,
      onClickCapture: preventDragClick,
    },
  };
}
