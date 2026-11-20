import { describe, expect, test } from "vitest";

import { at, createHouse, runAt, simulate, type Readings } from "./house.js";

/** Room a at `from` for ten seconds, then steady at 800 ppm. */
function settlingAt800(from: number): (time: number) => Readings {
  return (time) => ({ a: time < 10 ? from : 800, b: 500, c: 500 });
}

describe("filter precision", () => {
  test("a steady reading at TH1 is reached and registered with the default alpha", () => {
    const house = createHouse({ alpha: 0.3 });
    const reports = simulate(house, 200, settlingAt800(700));

    expect(house.engine.getFilteredCO2("a")).toBe(800);
    expect(at(reports, 200).roomsAboveTh1).toEqual(["a"]);
  });

  test("a small alpha does not stall short of the reading", () => {
    const house = createHouse({ alpha: 0.05 });
    simulate(house, 400, settlingAt800(700));

    expect(house.engine.getFilteredCO2("a")).toBe(800);
  });

  test("a small alpha does not stall above the reading either", () => {
    const house = createHouse({ alpha: 0.05 });
    simulate(house, 400, settlingAt800(900));

    expect(house.engine.getFilteredCO2("a")).toBe(800);
  });

  test("the public value is a whole number, the state keeps the fraction", () => {
    const house = createHouse({ alpha: 0.3 });
    runAt(house, 0, { a: 500, b: 500, c: 500 });
    runAt(house, 1, { a: 601, b: 500, c: 500 });

    expect(house.engine.getFilteredCO2("a")).toBe(530);
    expect(house.engine.getRoomState("a")?.filteredCO2).toBeCloseTo(530.3, 6);
  });
});
