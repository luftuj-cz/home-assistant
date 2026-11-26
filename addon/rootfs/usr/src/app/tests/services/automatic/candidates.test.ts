import { describe, expect, it } from "vitest";
import { sensorCandidates } from "../../../src/services/automatic/candidates.js";
import type { HassState } from "../../../src/services/homeAssistantClient.js";

function hass(
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HassState {
  return { entity_id: entityId, state, attributes };
}

describe("sensorCandidates", () => {
  it("offers a sensor without a device class after the CO2 ones", () => {
    const result = sensorCandidates([
      hass("sensor.co2_manual", "812", { unit_of_measurement: "ppm", friendly_name: "Ruční" }),
      hass("sensor.teplota", "21", { unit_of_measurement: "°C", friendly_name: "A teplota" }),
      hass("sensor.trida", "700", { device_class: "carbon_dioxide", friendly_name: "Z třída" }),
    ]);
    expect(result.map((c) => c.entityId)).toEqual([
      "sensor.trida",
      "sensor.co2_manual",
      "sensor.teplota",
    ]);
  });

  it("offers each entity of a multi-value device with its value and unit", () => {
    const result = sensorCandidates([
      hass("sensor.vzduch_co2", "812", { unit_of_measurement: "ppm" }),
      hass("sensor.vzduch_temperature", "21.4", { unit_of_measurement: "°C" }),
      hass("sensor.vzduch_humidity", "45", { unit_of_measurement: "%" }),
    ]);
    expect(result.find((c) => c.entityId === "sensor.vzduch_co2")?.values).toEqual([
      { attribute: null, value: 812, unit: "ppm" },
    ]);
    expect(result).toHaveLength(3);
  });

  it("offers the numeric attributes of an entity whose state is text", () => {
    const [candidate] = sensorCandidates([
      hass("sensor.vzduch", "online", { co2: 812, temperature: "21.4", friendly_name: "Vzduch" }),
    ]);
    expect(candidate!.values).toEqual([
      { attribute: "co2", value: 812, unit: null },
      { attribute: "temperature", value: 21.4, unit: null },
    ]);
  });

  it("leaves out other domains and entities without any number", () => {
    expect(
      sensorCandidates([
        hass("number.luftator_a", "45"),
        hass("sensor.status", "ok", { friendly_name: "Status", on: true }),
      ]),
    ).toEqual([]);
  });
});
