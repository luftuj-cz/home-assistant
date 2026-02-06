import { resolveApiUrl } from "../utils/api";
import type { Mode, TimelineEvent, ApiTimelineEvent } from "../types/timeline";

export async function fetchTimelineModes(unitId?: string): Promise<Mode[]> {
  const url = unitId
    ? resolveApiUrl(`/api/timeline/modes?unitId=${encodeURIComponent(unitId)}`)
    : resolveApiUrl("/api/timeline/modes");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load modes");
  const data = (await res.json()) as { modes?: Mode[] };
  return data.modes ?? [];
}

export async function createTimelineMode(mode: Omit<Mode, "id">): Promise<Mode> {
  const res = await fetch(resolveApiUrl("/api/timeline/modes"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mode),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || "Failed to create mode");
  }
  return res.json();
}

export async function updateTimelineMode(mode: Mode): Promise<Mode> {
  const res = await fetch(resolveApiUrl(`/api/timeline/modes/${mode.id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mode),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || "Failed to update mode");
  }
  return res.json();
}

export async function deleteTimelineMode(id: number): Promise<void> {
  const res = await fetch(resolveApiUrl(`/api/timeline/modes/${id}`), {
    method: "DELETE",
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || "Failed to delete mode");
  }
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
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || "Failed to start test mode");
  }
}

export async function fetchTimelineEvents(unitId?: string): Promise<TimelineEvent[]> {
  const url = unitId
    ? resolveApiUrl(`/api/timeline/events?unitId=${encodeURIComponent(unitId)}`)
    : resolveApiUrl("/api/timeline/events");
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load events");
  const rawEvents = (await res.json()) as ApiTimelineEvent[];

  return rawEvents
    .map((e) => ({
      id: e.id,
      startTime: e.startTime ?? e.start_time ?? "08:00",
      dayOfWeek: (e.dayOfWeek ?? e.day_of_week ?? 0) as number,
      hruConfig: e.hruConfig ?? e.hru_config ?? null,
      luftatorConfig: e.luftatorConfig ?? e.luftator_config ?? null,
      enabled: e.enabled ?? true,
    }))
    .filter((e) => e.dayOfWeek >= 0 && e.dayOfWeek <= 6);
}

export async function saveTimelineEvent(
  event: TimelineEvent,
  unitId?: string,
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

  const url = unitId
    ? resolveApiUrl(`/api/timeline/events?unitId=${encodeURIComponent(unitId)}`)
    : resolveApiUrl("/api/timeline/events");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || "Failed to save event");
  }
  return res.json();
}

export async function deleteTimelineEvent(id: number): Promise<void> {
  const res = await fetch(resolveApiUrl(`/api/timeline/events/${id}`), {
    method: "DELETE",
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || "Failed to delete event");
  }
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
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || "Failed to activate boost");
  }
  const data = await res.json();
  return data.active;
}

export async function cancelBoost(): Promise<void> {
  const res = await fetch(resolveApiUrl("/api/timeline/boost"), {
    method: "DELETE",
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || "Failed to cancel boost");
  }
}
