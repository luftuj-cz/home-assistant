import type { TimelineEvent } from "../database.js";
import {
  getActiveSeasonId,
  getModuleLogger,
  getTimelineEvents,
  getTimelineModes,
} from "../database.js";
import type { TimelineMode } from "../../types/index.js";
import { hasResolvableTimelineModeReference } from "./modeReference.js";

/**
 * Converts JavaScript day (0=Sunday) to timeline day (0=Monday)
 * @returns Timeline day number (0-6, where 0=Monday)
 */
export function mapTodayToTimelineDay(): number {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

/**
 * Converts time string (HH:MM) to minutes since midnight
 * @param value - Time string in HH:MM format
 * @returns Minutes since midnight
 */
export function timeToMinutes(value: string): number {
  const parts = value.split(":");
  const h = Number.parseInt(parts[0] ?? "0", 10);
  const m = Number.parseInt(parts[1] ?? "0", 10);
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return hh * 60 + mm;
}

/**
 * Signature of the last reported set of unresolvable events, so an unchanged
 * condition is not re-reported. Reset when the condition clears, so it is
 * reported again if it comes back.
 */
let lastUnresolvableSignature: string | null = null;

/**
 * Reports enabled events whose mode cannot be resolved for the active season.
 *
 * Write-gating makes such an event unreachable, so one appearing here means the
 * schedule is silently losing entries - a house left unventilated with nothing
 * in the journal. It is therefore an error, not a debug line.
 *
 * Reported once per condition rather than once per weekday per tick: the
 * scheduler runs every ten seconds and the day loop runs seven times, so the
 * unthrottled version produced about 60,000 identical error lines a day and
 * buried the message it exists to deliver - including in the bug-report bundle.
 */
function reportUnresolvableEvents(
  currentUnitId: string | undefined,
  activeSeasonId: number | undefined,
  events: TimelineEvent[],
  modes: ReturnType<typeof getTimelineModes>,
): void {
  const dropped = events
    .filter((e) => e.enabled && !hasResolvableTimelineModeReference(modes, e.hruConfig?.mode))
    .map((e) => ({ id: e.id, startTime: e.startTime, mode: e.hruConfig?.mode }));

  if (dropped.length === 0) {
    lastUnresolvableSignature = null;
    return;
  }

  const signature = `${currentUnitId ?? "-"}|${activeSeasonId ?? "-"}|${dropped
    .map((e) => `${e.id}:${e.mode}`)
    .join(",")}`;
  if (signature === lastUnresolvableSignature) return;
  lastUnresolvableSignature = signature;

  getModuleLogger()?.error(
    { unitId: currentUnitId, seasonId: activeSeasonId, dropped },
    "pickActiveEvent: dropping events whose mode cannot be resolved - schedule is incomplete",
  );
}

/**
 * Picks the active timeline event for the current time
 * Searches backwards through days to find the most recent applicable event
 * @param currentUnitId - Optional HRU unit ID for unit-specific events
 * @param nowMinutes - Current time in minutes since midnight
 * @param today - Current timeline day (0-6, where 0=Monday)
 * @returns The active timeline event or null if no event applies
 */
export function pickActiveEvent(
  currentUnitId: string | undefined,
  nowMinutes: number,
  today: number,
): TimelineEvent | null {
  return pickActiveEventWithContext(currentUnitId, nowMinutes, today).event;
}

export interface ActiveEventContext {
  event: TimelineEvent | null;
  /** Season the pick was resolved against; undefined on a database without seasons. */
  activeSeasonId: number | undefined;
  /** Modes as resolved for that season, so the caller need not read them again. */
  modes: TimelineMode[];
}

/**
 * Same pick, but also returns what it had to read to make it. The scheduler
 * needs the same season-scoped modes right afterwards to build the payload;
 * reading them twice per tick doubled the database work in steady state.
 */
export function pickActiveEventWithContext(
  currentUnitId: string | undefined,
  nowMinutes: number,
  today: number,
): ActiveEventContext {
  const activeSeasonId = getActiveSeasonId(currentUnitId ?? null);
  const allEvents = getTimelineEvents(currentUnitId, activeSeasonId);
  const modes = getTimelineModes(currentUnitId, activeSeasonId);

  reportUnresolvableEvents(currentUnitId, activeSeasonId, allEvents, modes);

  return {
    event: selectEvent(allEvents, modes, nowMinutes, today),
    activeSeasonId,
    modes,
  };
}

function selectEvent(
  allEvents: TimelineEvent[],
  modes: TimelineMode[],
  nowMinutes: number,
  today: number,
): TimelineEvent | null {
  for (let d = 0; d < 7; d++) {
    const targetDay = (today - d + 7) % 7;
    const dayCandidates = allEvents.filter(
      (e) => e.enabled && (e.dayOfWeek === null || e.dayOfWeek === targetDay),
    );

    let filtered = dayCandidates.filter((e) =>
      hasResolvableTimelineModeReference(modes, e.hruConfig?.mode),
    );

    if (d === 0) {
      filtered = filtered.filter((e) => timeToMinutes(e.startTime) <= nowMinutes);
    }

    if (filtered.length > 0) {
      filtered.sort((a, b) => {
        const timeA = timeToMinutes(a.startTime);
        const timeB = timeToMinutes(b.startTime);
        if (timeB !== timeA) return timeB - timeA;
        return (b.priority ?? 0) - (a.priority ?? 0);
      });
      return filtered[0] ?? null;
    }
  }

  return null;
}
