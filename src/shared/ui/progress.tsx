import { Progress as ProgressPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

const TONE = {
  air: "bg-air",
  manual: "bg-manual",
  success: "bg-success",
  warning: "bg-warning",
} as const;

interface ProgressProps {
  /** 0–100. */
  value: number;
  tone?: keyof typeof TONE;
  /** Shown beside the bar and spoken as the value ("12:40"). */
  label?: ReactNode;
  /** What is measured. Required: a bar alone says nothing to a screen reader. */
  "aria-label": string;
  /** `sm`: 4px, e.g. the manual-mode countdown. */
  size?: "default" | "sm";
  className?: string;
}

/** A level or countdown bar. */
function Progress({
  value,
  tone = "air",
  label,
  size = "default",
  "aria-label": ariaLabel,
  className,
}: Readonly<ProgressProps>) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div data-slot="progress-row" className={cn("flex items-center gap-3", className)}>
      <ProgressPrimitive.Root
        data-slot="progress"
        value={clamped}
        aria-label={ariaLabel}
        aria-valuetext={typeof label === "string" ? label : undefined}
        className={cn(
          "relative flex-1 overflow-hidden rounded-full bg-secondary",
          size === "sm" ? "h-1" : "h-2",
        )}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            "h-full rounded-full transition-[width] duration-600 ease-(--ease-in-out)",
            TONE[tone],
          )}
          style={{ width: `${clamped}%` }}
        />
      </ProgressPrimitive.Root>
      {label && <span className="code text-muted-foreground">{label}</span>}
    </div>
  );
}

export { Progress, type ProgressProps };
