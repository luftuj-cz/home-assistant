import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { ActiveMode } from "@luftuj/features/dashboard/types";
import { fetchSeasons } from "@luftuj/features/settings/seasonsApi";
import { useTimelineEventsQuery } from "@luftuj/features/timeline/hooks/useTimelineEventsQuery";
import { useTimelineModesQuery } from "@luftuj/features/timeline/hooks/useTimelineModesQuery";
import { findActiveEvent, modeOfEvent, toMinutes } from "@luftuj/features/timeline/utils/utils";
import type { CustomOverride } from "@luftuj/shared/types/customTimeline";
import type { TimelineRef } from "@luftuj/shared/types/customTimeline";

export interface StripEvent {
  /** "HH:MM". */
  time: string;
  mode: string;
  color: string;
}

export interface TodayPlan {
  events: StripEvent[];
  /** Colour of the mode carried over from yesterday into today's first hours. */
  carry?: string;
  /** "HH:MM", for the now-needle. */
  now: string;
  /** The next change today, if any. */
  next?: { time: string; mode: string };
}

const FALLBACK_COLOR = "var(--mode-8)";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Re-renders every minute, so the needle and "next change" move on their own. */
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Today's plan for the mode well: the events of the timeline that applies now (the running custom plan when it
 * applies to this unit, otherwise the active season), with the scheduler's own rule for what carries over from
 * yesterday (`findActiveEvent`, shared with the timeline page). Only for the schedule and custom-plan sources; a
 * manual mode or the safe state has no plan to show.
 */
export function useTodayPlan(
  unitId: string | undefined,
  activeMode: ActiveMode | null | undefined,
  override: CustomOverride | null | undefined,
): TodayPlan | null {
  const seasons = useQuery({ queryKey: ["seasons"], queryFn: fetchSeasons, staleTime: 30_000 });
  const activeSeasonId = seasons.data?.activeSeasonId ?? undefined;
  const customApplies =
    override?.phase === "active" && override.appliesToCurrentUnit && !override.degraded;
  const ref: TimelineRef = customApplies
    ? { kind: "custom", id: override.customTimelineId }
    : { kind: "season", id: activeSeasonId };

  // A custom plan's modes run with the values of the season active at the time, as on the timeline page.
  const { modes } = useTimelineModesQuery(unitId, activeSeasonId);
  const { eventsByDay } = useTimelineEventsQuery(modes, unitId, ref);
  const clock = useMinuteClock();
  const relevant = activeMode?.source === "schedule" || activeMode?.source === "custom";

  return useMemo(() => {
    if (!relevant || modes.length === 0) {
      return null;
    }
    const jsDay = clock.getDay();
    const today = jsDay === 0 ? 6 : jsDay - 1;
    const nowMinutes = clock.getHours() * 60 + clock.getMinutes();

    const todays = (eventsByDay.get(today) ?? [])
      .filter((event) => event.enabled)
      .map((event) => ({ event, mode: modeOfEvent(event, modes) }))
      .filter(
        (
          entry,
        ): entry is { event: (typeof entry)["event"]; mode: NonNullable<(typeof entry)["mode"]> } =>
          Boolean(entry.mode),
      );
    if (todays.length === 0 && eventsByDay.size === 0) {
      return null;
    }

    // What runs at the very start of today: the scheduler's pick one minute before midnight.
    const lastMinuteOfYesterday = new Date(clock);
    lastMinuteOfYesterday.setHours(0, 0, 0, 0);
    lastMinuteOfYesterday.setMinutes(-1);
    const carried = findActiveEvent(eventsByDay, modes, lastMinuteOfYesterday);
    const carriedEvent = carried
      ? (eventsByDay.get(carried.day) ?? []).find((event) => event.id === carried.id)
      : undefined;
    const carriedMode = carriedEvent ? modeOfEvent(carriedEvent, modes) : undefined;

    const next = todays.find(({ event }) => toMinutes(event.startTime) > nowMinutes);

    return {
      events: todays.map(({ event, mode }) => ({
        time: event.startTime.slice(0, 5),
        mode: mode.name,
        color: mode.color ?? FALLBACK_COLOR,
      })),
      carry: carriedMode ? (carriedMode.color ?? FALLBACK_COLOR) : undefined,
      now: `${pad(clock.getHours())}:${pad(clock.getMinutes())}`,
      next: next ? { time: next.event.startTime.slice(0, 5), mode: next.mode.name } : undefined,
    };
  }, [relevant, modes, eventsByDay, clock]);
}
