import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@luftuj/shared/utils/cn";

interface FitTextProps {
  text: string;
  /** Smallest font size (px); below it the text breaks inside words instead. */
  min?: number;
  /** Largest font size (px). */
  max?: number;
  /** When the box has no height of its own (a stacked layout): the largest size that fits the width in this many lines. */
  maxLines?: number;
  /** The largest size in that stacked layout, where only the width limits it. */
  stackedMax?: number;
  className?: string;
  /** Classes for the box around the text (its size in the caller's layout). */
  boxClassName?: string;
}

const LINE_HEIGHT = 1.08;

/**
 * Text set as large as its box allows: the biggest whole-pixel size at which it fits without breaking a word.
 * In a box with a height (a flex child with room) it fills width and height; where the box is `static` (a stacked
 * layout, see the `@max-[560px]` classes on the caller) it fills the width in at most `maxLines` lines.
 */
export function FitText({
  text,
  min = 30,
  max = 120,
  maxLines = 2,
  stackedMax = 56,
  className,
  boxClassName,
}: Readonly<FitTextProps>) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(min);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const el = textRef.current;
    if (!box || !el) return;

    // A line is a little taller than the line-height when it has diacritics (č, ž, ý): allow for that.
    const LINE_SLACK = 1.25;

    function fits(px: number, lines: number) {
      if (!box || !el) return false;
      el.style.fontSize = `${px}px`;
      const bounded = getComputedStyle(el).position === "absolute";
      if (!bounded && px > stackedMax) return false;
      const wide = el.scrollWidth <= el.clientWidth + 1;
      const tall = bounded
        ? el.scrollHeight <= el.clientHeight + 1
        : el.scrollHeight <= px * LINE_HEIGHT * LINE_SLACK * lines;
      return wide && tall;
    }

    /** The largest size that fits in `lines` lines (unbounded box) or in the box. */
    function largest(lines: number) {
      let low = min;
      let high = max;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (fits(mid, lines)) low = mid;
        else high = mid - 1;
      }
      return low;
    }

    // The box size the last fit was made for. Stacked, the box is as tall as the text, so only its width counts;
    // reacting to the height the fit itself causes would loop.
    let measured = "";

    function fit() {
      if (!box || !el || box.clientWidth === 0) return;
      const bounded = getComputedStyle(el).position === "absolute";
      const key = bounded ? `${box.clientWidth}x${box.clientHeight}` : `${box.clientWidth}`;
      if (key === measured) return;
      measured = key;
      el.style.overflowWrap = "normal";
      // A caller may centre or bottom-align the text (`content-center`, `content-end`); the glyphs' overflow below
      // a shifted line then counts into scrollHeight and every size looks too tall. Measure top-aligned.
      el.style.alignContent = "normal";
      // Stacked: one line if it fits at all, two only for names too long for that.
      let px = largest(1);
      if (!bounded && !fits(px, 1)) px = largest(maxLines);
      // Not even the smallest size keeps whole words in the box: break inside them rather than overflow.
      if (!fits(px, maxLines)) el.style.overflowWrap = "anywhere";
      el.style.alignContent = "";
      el.style.fontSize = `${px}px`;
      setSize(px);
    }

    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(box);
    // Geist arrives after first paint; measure again with the real glyphs.
    void document.fonts?.ready.then(() => {
      measured = "";
      fit();
    });
    return () => observer?.disconnect();
  }, [text, min, max, maxLines, stackedMax]);

  return (
    // Spans, not div and p: the text can sit inside a button (the mode tiles in ManualModeCard).
    <span
      ref={boxRef}
      className={cn("relative block min-h-11 flex-1 @max-[560px]:flex-none", boxClassName)}
    >
      <span
        ref={textRef}
        style={{ fontSize: size, lineHeight: LINE_HEIGHT }}
        className={cn("absolute inset-0 block overflow-hidden @max-[560px]:static", className)}
      >
        {text}
      </span>
    </span>
  );
}
