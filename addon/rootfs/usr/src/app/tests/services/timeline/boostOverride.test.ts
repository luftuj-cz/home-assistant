import { describe, expect, it } from "vitest";
import {
  BoostModeNotConfiguredError,
  buildBoostOverride,
} from "../../../src/services/timeline/boostOverride.js";
import type { TimelineMode } from "../../../src/types/index.js";

const MODE: TimelineMode = {
  id: 7,
  name: "Vetrani",
  isBoost: true,
  power: 80,
  temperature: 21,
  nativeMode: 2,
  variables: { power: 80 },
  luftatorConfig: { "number.luftator_kuchyne": 100 },
  scriptEntityIds: ["script.okno"],
  configured: true,
};

/**
 * Every boost entry point - HTTP and both MQTT buttons - stores the mode's
 * values frozen at start, so a boost crossing a season boundary keeps running
 * on what it began with.
 */
describe("buildBoostOverride", () => {
  it("freezes the mode's values into the override", () => {
    const override = buildBoostOverride(MODE, 30, "2026-09-09T18:00:00.000Z");

    expect(override).toEqual({
      modeId: 7,
      durationMinutes: 30,
      endTime: "2026-09-09T18:00:00.000Z",
      customConfig: {
        nativeMode: 2,
        power: 80,
        temperature: 21,
        variables: { power: 80 },
        luftatorConfig: { "number.luftator_kuchyne": 100 },
        scriptEntityIds: ["script.okno"],
      },
    });
  });

  it("refuses a mode with no values in the running season", () => {
    expect(() => buildBoostOverride({ ...MODE, configured: false }, 30, "x")).toThrow(
      BoostModeNotConfiguredError,
    );
  });

  it("accepts a mode resolved without a season (legacy callers)", () => {
    const { configured: _configured, ...legacy } = MODE;
    expect(() => buildBoostOverride(legacy, 30, "x")).not.toThrow();
  });
});
