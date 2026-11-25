import { useTranslation } from "react-i18next";

import type { Valve } from "@luftuj/shared/types/valve";
import { CopyButton } from "@luftuj/shared/ui/copy-button";
import { DamperDial } from "@luftuj/shared/ui/damper-dial";
import { damperAngle, damperState } from "@luftuj/shared/ui/damper-geometry";
import { Slider } from "@luftuj/shared/ui/slider";
import { cn } from "@luftuj/shared/utils/cn";

const VALUE_TONE = {
  open: "text-valve-open",
  partial: "text-foreground",
  closed: "text-valve-closed",
  offline: "text-muted-foreground",
} as const;

const SLIDER_TONE = {
  open: "air",
  partial: "valve-partial",
  closed: "valve-closed",
  offline: "valve-closed",
} as const;

interface ValveRowProps {
  valve: Valve;
  /** The opening this mode sets. */
  value: number;
  onValueChange: (value: number) => void;
  /** Debug mode: a copy button for the entity id. */
  copy?: boolean;
}

/**
 * One valve in the mode editor: DamperDial, name, entity id, the state word or angle and a pointer slider. In a
 * list at least 560px wide it is one line; narrower, the slider goes under the name. An unavailable valve reads
 * "Nedostupná", dimmed, slider off.
 */
export function ValveRow({ valve, value, onValueChange, copy }: Readonly<ValveRowProps>) {
  const { t } = useTranslation();
  const { name, entityId, min, max, step, isAvailable } = valve;
  const state = damperState(value, min, max, isAvailable);
  const word = {
    open: t("valves.status.open"),
    closed: t("valves.status.closed"),
    partial: `${Math.round(value)}°`,
    offline: t("settings.timeline.deadValve"),
  }[state];

  return (
    <div
      data-slot="valve-row"
      data-state={state}
      className={cn(
        "grid items-center gap-x-3 gap-y-1 rounded-md bg-card px-3 pt-2.5 pb-2 [--dm-ground:var(--card)]",
        "grid-cols-[32px_minmax(0,1fr)_auto] [grid-template-areas:'dial_text_val'_'slider_slider_slider']",
        "@min-[560px]:grid-cols-[32px_minmax(120px,1fr)_minmax(200px,1.6fr)_72px] @min-[560px]:py-1.5 @min-[560px]:[grid-template-areas:'dial_text_slider_val']",
      )}
    >
      <DamperDial
        angle={isAvailable ? damperAngle(value, min, max) : 0}
        state={state}
        size={32}
        className="[grid-area:dial] data-[state=offline]:opacity-60"
      />
      <div className="grid min-w-0 [grid-area:text]">
        <span className="label truncate" title={name}>
          {name}
        </span>
        <span className="flex min-w-0 items-center gap-1 font-mono text-[11px] leading-4 text-muted-foreground">
          <span className="truncate" title={entityId}>
            {entityId}
          </span>
          {copy && entityId && <CopyButton value={entityId} className="size-6" />}
        </span>
      </div>
      <span
        className={cn(
          "font-mono text-[13px] leading-4 font-medium [grid-area:val] @min-[560px]:text-right",
          VALUE_TONE[state],
        )}
      >
        {word}
      </span>
      <div
        className="min-w-0 [grid-area:slider] data-[off]:opacity-60"
        data-off={!isAvailable || undefined}
      >
        <Slider
          value={value}
          min={min}
          max={max}
          step={step}
          fill="none"
          ticks={6}
          disabled={!isAvailable}
          tone={SLIDER_TONE[state]}
          format={(v) => `${v}°`}
          aria-label={t("valves.valveAria", { name })}
          onValueChange={onValueChange}
          className="@min-[560px]:[&>[aria-hidden=true]]:hidden"
        />
      </div>
    </div>
  );
}
