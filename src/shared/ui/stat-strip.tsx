import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Dot } from "./dot";

export interface StatItem {
  legend: ReactNode;
  /** Short: a version, a duration, a status word, a count. */
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  /** A status dot before the value. */
  tone?: "success" | "warning" | "destructive" | "air";
  /** Pulse the dot (only while something is pending). */
  pulse?: boolean;
}

interface StatStripProps {
  items: StatItem[];
  /** The narrowest a cell may get (px). */
  minCell?: number;
}

/**
 * The widest column count that fits and divides the number of cells, so every row is full and the hairlines form a
 * closed grid (6 cells: 6, 3 or 2 columns). When nothing divides (5 or 7 cells), the last cell spans the rest of
 * its row.
 */
function layout(count: number, width: number, minCell: number) {
  const fit = Math.max(1, Math.min(count, Math.floor(width / minCell)));
  for (let cols = fit; cols >= 2; cols--) {
    if (count % cols === 0) {
      return { cols, span: 1 };
    }
  }
  return { cols: fit, span: fit - ((count - 1) % fit) };
}

/** One plane of small read-only facts with hairlines between: a mono legend above, the value below. */
export function StatStrip({ items, minCell = 150 }: Readonly<StatStripProps>) {
  const ref = useRef<HTMLDListElement>(null);
  const [grid, setGrid] = useState<{ cols: number; span: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    function fit() {
      if (!el?.clientWidth) {
        return;
      }
      const next = layout(items.length, el.clientWidth, minCell);
      setGrid((prev) => (prev?.cols === next.cols && prev.span === next.span ? prev : next));
    }
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [items.length, minCell]);

  return (
    <dl
      ref={ref}
      data-slot="stat-strip"
      style={grid ? { gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` } : undefined}
      className="m-0 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] overflow-hidden rounded-xl bg-card shadow-plane"
    >
      {items.map((item, index) => (
        <div
          key={index}
          style={
            grid && index === items.length - 1 && grid.span > 1
              ? { gridColumn: `span ${grid.span}` }
              : undefined
          }
          className="grid min-w-0 content-start gap-1.5 px-5 py-4 shadow-[-1px_0_0_var(--border),0_-1px_0_var(--border)]"
        >
          <dt className="legend">{item.legend}</dt>
          <dd className="m-0 grid min-w-0 gap-0.5">
            <span className="flex min-w-0 items-center gap-2 font-sans text-lg leading-6 font-normal tracking-[-.01em] tabular-nums">
              {item.tone && <Dot tone={item.tone} pulse={item.pulse} />}
              <span className="truncate">{item.value}</span>
              {item.unit && (
                <small className="font-mono text-xs leading-4 text-muted-foreground">
                  {item.unit}
                </small>
              )}
            </span>
            {item.hint && (
              <span className="caption truncate text-muted-foreground">{item.hint}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
