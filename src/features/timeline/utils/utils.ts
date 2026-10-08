import type { Mode, TimelineEvent } from "@luftuj/shared/types/timeline";
import type { HruVariable } from "@luftuj/shared/api/hru";
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

export function mapModeForUi(mode: Mode): Mode {
  if (mode.variables && Object.keys(mode.variables).length > 0) return mode;

  const variables: Record<string, number> = {};
  if (typeof mode.power === "number") variables.power = mode.power;
  if (typeof mode.temperature === "number") variables.temperature = mode.temperature;
  if (typeof mode.nativeMode === "number") variables.mode = mode.nativeMode;

  return Object.keys(variables).length > 0 ? { ...mode, variables } : mode;
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

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function hasResolvableMode(event: TimelineEvent, modes: Mode[]): boolean {
  const reference = event.hruConfig?.mode;
  if (reference === undefined || reference === null || reference === "") return true;
  if (typeof reference !== "string" && typeof reference !== "number") return false;
  const key = String(reference);
  return modes.some((mode) => String(mode.id) === key || mode.name === reference);
}

/** The running event and the day column it runs in. */
export interface ActiveEventRef {
  id: number;
  /** 0 = Monday … 6 = Sunday: the day the scheduler picked the event from. */
  day: number;
}

/**
 * The event the scheduler applies at `now`, using its rule: the latest enabled
 * event at or before now, looking back a whole week. It lives on the page
 * rather than the day card because the running event is often one that
 * started on an earlier day. The day comes with the id because an every-day
 * event is listed under all seven days and runs in only one of them.
 */
export function findActiveEvent(
  eventsByDay: Map<number, TimelineEvent[]>,
  modes: Mode[],
  now: Date,
): ActiveEventRef | undefined {
  const jsDay = now.getDay();
  const today = jsDay === 0 ? 6 : jsDay - 1;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  for (let back = 0; back <= 7; back++) {
    const day = (today - back + 7) % 7;
    const candidates = (eventsByDay.get(day) ?? []).filter(
      (event) =>
        event.enabled &&
        hasResolvableMode(event, modes) &&
        (back !== 0 || toMinutes(event.startTime) <= nowMinutes),
    );
    if (candidates.length > 0) {
      const latest = candidates.reduce(
        (best, event) => (toMinutes(event.startTime) > toMinutes(best.startTime) ? event : best),
        candidates[0],
      );
      return latest.id === undefined ? undefined : { id: latest.id, day };
    }
  }
  return undefined;
}
