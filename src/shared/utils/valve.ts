import type { TFunction } from "i18next";

export function getValveStatusColor(value: number, min: number, max: number, unavailable?: boolean): string {
  if (unavailable) return "gray";
  if (value >= max) return "red";
  if (value <= min) return "green";
  return "orange";
}

export function formatValveValue(value: number, min: number, max: number, t: TFunction): string {
  if (value <= min) return t("valves.status.open");
  if (value >= max) return t("valves.status.closed");
  return `${Math.round(max - value)}°`;
}