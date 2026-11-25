import type { ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { AnimatedNumber } from "./animated-number";
import { Dot } from "./dot";
import { Well } from "./well";

interface MetricTileProps {
  legend: ReactNode;
  /** Pre-formatted ("21.4"); a missing value is an em dash, never 0. */
  value: string;
  unit?: string;
  /** A line under the value, e.g. "Bez dat 2 min". */
  hint?: ReactNode;
  /** Old data: the readout turns muted. */
  stale?: boolean;
  /** A colour dot before the value. */
  marker?: string;
  className?: string;
}

/** One live value in a well: legend, readout, unit. No icons; the legend names the value. */
export function MetricTile({
  legend,
  value,
  unit,
  hint,
  stale,
  marker,
  className,
}: Readonly<MetricTileProps>) {
  return (
    <Well legend={legend} data-stale={stale || undefined} className={className}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
        {marker && <Dot color={marker} className="mr-0.5 self-center" />}
        <AnimatedNumber value={value} className={cn("readout", stale && "text-muted-foreground")} />
        {unit && (
          <span className="font-mono text-[13px] leading-4 text-muted-foreground">{unit}</span>
        )}
      </div>
      {hint && <p className="caption text-muted-foreground">{hint}</p>}
    </Well>
  );
}
