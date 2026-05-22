import type { TimelineEvent } from "../database.js";
import { getTimelineEvents, getTimelineModes } from "../database.js";

export function mapTodayToTimelineDay(): number {
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

export function timeToMinutes(value: string): number {
  const parts = value.split(":");
  const h = Number.parseInt(parts[0] ?? "0", 10);
  const m = Number.parseInt(parts[1] ?? "0", 10);
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return hh * 60 + mm;
}

export function pickActiveEvent(
  currentUnitId: string | undefined,
  nowMinutes: number,
  today: number,
): TimelineEvent | null {
  const allEvents = getTimelineEvents(currentUnitId);

  for (let d = 0; d < 7; d++) {
    const targetDay = (today - d + 7) % 7;
    const dayCandidates = allEvents.filter(
      (e) => e.enabled && (e.dayOfWeek === null || e.dayOfWeek === targetDay),
    );

    const modes = getTimelineModes(currentUnitId);
    const modeIdSet = new Set(modes.map((m) => m.id));

    let filtered = dayCandidates.filter((e) => {
      const modeId = e.hruConfig?.mode;
      if (!modeId) return true;
      // Only enforce filtering when we actually have modes loaded for the unit
      if (modeIdSet.size === 0) return true;
      if (/^\d+$/.test(String(modeId))) {
        return modeIdSet.has(Number.parseInt(String(modeId), 10));
      }
      return true;
    });

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
