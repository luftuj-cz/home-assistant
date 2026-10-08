import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseApiError } from "@luftuj/shared/utils/apiError";
import type {
  CustomOverride,
  CustomTimelineSummary,
  CustomTimelinesResponse,
} from "@luftuj/shared/types/customTimeline";
import type { ApiTimelineEvent, TimelineEvent } from "@luftuj/shared/types/timeline";

function scoped(path: string, unitId?: string): string {
  return resolveApiUrl(unitId ? `${path}?unitId=${encodeURIComponent(unitId)}` : path);
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw await parseApiError(res);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function fetchCustomTimelines(unitId?: string): Promise<CustomTimelinesResponse> {
  return send<CustomTimelinesResponse>(scoped("/api/custom-timelines", unitId), "GET");
}

export async function createCustomTimeline(
  name: string,
  unitId?: string,
): Promise<CustomTimelineSummary> {
  return send(scoped("/api/custom-timelines", unitId), "POST", { name });
}

export async function renameCustomTimeline(id: number, name: string, unitId?: string) {
  return send(scoped(`/api/custom-timelines/${id}`, unitId), "PATCH", { name });
}

export async function deleteCustomTimeline(id: number, unitId?: string): Promise<void> {
  await send<void>(scoped(`/api/custom-timelines/${id}`, unitId), "DELETE");
}

export async function fetchCustomOverride(unitId?: string): Promise<CustomOverride | null> {
  const data = await send<{ override: CustomOverride | null }>(
    scoped("/api/custom-timelines/override", unitId),
    "GET",
  );
  return data.override;
}

export async function activateCustomOverride(
  request: { customTimelineId: number; startsAt?: string; endsAt?: string | null },
  unitId?: string,
): Promise<CustomOverride | null> {
  const data = await send<{ override: CustomOverride | null }>(
    scoped("/api/custom-timelines/override", unitId),
    "PUT",
    request,
  );
  return data.override;
}

export async function endCustomOverride(unitId?: string): Promise<void> {
  await send<void>(scoped("/api/custom-timelines/override", unitId), "DELETE");
}

function toTimelineEvent(event: ApiTimelineEvent): TimelineEvent {
  return {
    id: event.id,
    startTime: event.startTime ?? "08:00",
    // Null is a valid value here, not a missing one: the event runs every day.
    // Defaulting it to Monday showed it on one day and, on the next save from
    // the UI, narrowed it to that day for good.
    dayOfWeek: event.dayOfWeek ?? null,
    hruConfig: event.hruConfig ?? null,
    luftatorConfig: null,
    enabled: event.enabled ?? true,
  };
}

export async function fetchCustomTimelineEvents(
  id: number,
  unitId?: string,
): Promise<TimelineEvent[]> {
  const data = await send<{ events: ApiTimelineEvent[] }>(
    scoped(`/api/custom-timelines/${id}/events`, unitId),
    "GET",
  );
  return data.events.map(toTimelineEvent);
}

/**
 * A custom event carries the mode reference and nothing else: its values come
 * from the active season, and the backend rejects any it is sent.
 */
export async function saveCustomTimelineEvent(
  id: number,
  event: TimelineEvent,
  unitId?: string,
): Promise<TimelineEvent> {
  const body = {
    modeId: Number(event.hruConfig?.mode),
    dayOfWeek: event.dayOfWeek,
    startTime: event.startTime,
    enabled: event.enabled,
    priority: 0,
  };
  const saved = await send<ApiTimelineEvent>(
    event.id === undefined
      ? scoped(`/api/custom-timelines/${id}/events`, unitId)
      : scoped(`/api/custom-timelines/${id}/events/${event.id}`, unitId),
    event.id === undefined ? "POST" : "PUT",
    body,
  );
  return toTimelineEvent(saved);
}

export async function deleteCustomTimelineEvent(
  id: number,
  eventId: number,
  unitId?: string,
): Promise<void> {
  await send<void>(scoped(`/api/custom-timelines/${id}/events/${eventId}`, unitId), "DELETE");
}

export async function fillCustomTimeline(
  id: number,
  modeId: number,
  unitId?: string,
): Promise<TimelineEvent[]> {
  const data = await send<{ events: ApiTimelineEvent[] }>(
    scoped(`/api/custom-timelines/${id}/fill`, unitId),
    "POST",
    { modeId },
  );
  return data.events.map(toTimelineEvent);
}
