import { useLayoutEffect, type RefObject } from "react";

/**
 * One sliding indicator for segmented controls, the header nav and the tab bar. Measures the active child
 * (`selector`) and writes its box to CSS variables on the container (--ind-x/y/w/h/o). An absolutely positioned
 * indicator element reads them; it starts animating once the first position is set (`data-ind="ready"`), so it
 * does not fly in on mount. Follows font loading and resizing.
 */
export function useIndicator(
  ref: RefObject<HTMLElement | null>,
  selector: string,
  dependency: unknown,
) {
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) {
      return;
    }

    function place() {
      if (!container) {
        return;
      }
      const active = container.querySelector<HTMLElement>(selector);
      if (!active) {
        container.style.setProperty("--ind-o", "0");
        return;
      }
      container.style.setProperty("--ind-x", `${active.offsetLeft}px`);
      container.style.setProperty("--ind-y", `${active.offsetTop}px`);
      container.style.setProperty("--ind-w", `${active.offsetWidth}px`);
      container.style.setProperty("--ind-h", `${active.offsetHeight}px`);
      container.style.setProperty("--ind-o", "1");
    }

    place();
    const frame = requestAnimationFrame(() => container.setAttribute("data-ind", "ready"));
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(container);
    for (const child of Array.from(container.children)) {
      observer?.observe(child);
    }
    void document.fonts?.ready.then(place);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [ref, selector, dependency]);
}

/**
 * Classes for the indicator element. It glides between items in 240ms with ease-in-out and no overshoot
 * (a spring read as too aggressive).
 */
export const indicatorClass =
  "pointer-events-none absolute top-0 left-0 z-0 h-[var(--ind-h,0px)] w-[var(--ind-w,0px)] translate-x-[var(--ind-x,0px)] translate-y-[var(--ind-y,0px)] opacity-[var(--ind-o,0)] in-data-[ind=ready]:transition-[translate,width,height,opacity] in-data-[ind=ready]:duration-240 in-data-[ind=ready]:ease-(--ease-in-out)";
