import type { HassState } from "../homeAssistantClient.js";

/** One numeric value of an entity: its state (`attribute` null) or one of its attributes. */
export interface CandidateValue {
  attribute: string | null;
  value: number;
  /** The entity's unit, for the state only: attributes carry no unit in Home Assistant. */
  unit: string | null;
}

export interface SensorCandidate {
  entityId: string;
  name: string;
  deviceClass: string | null;
  unit: string | null;
  lastReported: string | null;
  values: CandidateValue[];
}

function numeric(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function text(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

function rank(candidate: SensorCandidate): number {
  if (candidate.deviceClass === "carbon_dioxide") return 0;
  if (candidate.unit?.trim().toLowerCase() === "ppm") return 1;
  return 2;
}

/**
 * The `sensor.*` entities that could be a CO2 source: those whose state or some attribute is a number. CO2
 * entities come first (device class, then unit ppm), then the rest by name. No entity is left out for lacking a
 * device class: hand-written MQTT sensors and attribute sources often have none.
 */
export function sensorCandidates(states: HassState[]): SensorCandidate[] {
  const candidates: SensorCandidate[] = [];
  for (const state of states) {
    if (!state.entity_id.startsWith("sensor.")) continue;
    const attributes = state.attributes ?? {};
    const unit = text(attributes.unit_of_measurement);
    const values: CandidateValue[] = [];

    const stateValue = numeric(state.state);
    if (stateValue !== null) values.push({ attribute: null, value: stateValue, unit });
    for (const [key, raw] of Object.entries(attributes)) {
      const value = numeric(raw);
      if (value !== null) values.push({ attribute: key, value, unit: null });
    }
    if (values.length === 0) continue;

    candidates.push({
      entityId: state.entity_id,
      name: text(attributes.friendly_name) ?? state.entity_id,
      deviceClass: text(attributes.device_class),
      unit,
      lastReported: state.last_reported ?? state.last_updated ?? null,
      values,
    });
  }
  return candidates.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name, "cs") ||
      a.entityId.localeCompare(b.entityId),
  );
}
