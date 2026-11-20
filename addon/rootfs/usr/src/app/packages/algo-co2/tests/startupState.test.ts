import { describe, expect, test } from "vitest";

import { at, createHouse, simulate } from "./house.js";

describe("room state from the first reading", () => {
  test("a room that starts inside the TH1 band counts as below TH1", () => {
    const reports = simulate(createHouse(), 120, () => ({ a: 780, b: 500, c: 500 }));

    expect(at(reports, 119).branch).toBe("none");
    expect(at(reports, 120).roomsBelowTh1).toEqual(["a", "b", "c"]);
    expect(at(reports, 120).branch).toBe("allBelow");
  });

  test("a restart with partially closed valves returns to the defaults", () => {
    const house = createHouse({ hru: 8 });
    house.engine.fluctuationEnabled = false;
    house.valves.forEach((valve) => {
      valve.value = house.engine.partialCloseValue;
    });
    const reports = simulate(house, 130, () => ({ a: 770, b: 760, c: 790 }));

    expect(at(reports, 119).powerAfter).toBe(8);
    expect(house.valves.map((valve) => valve.value)).toEqual([0, 0, 0]);
    expect(at(reports, 120).powerAfter).toBe(7);
    expect(at(reports, 130).powerAfter).toBe(2);
  });

  test("a room that starts inside the band and then rises is handled as usual", () => {
    const reports = simulate(createHouse(), 150, (time) => ({
      a: time < 30 ? 780 : 820,
      b: 500,
      c: 500,
    }));

    expect(at(reports, 149).roomsActedOn).toEqual([]);
    expect(at(reports, 150)).toMatchObject({ branch: "th1", roomsActedOn: ["a"] });
  });

  test("the hysteresis on the way down is unchanged", () => {
    const reports = simulate(createHouse(), 400, (time) => ({
      a: time < 200 ? 900 : 780,
      b: 500,
      c: 500,
    }));

    expect(at(reports, 400).roomsAboveTh1).toEqual(["a"]);
  });

  test("a room that starts inside the TH2 band is not above TH2", () => {
    const reports = simulate(createHouse(), 600, () => ({ a: 1150, b: 500, c: 500 }));

    expect(reports.every((report) => report.roomsAboveTh2.length === 0)).toBe(true);
    expect(at(reports, 600)).toMatchObject({ branch: "th1", powerAfter: 2 });
  });
});
