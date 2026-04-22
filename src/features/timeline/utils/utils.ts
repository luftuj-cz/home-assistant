import type { Mode } from "../../../types/timeline";
import type { HruVariable } from "../../../api/hru";
import type { TFunction } from "i18next";

export const DAY_ORDER = [0, 1, 2, 3, 4, 5, 6] as const;
export const DEFAULT_START_TIME = "08:00" as const;

export interface ModeOption {
  value: string;
  label: string;
}

export function getModeOptions(modes: Mode[]): ModeOption[] {
  return modes.map((m) => ({ value: m.id?.toString() ?? "", label: m.name }));
}

export function getDayLabels(t: TFunction): string[] {
  return [
    t("settings.timeline.monday"),
    t("settings.timeline.tuesday"),
    t("settings.timeline.wednesday"),
    t("settings.timeline.thursday"),
    t("settings.timeline.friday"),
    t("settings.timeline.saturday"),
    t("settings.timeline.sunday"),
  ];
}

export function calculatePowerConfig(
  powerVar: HruVariable | undefined,
  settingsMaxPower?: number,
): { powerUnit: string; maxPower: number } {
  if (!powerVar) {
    return { powerUnit: "%", maxPower: 100 };
  }

  const powerUnit = typeof powerVar.unit === "string" ? powerVar.unit : powerVar.unit?.text || "%";
  const effectiveMaxPower =
    powerVar.maxConfigurable && settingsMaxPower != null ? settingsMaxPower : (powerVar.max ?? 100);

  return { powerUnit, maxPower: effectiveMaxPower };
}
