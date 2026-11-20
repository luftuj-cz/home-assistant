import { describe, expect, test } from "vitest";

import { at, createHouse, powerChanges, simulate } from "./house.js";

describe("timing of the TH2 power step", () => {
  test("a room already handled by th1 gets its first step after the time limit above TH2", () => {
    const reports = simulate(createHouse(), 500, (time) => ({
      a: time < 125 ? 900 : 1300,
      b: 500,
      c: 500,
    }));

    expect(at(reports, 120)).toMatchObject({ branch: "th1", roomsActedOn: ["a"] });
    expect(powerChanges(reports)).toEqual([
      { time: 245, power: 3 },
      { time: 365, power: 4 },
      { time: 485, power: 5 },
    ]);
  });

  test("a room that goes straight above TH2 steps as before", () => {
    const reports = simulate(createHouse(), 400, () => ({ a: 1300, b: 500, c: 500 }));

    expect(powerChanges(reports)).toEqual([
      { time: 120, power: 3 },
      { time: 240, power: 4 },
      { time: 360, power: 5 },
    ]);
  });

  test("a room marked by allBelow is not held back either", () => {
    const reports = simulate(createHouse(), 500, (time) => ({
      a: time < 300 ? 500 : 1300,
      b: 500,
      c: 500,
    }));

    expect(powerChanges(reports)[0]).toEqual({ time: 420, power: 3 });
  });

  test("the rooms a step is attributed to are reported and put into cooldown", () => {
    const reports = simulate(createHouse(), 246, (time) => ({
      a: time < 125 ? 900 : 1300,
      b: 500,
      c: 500,
    }));

    expect(at(reports, 245).roomsActedOn).toEqual(["a"]);
    expect(at(reports, 246).roomsInCooldown).toEqual(["a"]);
  });
});
