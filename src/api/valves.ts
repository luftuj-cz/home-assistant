import { resolveApiUrl } from "../utils/api";
import type { Valve } from "../types/valve";

import type { HaState } from "../types/homeAssistant";

function normalizeValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
