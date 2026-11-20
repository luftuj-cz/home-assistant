import { describe, expect, test } from "vitest";

import type { RunReport } from "../src/index.js";
import {
  ALL_LOW,
  allLow,
  at,
  createHouse,
  powerChanges,
  runAt,
  simulate,
  type House,
} from "./house.js";

/** Runs at seconds 0, period, 2·period, … up to lastSecond; the reports are keyed by second. */
function simulateEvery(house: House, period: number, lastSecond: number): Map<number, RunReport> {
  const reports = new Map<number, RunReport>();
  for (let time = 0; time <= lastSecond; time += period) {
    reports.set(time, runAt(house, time, ALL_LOW));
  }
  return reports;
}

function powerAt(reports: Map<number, RunReport>, time: number): number {
  const report = reports.get(time);
  if (report === undefined) {
    throw new Error(`No run at second ${time}`);
  }
  return report.powerAfter;
}

describe("the step-down gate", () => {
  test("a room in the hysteresis band stops the descent", () => {
    const reports = simulate(createHouse({ hru: 6 }), 3600, () => ({ a: 780, b: 500, c: 500 }));

    expect(at(reports, 120).branch).toBe("allBelow");
    expect(at(reports, 3600).branch).toBe("allBelow");
    expect(at(reports, 3600).powerAfter).toBe(6);
  });

  test("the descent resumes one interval after the room is under", () => {
    const reports = simulate(createHouse({ hru: 6 }), 1300, (time) => ({
      a: time < 1000 ? 780 : 700,
      b: 500,
      c: 500,
    }));

    expect(at(reports, 1299).powerAfter).toBe(6);
    expect(at(reports, 1300).powerAfter).toBe(5);
  });

  test("a closed gate pauses the count, it does not clear it", () => {
    // Open from second 120 (200 s counted by 320), closed for seconds 320 to 419, open again from
    // 420: the count goes on from 200 at second 421 and is full at 521, not at 720.
    const reports = simulate(createHouse({ hru: 6 }), 600, (time) => ({
      a: time >= 320 && time < 420 ? 760 : 700,
      b: 500,
      c: 500,
    }));

    expect(powerChanges(reports)).toEqual([{ time: 521, power: 5 }]);
  });

  test("holds the fluctuation branch too", () => {
    const reports = simulate(createHouse({ hru: 8 }), 3600, () => ({ a: 760, b: 760, c: 500 }));

    expect(at(reports, 3600).branch).toBe("fluctuation");
    expect(at(reports, 3600).powerAfter).toBe(8);
  });

  test("lets fluctuation lower the power when every room is under", () => {
    const reports = simulate(createHouse({ hru: 8 }), 1320, () => ({ a: 720, b: 720, c: 500 }));

    expect(at(reports, 120).branch).toBe("fluctuation");
    expect(at(reports, 419).powerAfter).toBe(8);
    expect(at(reports, 420).powerAfter).toBe(7);
    expect(at(reports, 1320).powerAfter).toBe(4);
  });

  test("does not hold back the raise to Pmove", () => {
    const reports = simulate(createHouse({ hru: 2 }), 120, () => ({ a: 760, b: 760, c: 500 }));

    expect(at(reports, 120)).toMatchObject({
      branch: "fluctuation",
      powerBefore: 2,
      powerAfter: 4,
    });
  });
});

