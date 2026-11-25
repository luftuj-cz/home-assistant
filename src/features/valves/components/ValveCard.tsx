import { useTranslation } from "react-i18next";

import type { Valve } from "@luftuj/shared/types/valve";
import { damperAngle, damperState } from "@luftuj/shared/ui/damper-geometry";
import { DamperModule } from "@luftuj/shared/ui/damper-module";
import { Legend } from "@luftuj/shared/ui/legend";
import { Slider } from "@luftuj/shared/ui/slider";
import { cn } from "@luftuj/shared/utils/cn";
import { damperScale } from "@luftuj/shared/utils/valve";

const VALUE_TONE = {
  open: "text-valve-open",
  partial: "text-foreground",
  closed: "text-valve-closed",
  offline: "text-valve-closed",
} as const;

const SLIDER_TONE = {
  open: "air",
  partial: "valve-partial",
  closed: "valve-closed",
  offline: "valve-closed",
} as const;

interface ValveCardProps {
  valve: Valve;
  onPreview: (entityId: string, value: number) => void;
  onCommit: (entityId: string, value: number) => void | Promise<void>;
}

/**
 * One damper: the module drawn as it really stands, its name and entity id, the value and a pointer slider. The
 * blade follows the slider while it moves; Home Assistant gets the value on release. Offline: no fill, an inset
 * ring, the slider off.
 */
export function ValveCard({ valve, onPreview, onCommit }: Readonly<ValveCardProps>) {
  const { t } = useTranslation();
  const { entityId, name, value, min, max, step, isAvailable } = valve;
  const state = damperState(value, min, max, isAvailable);
  const scale = damperScale(t, min, max);
  let reading = <Legend className="text-current">{t("valves.status.offlineLabel")}</Legend>;
  if (state === "partial") reading = <span className="readout-sm">{Math.round(value)}°</span>;
  else if (state === "open") {
    reading = <Legend className="text-current">{t("valves.status.open")}</Legend>;
  } else if (state === "closed") {
    reading = <Legend className="text-current">{t("valves.status.closed")}</Legend>;
  }

  return (
    <div
      data-slot="valve-card"
      data-state={state}
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 rounded-xl bg-card p-5 shadow-plane [--dm-ground:var(--card)]",
        "data-[state=offline]:bg-transparent data-[state=offline]:shadow-[inset_0_0_0_1.5px_var(--border)] data-[state=offline]:[--dm-ground:var(--background)]",
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        <DamperModule angle={damperAngle(value, min, max)} state={state} size={92} />
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
            <p
              className={cn("card-title truncate", state === "offline" && "text-muted-foreground")}
              title={name}
            >
              {name}
            </p>
            <p className="code truncate text-muted-foreground" title={entityId}>
              {entityId}
            </p>
          </div>
          <div className={cn("flex min-h-6 items-center", VALUE_TONE[state])}>{reading}</div>
        </div>
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={!isAvailable}
        fill="none"
        tone={SLIDER_TONE[state]}
        ticks={6}
        labels={scale}
        format={(v) => `${v}°`}
        aria-label={t("valves.valveAria", { name })}
        onValueChange={(v) => onPreview(entityId, v)}
        onValueCommit={(v) => void onCommit(entityId, v)}
      />
    </div>
  );
}
