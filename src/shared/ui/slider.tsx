import { Slider as SliderPrimitive } from "radix-ui";
import { useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

const TONE = {
  air: "var(--air)",
  "valve-partial": "var(--valve-partial)",
  "valve-closed": "var(--valve-closed)",
  manual: "var(--manual)",
} as const;

interface SliderProps {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** `start`: a filled range, for amounts. `none`: a pointer on a scale, for positions (dampers). */
  fill?: "start" | "none";
  tone?: keyof typeof TONE;
  /** Divisions of the tick scale; every half is a major tick. 0 hides the scale. */
  ticks?: number;
  /** Labels spread evenly under the scale ("Otev.", "45°", "Zavř."). */
  labels?: ReactNode[];
  /** Spoken value (aria-valuetext), e.g. "45°". */
  format?: (value: number) => string;
  onValueChange?: (value: number) => void;
  /** Fires on release only: write to the device here, not on every move. */
  onValueCommit?: (value: number) => void;
  "aria-label"?: string;
  className?: string;
}

/** A value on a range with an instrument scale. */
function Slider({
  value,
  defaultValue = 0,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  fill = "start",
  tone = "air",
  ticks = 10,
  labels,
  format,
  onValueChange,
  onValueCommit,
  "aria-label": ariaLabel,
  className,
}: Readonly<SliderProps>) {
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const pointer = fill === "none";
  const majorEvery = ticks / 2 || 1;

  return (
    <div
      data-slot="slider"
      data-disabled={disabled || undefined}
      style={{ "--fill": TONE[tone] } as CSSProperties}
      className={cn("grid gap-1.5 data-disabled:opacity-45", className)}
    >
      <SliderPrimitive.Root
        value={[current]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => {
          setInner(v);
          onValueChange?.(v);
        }}
        onValueCommit={([v]) => onValueCommit?.(v)}
        className="relative flex h-7 w-full touch-none items-center select-none data-disabled:cursor-not-allowed"
      >
        <SliderPrimitive.Track
          className={cn(
            "relative w-full grow overflow-hidden rounded-full",
            pointer ? "h-0.5 bg-input" : "h-1.5 bg-secondary",
          )}
        >
          {!pointer && (
            <SliderPrimitive.Range className="absolute h-full rounded-full bg-(--fill) transition-[background-color] duration-(--duration-base)" />
          )}
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label={ariaLabel}
          aria-valuetext={format?.(current)}
          className={cn(
            "block cursor-grab transition-[scale,border-color] duration-(--duration-fast) ease-(--ease-out)",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "active:cursor-grabbing active:scale-[1.12] data-disabled:cursor-not-allowed",
            pointer
              ? "h-7 w-2 rounded-[4px] border-2 border-card bg-(--fill) shadow-[0_1px_4px_rgba(0,0,0,.25)]"
              : "size-6 rounded-full border-2 border-(--fill) bg-card shadow-[0_2px_6px_rgba(0,0,0,.18)]",
          )}
        />
      </SliderPrimitive.Root>
      {ticks > 0 && (
        <div aria-hidden="true" className="flex h-1.5 justify-between px-0.5">
          {Array.from({ length: ticks + 1 }, (_, i) => (
            <i
              key={i}
              className={cn(
                "w-px",
                i % majorEvery === 0 ? "h-1.5 bg-muted-foreground" : "h-1 bg-input",
              )}
            />
          ))}
        </div>
      )}
      {labels && (
        <div
          aria-hidden="true"
          className="flex justify-between font-mono text-[10px] leading-3 font-medium tracking-[.06em] text-muted-foreground uppercase"
        >
          {labels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export { Slider, type SliderProps };
