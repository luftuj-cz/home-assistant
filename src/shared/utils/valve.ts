import type { TFunction } from "i18next";
import type { Valve } from "@luftuj/shared/types/valve";

export interface ValveBounds {
  min: number;
  max: number;
  step: number;
}

export function getValveGroupBounds(valves: Valve[]): ValveBounds {
  if (valves.length === 0) return { min: 0, max: 90, step: 5 };
  return {
    min: Math.min(...valves.map((v) => v.min)),
    max: Math.max(...valves.map((v) => v.max)),
    step: Math.min(...valves.map((v) => v.step)),
  };
}

export function getValveStatusColor(
  value: number,
  min: number,
  max: number,
  unavailable?: boolean,
): string {
  if (unavailable) return "gray";
  if (value >= max) return "red";
  if (value <= min) return "green";
  return "orange";
}

export function formatValveValue(value: number, min: number, max: number, t: TFunction): string {
  if (value <= min) return t("valves.status.open");
  if (value >= max) return t("valves.status.closed");
  return `${Math.round(value)}`;
}

/** "Otev.", the middle angle, "Zavř." under a damper slider. */
export function damperScale(t: TFunction, min: number, max: number) {
  return [t("valves.scale.open"), `${Math.round((min + max) / 2)}°`, t("valves.scale.closed")];
}
