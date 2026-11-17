import { useEffect, useEffectEvent, useRef, type RefObject, type TouchEvent } from "react";

const wheelIdleMs = 200;
const wheelThresholdPx = 55;

export function usePhotoSwipe(
  viewerRef: RefObject<HTMLDivElement | null>,
  navigate: (direction: -1 | 1) => void,
  enabled: boolean,
) {
  const start = useRef<{ surface: HTMLDivElement; id: number; x: number; y: number } | null>(null);
  const navigateFromWheel = useEffectEvent(navigate);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!enabled || !viewer) return;

    let previousWheelTime = -Infinity;
    let distance = 0;
    let advanced = false;

    const onWheel = (event: WheelEvent) => {
      const mode = event.deltaMode;
      const { deltaX, deltaY, timeStamp } = event;
      if (event.ctrlKey || event.metaKey || Math.abs(deltaX) <= 1.5 * Math.abs(deltaY)) return;

      // Stop horizontal scroll and browser history navigation over the open viewer.
      event.preventDefault();
      if (timeStamp - previousWheelTime >= wheelIdleMs) {
        distance = 0;
        advanced = false;
      }
      previousWheelTime = timeStamp;
      if (advanced) return;

      const unit = mode === WheelEvent.DOM_DELTA_LINE ? 16 : mode === WheelEvent.DOM_DELTA_PAGE ? viewer.clientWidth : 1;
      distance += deltaX * unit;
      if (Math.abs(distance) < wheelThresholdPx) return;

      // Trackpad momentum continues to emit events after the fingers are lifted.
      advanced = true;
      navigateFromWheel(distance > 0 ? 1 : -1);
    };

    viewer.addEventListener("wheel", onWheel, { passive: false });
    return () => viewer.removeEventListener("wheel", onWheel);
  }, [enabled, viewerRef]);

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
