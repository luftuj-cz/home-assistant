import type { HassState } from "../homeAssistantClient.js";

/** Why a source gives no reading. */
export type ReadingProblem = "missing" | "unavailable" | "notNumber" | "wrongUnit" | "stale";

export interface Reading {
  /** CO2 in ppm, or null when the source gives no reading. */
  ppm: number | null;
  problem?: ReadingProblem;
  /** Seconds since the value last changed, when known. */
  ageSeconds?: number;
}

/** A value unchanged this long counts as a frozen sensor. Long, so a calm room with a steady sensor still counts. */
export const DEFAULT_MAX_READING_AGE_SECONDS = 7200;

const UNAVAILABLE_STATES = new Set(["unavailable", "unknown"]);

/** Home Assistant's own time of the last change, for a caller that does not track changes itself. */
function haChangedAt(state: HassState, attribute: string | null): number | null {
  const stamp = attribute ? state.last_updated : (state.last_changed ?? state.last_updated);
  if (!stamp) return null;
  const parsed = Date.parse(stamp);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Turns a Home Assistant state into a CO2 reading. The value is the state, or `attribute` when set. Any sensor
 * works: no device class is required. There is no upper limit, because the engine reads a sensor stuck at its
 * ceiling as "ventilate". The age is the time since the value last changed: `changedAtMs` when the caller tracks
 * it (the sensor store does), else Home Assistant's change time.
 */
export function readingFrom(
  state: HassState | null | undefined,
  attribute: string | null,
  nowMs: number,
  maxAgeSeconds: number = DEFAULT_MAX_READING_AGE_SECONDS,
  changedAtMs?: number,
): Reading {
  if (!state) return { ppm: null, problem: "missing" };
  if (UNAVAILABLE_STATES.has(state.state)) return { ppm: null, problem: "unavailable" };

  const at = changedAtMs ?? haChangedAt(state, attribute);
  const ageSeconds = at === null ? undefined : Math.max(0, (nowMs - at) / 1000);

  const raw = attribute ? state.attributes?.[attribute] : state.state;
  const value = typeof raw === "number" || typeof raw === "string" ? Number(raw) : Number.NaN;
  if (raw === "" || !Number.isFinite(value) || value <= 0) {
    return { ppm: null, problem: "notNumber", ageSeconds };
  }

  if (!attribute) {
    const unit = state.attributes?.unit_of_measurement;
    if (typeof unit === "string" && unit.trim() !== "" && unit.trim().toLowerCase() !== "ppm") {
      return { ppm: null, problem: "wrongUnit", ageSeconds };
    }
  }

  if (ageSeconds !== undefined && ageSeconds > maxAgeSeconds) {
    return { ppm: null, problem: "stale", ageSeconds };
  }
  return { ppm: value, ageSeconds };
}
