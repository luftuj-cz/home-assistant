import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseApiError } from "@luftuj/shared/utils/apiError";
import type { ApiTimelineEvent, Mode, TimelineEvent } from "@luftuj/shared/types/timeline";

/**
 * Builds an API URL carrying the unit and, when seasons are in play, the season
 * being viewed. Omitting the season lets the backend fall back to the active
 * one, which is what a client that predates seasons sends.
 */
function withScope(path: string, unitId?: string, seasonId?: number): string {
  const params = new URLSearchParams();
  if (unitId) params.set("unitId", unitId);
  if (seasonId !== undefined) params.set("seasonId", String(seasonId));
  const query = params.toString();
  return resolveApiUrl(query ? `${path}?${query}` : path);
}

export interface HaScript {
  entityId: string;
  friendlyName: string;
}

export async function getHaScripts(): Promise<HaScript[]> {
  const res = await fetch(resolveApiUrl("/api/settings/scripts"));
  if (!res.ok) throw await parseApiError(res);
  const data = (await res.json()) as { scripts?: HaScript[] };
  return data.scripts ?? [];
}

export async function fetchTimelineModes(unitId?: string, seasonId?: number): Promise<Mode[]> {
  const res = await fetch(withScope("/api/timeline/modes", unitId, seasonId));
  if (!res.ok) throw new Error("Failed to load modes");
  const data = (await res.json()) as { modes?: Mode[] };
  return data.modes ?? [];
}

export async function createTimelineMode(
  mode: Omit<Mode, "id">,
  unitId?: string,
  seasonId?: number,
): Promise<Mode> {
  const res = await fetch(withScope("/api/timeline/modes", unitId, seasonId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mode),
  });
  if (!res.ok) throw await parseApiError(res);
  return res.json();
}

export async function updateTimelineMode(
  mode: Mode,
  unitId?: string,
  seasonId?: number,
): Promise<Mode> {
  const res = await fetch(withScope(`/api/timeline/modes/${mode.id}`, unitId, seasonId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mode),
  });
  if (!res.ok) throw await parseApiError(res);
  return res.json();
}

export async function deleteTimelineMode(id: number): Promise<void> {
  const res = await fetch(resolveApiUrl(`/api/timeline/modes/${id}`), {
    method: "DELETE",
  });
  if (!res.ok) throw await parseApiError(res);
}

export async function testTimelineMode(
  mode: Omit<Mode, "id">,
  durationMinutes: number,
): Promise<void> {
  const res = await fetch(resolveApiUrl("/api/timeline/test"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: mode, durationMinutes }),
  });
  if (!res.ok) throw await parseApiError(res);
}

export async function fetchTimelineEvents(
  unitId?: string,
  seasonId?: number,
): Promise<TimelineEvent[]> {
  const res = await fetch(withScope("/api/timeline/events", unitId, seasonId));
  if (!res.ok) throw new Error("Failed to load events");
  const rawEvents = (await res.json()) as ApiTimelineEvent[];

  return rawEvents
    .map((e) => ({
      id: e.id,
      startTime: e.startTime ?? e.start_time ?? "08:00",
      dayOfWeek: e.dayOfWeek ?? e.day_of_week ?? 0,
      hruConfig: e.hruConfig ?? e.hru_config ?? null,
      luftatorConfig: e.luftatorConfig ?? e.luftator_config ?? null,
      enabled: e.enabled ?? true,
    }))
    .filter((e) => e.dayOfWeek >= 0 && e.dayOfWeek <= 6);
}

export async function saveTimelineEvent(
  event: TimelineEvent,
  unitId?: string,
  seasonId?: number,
): Promise<TimelineEvent> {
  const payload = {
    id: event.id,
    startTime: event.startTime,
    dayOfWeek: event.dayOfWeek,
    hruConfig: event.hruConfig,
    luftatorConfig: event.luftatorConfig,
    enabled: event.enabled,
    priority: 0,
  };

  const res = await fetch(withScope("/api/timeline/events", unitId, seasonId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw await parseApiError(res);
  return res.json();
}

export async function deleteTimelineEvent(id: number): Promise<void> {
  const res = await fetch(resolveApiUrl(`/api/timeline/events/${id}`), {
    method: "DELETE",
  });
  if (!res.ok) throw await parseApiError(res);
}

export async function fetchActiveBoost(): Promise<{
  modeId: number;
  endTime: string;
  durationMinutes: number;
} | null> {
  const res = await fetch(resolveApiUrl("/api/timeline/boost"));
  if (!res.ok) return null;
  const data = await res.json();
  return data.active;
}

export async function activateBoost(
  modeId: number,
  durationMinutes: number,
  unitId?: string,
): Promise<{ modeId: number; endTime: string; durationMinutes: number }> {
  const url = unitId
    ? resolveApiUrl(`/api/timeline/boost?unitId=${encodeURIComponent(unitId)}`)
    : resolveApiUrl("/api/timeline/boost");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modeId, durationMinutes }),
  });
  if (!res.ok) throw await parseApiError(res);
  const data = await res.json();
  return data.active;
}

export async function cancelBoost(): Promise<void> {
  const res = await fetch(resolveApiUrl("/api/timeline/boost"), {
    method: "DELETE",
  });
  if (!res.ok) throw await parseApiError(res);
}

export interface ModeSeasonUsage {
  timelineId: number;
  seasonKey: string;
  enabledEvents: number;
  /** True when removing this mode would leave the season with no enabled events. */
  wouldBeLeftEmpty: boolean;
}

/**
 * What deleting a mode would cost, per season. Mode identity is shared, so a
 * deletion started while viewing one season also removes events from the
 * others - off-screen, where the user cannot see what they are losing.
 */
export async function fetchModeUsage(id: number, unitId?: string): Promise<ModeSeasonUsage[]> {
  const res = await fetch(withScope(`/api/timeline/modes/${id}/usage`, unitId));
  if (!res.ok) throw await parseApiError(res);
  const data = (await res.json()) as { seasons?: ModeSeasonUsage[] };
  return data.seasons ?? [];
}

/**
 * Puts a mode back to unconfigured for one season, leaving the seasons it is
 * still set up for alone. Rejected while enabled events there still use it.
 */
export async function clearModeValuesForSeason(
  modeId: number,
  unitId?: string,
  seasonId?: number,
): Promise<void> {
  const res = await fetch(withScope(`/api/timeline/modes/${modeId}/values`, unitId, seasonId), {
    method: "DELETE",
  });
  if (!res.ok) throw await parseApiError(res);
}

/**
 * Values a mode holds in another season, so an unconfigured season can be
 * filled from a working one instead of retyping the numbers. Read-only.
 */
export async function fetchModeInSeason(
  modeId: number,
  seasonId: number,
  unitId?: string,
): Promise<Mode | undefined> {
  const modes = await fetchTimelineModes(unitId, seasonId);
  return modes.find((mode) => mode.id === modeId);
}
