import { describe, expect, it } from "vitest";
import { readingFrom } from "../../../src/services/automatic/readings.js";
import type { HassState } from "../../../src/services/homeAssistantClient.js";

const NOW = Date.parse("2026-11-26T12:00:00Z");

function state(
  value: string,
  attributes: Record<string, unknown> = {},
  ageSeconds = 20,
): HassState {
  const at = new Date(NOW - ageSeconds * 1000).toISOString();
  return {
    entity_id: "sensor.x",
    state: value,
    attributes,
    last_updated: at,
    last_reported: at,
  };
}

describe("readingFrom", () => {
  it("reads a numeric string in ppm", () => {
    expect(readingFrom(state("812.4", { unit_of_measurement: "ppm" }), null, NOW)).toEqual({
      ppm: 812.4,
      ageSeconds: 20,
    });
  });

  it("gives no reading for an unavailable or unknown sensor", () => {
    expect(readingFrom(state("unavailable"), null, NOW).problem).toBe("unavailable");
    expect(readingFrom(state("unknown"), null, NOW).problem).toBe("unavailable");
  });

  it("gives no reading for a missing entity", () => {
    expect(readingFrom(undefined, null, NOW)).toEqual({ ppm: null, problem: "missing" });
  });

  it("rejects a unit other than ppm on a state source", () => {
    expect(readingFrom(state("45", { unit_of_measurement: "%" }), null, NOW)).toMatchObject({
      ppm: null,
      problem: "wrongUnit",
    });
  });

  it("accepts the unit in another case", () => {
    expect(readingFrom(state("700", { unit_of_measurement: "PPM" }), null, NOW).ppm).toBe(700);
  });

  it("ignores the entity's unit for an attribute source", () => {
    const entity = state("21.4", { unit_of_measurement: "°C", co2: 812 });
    expect(readingFrom(entity, "co2", NOW).ppm).toBe(812);
  });

  it("reads an attribute given as a string", () => {
    expect(readingFrom(state("online", { co2: "640" }), "co2", NOW).ppm).toBe(640);
  });

  it("gives no reading for a missing attribute or a text state", () => {
    expect(readingFrom(state("online", {}), "co2", NOW).problem).toBe("notNumber");
    expect(readingFrom(state("err"), null, NOW).problem).toBe("notNumber");
  });

  it("gives no reading for 0 after a sensor restart", () => {
    expect(readingFrom(state("0"), null, NOW)).toMatchObject({ ppm: null, problem: "notNumber" });
  });

  it("reads a very high value", () => {
    expect(readingFrom(state("65535", { unit_of_measurement: "ppm" }), null, NOW).ppm).toBe(65535);
  });

  it("gives no reading for a value older than the limit", () => {
    expect(readingFrom(state("900", {}, 31 * 60), null, NOW)).toMatchObject({
      ppm: null,
      problem: "stale",
    });
    expect(readingFrom(state("900", {}, 31 * 60), null, NOW, 3600).ppm).toBe(900);
  });

  it("measures the age from last_reported, falling back to last_updated", () => {
    const old = new Date(NOW - 40 * 60_000).toISOString();
    const recent = new Date(NOW - 60_000).toISOString();
    const reported: HassState = {
      entity_id: "sensor.x",
      state: "800",
      attributes: {},
      last_updated: old,
      last_reported: recent,
    };
    expect(readingFrom(reported, null, NOW).ppm).toBe(800);
    const { last_reported: _ignored, ...withoutReported } = reported;
    expect(readingFrom(withoutReported, null, NOW).problem).toBe("stale");
  });
});
