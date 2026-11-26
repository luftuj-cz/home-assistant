import type { Mode, TimelineEvent } from "@luftuj/shared/types/timeline";
import type { HruVariable, LocalizedText } from "@luftuj/shared/api/hru";
import type { TFunction } from "i18next";
import i18n from "@luftuj/shared/i18n";

export const DAY_ORDER = [0, 1, 2, 3, 4, 5, 6] as const;
export const DEFAULT_START_TIME = "08:00" as const;

export interface ModeOption {
  value: string;
  label: string;
}

export function getModeOptions(modes: Mode[]): ModeOption[] {
  return modes.map((m) => ({ value: m.id?.toString() ?? "", label: m.name }));
}

/**
 * Name for a copy of `name` that no mode uses yet: "Komfort (kopie)", then
 * "Komfort (kopie 2)" and so on. Names are unique per unit, case-insensitively.
 */
export function duplicateModeName(name: string, modes: Mode[], t: TFunction): string {
  const taken = new Set(modes.map((m) => m.name.toLowerCase()));
  let candidate = t("settings.timeline.modeCopyName", { name });
  let number = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = t("settings.timeline.modeCopyNameNumbered", { name, number });
    number++;
  }
  return candidate;
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
  settingsMinPower?: number,
): { powerUnit: string; minPower: number | undefined; maxPower: number } {
  if (!powerVar) {
    return { powerUnit: "%", minPower: undefined, maxPower: 100 };
  }

  const powerUnit = typeof powerVar.unit === "string" ? powerVar.unit : powerVar.unit?.text || "%";
  const effectiveMaxPower =
    powerVar.maxConfigurable && settingsMaxPower != null ? settingsMaxPower : (powerVar.max ?? 100);

  const effectiveMinPower =
    powerVar.minConfigurable && settingsMinPower != null ? settingsMinPower : powerVar.min;

  return { powerUnit, minPower: effectiveMinPower, maxPower: effectiveMaxPower };
}

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** The built-in mode "Automatika": automatic control by CO₂ instead of a stored mode (`@automatic`). */
export const AUTOMATIC_MODE_REFERENCE = "@automatic";

/** Automatika shown like a mode: a fixed id no stored mode has, the air colour, no values. */
export function automaticMode(): Mode {
  return { id: -1, name: i18n.t("automatic.title"), color: "var(--air)" };
}

export function isAutomaticEvent(event: TimelineEvent): boolean {
  return event.hruConfig?.mode === AUTOMATIC_MODE_REFERENCE;
}

/** The mode an event switches to, by id or (older events) by name; undefined when it names none. */
export function modeOfEvent(event: TimelineEvent, modes: Mode[]): Mode | undefined {
  const reference = event.hruConfig?.mode;
  if (reference === AUTOMATIC_MODE_REFERENCE) return automaticMode();
  if (typeof reference !== "string" && typeof reference !== "number") return undefined;
  const key = String(reference);
  return modes.find((mode) => String(mode.id) === key || mode.name === reference);
}

function hasResolvableMode(event: TimelineEvent, modes: Mode[]): boolean {
  const reference = event.hruConfig?.mode;
  if (reference === undefined || reference === null || reference === "") return true;
  if (reference === AUTOMATIC_MODE_REFERENCE) return true;
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

/** A day's enabled events as strip segments ("HH:MM" and the mode colour), in time order. */
export function stripEvents(events: TimelineEvent[], modes: Mode[]) {
  return events
    .filter((event) => event.enabled)
    .toSorted((a, b) => a.startTime.localeCompare(b.startTime))
    .map((event) => ({
      time: event.startTime,
      color: modeOfEvent(event, modes)?.color ?? "var(--mode-8)",
    }));
}

/**
 * The colour a day starts in: the last enabled mode before it keeps running until the day's first event. Empty days
 * are skipped, so the week wraps (Monday takes Sunday's, or an earlier day's).
 */
export function carryColor(
  eventsByDay: Map<number, TimelineEvent[]>,
  day: number,
  modes: Mode[],
): string | undefined {
  for (let back = 1; back <= 7; back++) {
    const previous = stripEvents(eventsByDay.get((day - back + 7) % 7) ?? [], modes);
    if (previous.length > 0) return previous.at(-1)?.color;
  }
  return undefined;
}

/** A mode's power or temperature: the unit variable when set, else the legacy field. */
export function modeNumber(mode: Mode, key: "power" | "temperature"): number | undefined {
  const value = mode.variables?.[key];
  return typeof value === "number" ? value : mode[key];
}

/** "HH:MM" now, and today as 0 = Monday … 6 = Sunday. */
export function clockNow(date = new Date()) {
  return {
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
    day: (date.getDay() + 6) % 7,
  };
}

/** A unit definition's label: a translation key, a plain text, or `{ text, translate }`. */
export function localizedText(text: LocalizedText, t: TFunction): string {
  if (typeof text === "string") return t(text, { defaultValue: text });
  if (text.translate) return t(text.text, { defaultValue: text.text });
  return text.text;
}
