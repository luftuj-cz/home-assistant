import { useLayoutEffect, useRef } from "react";

const NUMBER = /^(-?\d+)(?:([.,])(\d+))?$/;
const DURATION = 700;

function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

interface AnimatedNumberProps {
  /** A pre-formatted value ("21.4", "65", "1,5"). Anything that is not a plain number ("—", text) shows as it is. */
  value: string | number;
  className?: string;
}

/**
 * A live readout that counts from the old value to the new one over 700ms. Frames are written straight to the DOM,
 * so there is no React render per frame. Under reduced motion it jumps to the value.
 */
export function AnimatedNumber({ value, className }: Readonly<AnimatedNumberProps>) {
  const text = String(value);
  const ref = useRef<HTMLSpanElement>(null);
  const current = useRef<number>(Number.NaN);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const match = NUMBER.exec(text.trim());
    const target = match ? Number.parseFloat(text.replace(",", ".")) : Number.NaN;
    const from = current.current;

    if (!match || !Number.isFinite(from) || from === target || prefersReducedMotion()) {
      current.current = target;
      el.textContent = text;
      return;
    }

    const decimals = match[3]?.length ?? 0;
    const separator = match[2] ?? ".";
    function format(x: number) {
      return x.toFixed(decimals).replace(".", separator);
    }
    const start = performance.now();
    let frame = 0;

    function step(now: number) {
      if (!el) {
        return;
      }
      const progress = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - progress, 3);
      const x = from + (target - from) * eased;
      current.current = x;
      el.textContent = progress < 1 ? format(x) : text;
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    }

    el.textContent = format(from);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [text]);

  return (
    <span ref={ref} data-slot="animated-number" className={className}>
      {text}
    </span>
  );
}
