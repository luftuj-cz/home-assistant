import { resolveApiUrl } from "@luftuj/shared/utils/api";
import type { Valve, ValveGroup } from "@luftuj/shared/types/valve";

import type { HaState } from "@luftuj/shared/types/homeAssistant";

function normalizeValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: string };
    return data.detail ?? fallback;
  } catch {
    return fallback;
  }
}

function isValveAvailable(state: HaState): boolean {
  const rawState = String(state.state ?? "")
    .trim()
    .toLowerCase();
  const attrs = state.attributes ?? {};
  const attributeAvailable = attrs.available;

  if (attrs.restored === true) {
    return false;
  }

  if (attributeAvailable === false) {
    return false;
  }

  if (rawState === "unavailable" || rawState === "unknown" || rawState === "offline") {
    return false;
  }

  return Number.isFinite(Number(state.state));
}

function mapValve(state: HaState): Valve {
  const attrs = state.attributes ?? {};
  return {
    entityId: state.entity_id,
    name: (attrs.friendly_name as string) ?? state.entity_id,
    value: normalizeValue(state.state, 0),
    min: normalizeValue(attrs.min, 0),
    max: normalizeValue(attrs.max, 90),
    step: normalizeValue(attrs.step, 5),
    state: state.state,
    isAvailable: isValveAvailable(state),
    attributes: attrs,
  };
}

export async function fetchValves(): Promise<Valve[]> {
  const res = await fetch(resolveApiUrl("/api/valves"));
  if (!res.ok) throw new Error("Failed to fetch valves");

  const data = (await res.json()) as HaState[];

  if (Array.isArray(data)) {
    return data.map(mapValve);
  }
  const wrapped = data as unknown as { valves?: HaState[] };
  return (wrapped.valves ?? []).map(mapValve);
}

export async function fetchValveGroups(): Promise<ValveGroup[]> {
  const res = await fetch(resolveApiUrl("/api/valve-groups"));
  if (!res.ok) throw new Error("Failed to fetch valve groups");
  return (await res.json()) as ValveGroup[];
}

export async function createValveGroup(input: {
  name: string;
  sortOrder?: number;
}): Promise<ValveGroup> {
  const res = await fetch(resolveApiUrl("/api/valve-groups"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to create valve group"));
  return (await res.json()) as ValveGroup;
}

export async function updateValveGroup(
  id: number,
  input: { name: string; sortOrder?: number },
): Promise<ValveGroup> {
  const res = await fetch(resolveApiUrl(`/api/valve-groups/${id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to update valve group"));
  return (await res.json()) as ValveGroup;
}

export async function deleteValveGroup(id: number): Promise<void> {
  const res = await fetch(resolveApiUrl(`/api/valve-groups/${id}`), { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete valve group");
}

export async function setValveGroupMembers(id: number, entityIds: string[]): Promise<ValveGroup> {
  const res = await fetch(resolveApiUrl(`/api/valve-groups/${id}/members`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityIds }),
  });
  if (!res.ok) throw new Error("Failed to set valve group members");
  return (await res.json()) as ValveGroup;
}

export async function bulkSetValveGroupValue(id: number, value: number): Promise<void> {
  const res = await fetch(resolveApiUrl(`/api/valve-groups/${id}/bulk-set`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error("Failed to bulk set valve group value");
}