describe("the pace of the way down", () => {
  test("the interval defaults to five minutes", () => {
    expect(createHouse().engine.hruPowerStepDownInterval).toBe(300);
  });

  test("an empty house steps down every five minutes, the first step included", () => {
    const reports = simulate(createHouse({ hru: 10 }), 2520, allLow);

    expect(at(reports, 120).branch).toBe("allBelow");
    expect(at(reports, 419).powerAfter).toBe(10);
    expect(at(reports, 420).powerAfter).toBe(9);
    expect(at(reports, 720).powerAfter).toBe(8);
    expect(at(reports, 2519).powerAfter).toBe(3);
    expect(at(reports, 2520).powerAfter).toBe(2);
  });

  test("an interval of one second", () => {
    const house = createHouse({ hru: 10 });
    house.engine.hruPowerStepDownInterval = 1;
    const reports = simulate(house, 128, allLow);

    expect(at(reports, 120).powerAfter).toBe(10);
    expect(at(reports, 121).powerAfter).toBe(9);
    expect(at(reports, 128).powerAfter).toBe(2);
  });

  test.each([1, 30])("the same pace with a run every %i s", (period) => {
    const house = createHouse({ hru: 10 });
    house.engine.hruPowerStepDownInterval = 60;
    const reports = simulateEvery(house, period, 600);

    expect(powerAt(reports, 150)).toBe(10);
    expect(powerAt(reports, 180)).toBe(9);
    expect(powerAt(reports, 240)).toBe(8);
    expect(powerAt(reports, 570)).toBe(3);
    expect(powerAt(reports, 600)).toBe(2);
  });

  test("carries the remainder of an interval over to the next run", () => {
    const house = createHouse({ hru: 10 });
    house.engine.hruPowerStepDownInterval = 45;
    const reports = simulateEvery(house, 30, 300);

    const powers = [120, 150, 180, 210, 240, 270, 300].map((time) => powerAt(reports, time));
    expect(powers).toEqual([10, 10, 9, 8, 8, 7, 6]);
  });

  test("does not credit the time before the descent", () => {
    const house = createHouse({ hru: 10 });
    const first = runAt(house, 0, ALL_LOW);
    const second = runAt(house, 1000, ALL_LOW);

    expect(first.branch).toBe("none");
    expect(second.branch).toBe("allBelow");
    expect(second.powerAfter).toBe(10);
  });

  test("builds no backlog while the power sits at Pmove", () => {
    const house = createHouse({ hru: 2 });
    house.engine.hruPowerStepDownInterval = 60;
    const fluctuationEnds = 3600;
    const reports = simulate(house, fluctuationEnds + 400, (time) =>
      time < fluctuationEnds ? { a: 720, b: 720, c: 500 } : ALL_LOW,
    );
    const firstAllBelow = reports.findIndex(
      (report, time) => time >= fluctuationEnds && report.branch === "allBelow",
    );

    expect(at(reports, firstAllBelow - 1).powerAfter).toBe(4);
    expect(at(reports, firstAllBelow + 59).powerAfter).toBeGreaterThanOrEqual(3);
    expect(at(reports, firstAllBelow + 120).powerAfter).toBe(2);
  });

  test.each([
    ["0", 0],
    ["NaN", Number.NaN],
  ])("an interval of %s means no pace limit and never writes NaN", (_name, interval) => {
    const house = createHouse({ hru: 10 });
    house.engine.hruPowerStepDownInterval = interval;
    const reports = simulate(house, 120, allLow);

    expect(at(reports, 119).powerAfter).toBe(10);
    expect(at(reports, 120).powerAfter).toBe(2);
  });
});

describe("a room above TH1 whose sensor went silent", () => {
  test("holds the power for an hour, then lets it down", () => {
    const reports = simulate(createHouse({ hru: 6 }), 4199, (time) => ({
      a: time < 300 ? 900 : null,
      b: 500,
      c: 500,
    }));

    expect(at(reports, 300).branch).toBe("allBelow");
    expect(at(reports, 4198).powerAfter).toBe(6);
    expect(at(reports, 4199).powerAfter).toBe(5);
  });

  test("a single missing reading changes nothing for the power or the review", () => {
    const reports = simulate(createHouse({ hru: 5 }), 720, (time) => ({
      a: time === 400 ? null : 900,
      b: 500,
      c: 500,
    }));

    expect(at(reports, 400)).toMatchObject({ branch: "allBelow", powerAfter: 5 });
    expect(at(reports, 719).powerAfter).toBe(5);
    expect(at(reports, 720)).toMatchObject({
      powerAfter: 6,
      powerReview: { lane: "slow", raised: true, asked: ["a"], held: [] },
    });
  });

  test("a reading that returns after the hold starts over", () => {
    // Room b stays above TH1 and keeps the review clock running, with reviews at 720, 1320, …
    const reports = simulate(createHouse(), 8520, (time) => ({
      a: time < 300 || time >= 7500 ? 900 : null,
      b: 900,
      c: 500,
    }));

    expect(at(reports, 7920).powerReview?.asked).not.toContain("a");
    expect(at(reports, 7920).powerReview?.held).toContain("a");
    expect(at(reports, 8520).powerReview?.asked).toContain("a");
  });

  test("a hold of zero lets the room go at once", () => {
    const house = createHouse({ hru: 6 });
    house.engine.missingReadingHold = 0;
    house.engine.hruPowerStepDownInterval = 1;
    const reports = simulate(house, 301, (time) => ({
      a: time < 300 ? 900 : null,
      b: 500,
      c: 500,
    }));

    expect(at(reports, 300).powerAfter).toBe(6);
    expect(at(reports, 301).powerAfter).toBe(5);
  });
});
