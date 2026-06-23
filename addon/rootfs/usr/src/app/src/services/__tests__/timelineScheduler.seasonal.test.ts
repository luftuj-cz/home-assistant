import { describe, expect, it } from "vitest";
import {
  applySeasonalOverrideToPayload,
  buildTimelineModePayload,
  type ActivePayload,
} from "../timelineScheduler.js";

describe("timeline scheduler seasonal helpers", () => {
  it("builds a payload from a timeline mode", () => {
    const payload = buildTimelineModePayload(
      {
        id: 1,
        name: "Comfort",
        nativeMode: 3,
        power: 45,
        temperature: 22,
        variables: { humidity: 50 },
        luftatorConfig: { "number.luftator_kitchen": 70 },
      },
      "schedule",
    );

    expect(payload).toEqual({
      source: "schedule",
      friendlyModeName: "Comfort",
      hruConfig: {
        mode: 3,
        power: 45,
        temperature: 22,
        variables: { humidity: 50 },
      },
      luftatorConfig: { "number.luftator_kitchen": 70 },
    });
  });

  it("applies base seasonal mode over the scheduled payload", () => {
    const payload: ActivePayload = {
      source: "schedule",
      hruConfig: { mode: 1, power: 10, variables: { co2: 400 } },
      luftatorConfig: { "number.luftator_bedroom": 25 },
      id: 5,
      friendlyModeName: "Original",
    };

    const merged = applySeasonalOverrideToPayload(payload, {
      season: "summer",
      baseModeId: 2,
      modeName: "Summer",
      baseMode: {
        id: 2,
        name: "Summer",
        nativeMode: 4,
        power: 60,
        temperature: 20,
        variables: { bypass: 1 },
        luftatorConfig: { "number.luftator_kitchen": 80 },
      },
      power: undefined,
      temperature: undefined,
      variables: undefined,
      luftatorConfig: undefined,
    });

    expect(merged.hruConfig).toEqual({
      mode: 4,
      power: 60,
      temperature: 20,
      variables: { co2: 400, bypass: 1 },
    });
    expect(merged.luftatorConfig).toEqual({
      "number.luftator_bedroom": 25,
      "number.luftator_kitchen": 80,
    });
    expect(merged.friendlyModeName).toBe("Summer");
  });

  it("lets explicit seasonal overrides win over base mode values", () => {
    const merged = applySeasonalOverrideToPayload(
      {
        source: "schedule",
        hruConfig: { power: 10, variables: { co2: 400 } },
        luftatorConfig: { "number.luftator_bedroom": 25 },
      },
      {
        season: "winter",
        baseModeId: 3,
        modeName: "Winter",
        baseMode: {
          id: 3,
          name: "Winter",
          power: 40,
          temperature: 21,
          variables: { co2: 500, bypass: 0 },
          luftatorConfig: { "number.luftator_bedroom": 50 },
        },
        power: 70,
        temperature: 24,
        variables: { co2: 700 },
        luftatorConfig: { "number.luftator_bedroom": 90 },
      },
    );

    expect(merged.hruConfig).toEqual({
      power: 70,
      temperature: 24,
      variables: { co2: 700, bypass: 0 },
    });
    expect(merged.luftatorConfig).toEqual({ "number.luftator_bedroom": 90 });
  });
});
