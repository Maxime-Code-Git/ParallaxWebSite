import { useCallback, useEffect, useEffectEvent, useRef, type RefObject, type TouchEvent } from "react";

const wheelIdleMs = 110;
const wheelThresholdPx = 32;
const settleDurationMs = 160;
type Direction = -1 | 1;

function translatePhoto(offset: number): Keyframe {
  return { transform: `translateX(${offset}px)` };
}

export function usePhotoSwipe(
  viewerRef: RefObject<HTMLDivElement | null>,
  navigate: (direction: Direction) => boolean,
  enabled: boolean,
) {
  const start = useRef<{ surface: HTMLDivElement; id: number; x: number; y: number } | null>(null);
  const motion = useRef<Animation | null>(null);
  const incoming = useRef<Direction | null>(null);
  const navigateFromWheel = useEffectEvent(navigate);

  const animatePhoto = useCallback((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    motion.current?.cancel();
    motion.current = null;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const image = viewerRef.current?.querySelector("img");
    if (typeof image?.animate === "function") motion.current = image.animate(frames, options);
  }, [viewerRef]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!enabled || !viewer) return;

    let previousWheelTime = -Infinity;
    let distance = 0;
    let advanced: Direction | null = null;
    let timeout: number | undefined;
    const settle = (offset: number) => animatePhoto([translatePhoto(offset), translatePhoto(0)], {
      duration: settleDurationMs,
      easing: "ease-out",
    });

    const onWheel = (event: WheelEvent) => {
      const mode = event.deltaMode;
      const { deltaX, deltaY, timeStamp } = event;
      if (event.ctrlKey || event.metaKey || Math.abs(deltaX) <= 1.1 * Math.abs(deltaY)) return;

      // Stop horizontal scroll and browser history navigation over the open viewer.
      event.preventDefault();
      if (timeStamp - previousWheelTime >= wheelIdleMs) {
        distance = 0;
        advanced = null;
      }
      previousWheelTime = timeStamp;
      window.clearTimeout(timeout);

      const direction = deltaX > 0 ? 1 : -1;
      if (direction === advanced) {
        if (distance !== 0) settle(-distance);
        distance = 0;
        return;
      }

      const unit = mode === WheelEvent.DOM_DELTA_LINE ? 16 : mode === WheelEvent.DOM_DELTA_PAGE ? viewer.clientWidth : 1;
      distance = Math.sign(distance) === direction ? distance + deltaX * unit : deltaX * unit;
      const offset = -direction * Math.min(Math.abs(distance), wheelThresholdPx);

      if (Math.abs(distance) < wheelThresholdPx) {
        // Keep following intentional movement through light diagonal input, without replaying momentum.
        animatePhoto([translatePhoto(offset)], { duration: 0, fill: "forwards" });
        timeout = window.setTimeout(() => {
          distance = 0;
          settle(offset);
        }, wheelIdleMs);
        return;
      }

      advanced = direction;
      distance = 0;
      if (navigateFromWheel(direction)) incoming.current = direction;
      settle(offset);
    };

    viewer.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      viewer.removeEventListener("wheel", onWheel);
      window.clearTimeout(timeout);
      incoming.current = null;
      motion.current?.cancel();
      motion.current = null;
    };
  }, [animatePhoto, enabled, viewerRef]);

  function onPhotoLoad() {
    const direction = incoming.current;
    incoming.current = null;
    if (direction === null) return;
    animatePhoto([{ ...translatePhoto(direction * 44), opacity: 0.65 }, { ...translatePhoto(0), opacity: 1 }], {
      duration: settleDurationMs,
      easing: "ease-out",
    });
  }

  function onPhotoError() {
    incoming.current = null;
  }

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

  return { touchHandlers: { onTouchStart, onTouchEnd, onTouchCancel }, onPhotoLoad, onPhotoError };
}
