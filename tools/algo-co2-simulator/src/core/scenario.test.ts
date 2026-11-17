import { describe, expect, test } from "vitest";

import { occupancyAt, stepsDueAt } from "./scenario.ts";
import type { Scenario } from "./house.ts";

const HOUR = 3600;

const scenario: Scenario = {
  id: "den",
  name: "Den",
  initialCo2Ppm: {},
  steps: [
    { atSecondOfDay: 22 * HOUR, roomId: "loznice", people: 2, activity: "sleeping" },
    { atSecondOfDay: 7 * HOUR, roomId: "loznice", people: 0, activity: "sitting" },
    { atSecondOfDay: 7 * HOUR, roomId: "obyvak", people: 3, activity: "active" },
    { atSecondOfDay: 9 * HOUR, roomId: "obyvak", people: 1, activity: "sitting" },
  ],
};

describe("occupancyAt", () => {
  test("occupancyAt takes the latest step at or before the time", () => {
    const rooms = ["obyvak", "loznice"];

    expect(occupancyAt(scenario, rooms, 7 * HOUR).get("obyvak")).toEqual({
      people: 3,
      activity: "active",
    });
    expect(occupancyAt(scenario, rooms, 8 * HOUR + 59 * 60).get("obyvak")).toEqual({
      people: 3,
      activity: "active",
    });
    expect(occupancyAt(scenario, rooms, 9 * HOUR).get("obyvak")).toEqual({
      people: 1,
      activity: "sitting",
    });
    expect(occupancyAt(scenario, rooms, 12 * HOUR).get("loznice")).toEqual({
      people: 0,
      activity: "sitting",
    });
  });

  test("occupancyAt wraps across midnight", () => {
    const occupancy = occupancyAt(scenario, ["loznice"], 3 * HOUR);

    expect(occupancy.get("loznice")).toEqual({ people: 2, activity: "sleeping" });
  });

  test("occupancyAt leaves rooms without steps empty", () => {
    const occupancy = occupancyAt(scenario, ["obyvak", "pracovna"], 12 * HOUR);

    expect(occupancy.get("pracovna")).toEqual({ people: 0, activity: "sitting" });
    expect([...occupancy.keys()]).toEqual(["obyvak", "pracovna"]);
  });

  test("occupancyAt leaves every room empty without a scenario", () => {
    const occupancy = occupancyAt(null, ["obyvak", "loznice"], 12 * HOUR);

    expect(occupancy.get("obyvak")).toEqual({ people: 0, activity: "sitting" });
    expect(occupancy.get("loznice")).toEqual({ people: 0, activity: "sitting" });
  });

  test("occupancyAt lets the later of two simultaneous steps win", () => {
    const simultaneous: Scenario = {
      ...scenario,
      steps: [
        { atSecondOfDay: HOUR, roomId: "obyvak", people: 1, activity: "sitting" },
        { atSecondOfDay: HOUR, roomId: "obyvak", people: 4, activity: "active" },
      ],
    };

    expect(occupancyAt(simultaneous, ["obyvak"], HOUR).get("obyvak")).toEqual({
      people: 4,
      activity: "active",
    });
  });
});

describe("stepsDueAt", () => {
  test("stepsDueAt returns only steps at exactly that second", () => {
    expect(stepsDueAt(scenario, 7 * HOUR).map((step) => step.roomId)).toEqual([
      "loznice",
      "obyvak",
    ]);
    expect(stepsDueAt(scenario, 7 * HOUR + 1)).toEqual([]);
    expect(stepsDueAt(scenario, 7 * HOUR - 1)).toEqual([]);
  });

  test("stepsDueAt returns nothing without a scenario", () => {
    expect(stepsDueAt(null, 7 * HOUR)).toEqual([]);
  });
});
