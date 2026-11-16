import { useRef, type TouchEvent } from "react";

export function usePhotoSwipe(navigate: (direction: -1 | 1) => void, enabled: boolean) {
  const start = useRef<{ surface: HTMLDivElement; id: number; x: number; y: number } | null>(null);

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    start.current = null;
    if (!enabled || event.touches.length !== 1 ||
      (event.target instanceof Element && event.target.closest("a, button"))) return;

    const touch = event.touches[0];
    start.current = { surface: event.currentTarget, id: touch.identifier, x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const gesture = start.current;
    start.current = null;
    if (!enabled || !gesture || gesture.surface !== event.currentTarget ||
      event.touches.length !== 0 || event.changedTouches.length !== 1) return;

    const touch = event.changedTouches[0];
    if (touch.identifier !== gesture.id) return;
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    if (Math.abs(dx) >= 45 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      navigate(dx < 0 ? 1 : -1);
    }
  }

  function onTouchCancel() {
    start.current = null;
  }

  return { onTouchStart, onTouchEnd, onTouchCancel };
}
