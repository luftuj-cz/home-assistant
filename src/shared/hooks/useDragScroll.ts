import { useRef, useEffect } from "react";

const EDGE_SIZE = 120;
const SCROLL_SPEED = 6;

interface UseDragAutoScrollOptions {
  edgeSize?: number;
  scrollSpeed?: number;
}

export function useDragAutoScroll(options: UseDragAutoScrollOptions = {}) {
  const { edgeSize = EDGE_SIZE, scrollSpeed = SCROLL_SPEED } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function handleDragOver(e: DragEvent) {
      const y = e.clientY;
      const viewportHeight = window.innerHeight;

      let scrollDelta = 0;
      if (y < edgeSize) {
        // Near top of viewport → scroll up
        const proximity = 1 - y / edgeSize;
        scrollDelta = -scrollSpeed * Math.max(0, Math.min(1, proximity));
      } else if (y > viewportHeight - edgeSize) {
        // Near bottom of viewport → scroll down
        const proximity = 1 - (viewportHeight - y) / edgeSize;
        scrollDelta = scrollSpeed * Math.max(0, Math.min(1, proximity));
      }

      if (scrollDelta !== 0) {
        rafId.current ??= requestAnimationFrame(function tick() {
          window.scrollBy(0, scrollDelta);
          rafId.current = requestAnimationFrame(tick);
        });
      } else if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    }

    function handleDragLeaveOrEnd() {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    }

    el.addEventListener("dragover", handleDragOver);
    el.addEventListener("dragleave", handleDragLeaveOrEnd);
    el.addEventListener("dragend", handleDragLeaveOrEnd);
    el.addEventListener("drop", handleDragLeaveOrEnd);

    return () => {
      el.removeEventListener("dragover", handleDragOver);
      el.removeEventListener("dragleave", handleDragLeaveOrEnd);
      el.removeEventListener("dragend", handleDragLeaveOrEnd);
      el.removeEventListener("drop", handleDragLeaveOrEnd);
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [edgeSize, scrollSpeed]);

  return { ref: containerRef };
}
