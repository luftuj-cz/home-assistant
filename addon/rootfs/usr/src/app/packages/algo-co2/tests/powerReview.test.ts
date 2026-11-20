import { describe, expect, test } from "vitest";

import type { RunReport } from "../src/index.js";
import { at, createHouse, powerChanges, runAt, simulate, type Readings } from "./house.js";

const NIGHT = 23 * 3600;

/** Room a at `co2`, the others at 500 ppm. */
function onlyA(co2: number): Readings {
  return { a: co2, b: 500, c: 500 };
}

function steady(co2: number): () => Readings {
  return () => onlyA(co2);
}

/** Room a at 1000 ppm until the review at second 720, then falling by 1 ppm every ten seconds. */
function fallingAfterFirstReview(time: number): number {
  return time <= 720 ? 1000 : Math.round(1000 - (time - 720) / 10);
}

/** The seconds, with the lane, at which a review took place. */
function reviews(reports: RunReport[]): { time: number; lane: string; raised: boolean }[] {
  return reports.flatMap((report, time) =>
    report.powerReview === null
      ? []
      : [{ time, lane: report.powerReview.lane, raised: report.powerReview.raised }],
  );
}

describe("slow lane: a room above TH1", () => {
  test("the first review comes one interval after the branch starts", () => {
    const reports = simulate(createHouse(), 1320, steady(900));

    expect(at(reports, 120)).toMatchObject({ branch: "th1", powerAfter: 2, powerReview: null });
    expect(powerChanges(reports)).toEqual([
      { time: 720, power: 3 },
      { time: 1320, power: 4 },
    ]);
    expect(at(reports, 720).powerReview).toEqual({
      lane: "slow",
      raised: true,
      asked: ["a"],
      held: [],
    });
  });

  test("a falling room is left alone", () => {
    const reports = simulate(createHouse(), 1320, (time) => onlyA(fallingAfterFirstReview(time)));

    expect(powerChanges(reports)).toEqual([{ time: 720, power: 3 }]);
    expect(at(reports, 1320).powerReview).toEqual({
      lane: "slow",
      raised: false,
      asked: [],
      held: ["a"],
    });
  });

  test("a drop of exactly the margin is not falling", () => {
    const reports = simulate(createHouse(), 1320, (time) => onlyA(time <= 720 ? 1000 : 990));

    expect(at(reports, 1320).powerReview?.raised).toBe(true);
  });

  test("a drop of more than the margin is falling", () => {
    const reports = simulate(createHouse(), 1320, (time) => onlyA(time <= 720 ? 1000 : 989));

    expect(at(reports, 1320).powerReview?.raised).toBe(false);
  });

  test("one low sample does not decide", () => {
    const reports = simulate(createHouse(), 1320, (time) => onlyA(time === 1319 ? 900 : 1000));

    expect(at(reports, 1320).powerReview?.raised).toBe(true);
  });

  test("a room inside the hysteresis band asks for nothing", () => {
    const reports = simulate(createHouse(), 1920, (time) => onlyA(time < 300 ? 900 : 780));

    expect(at(reports, 1920).roomsAboveTh1).toEqual(["a"]);
    expect(powerChanges(reports)).toEqual([]);
    expect(reviews(reports).map((review) => review.time)).toEqual([720, 1320, 1920]);
  });

  test("several rooms give one step", () => {
    const reports = simulate(createHouse(), 720, () => ({ a: 900, b: 900, c: 900 }));

    expect(at(reports, 720)).toMatchObject({
      powerBefore: 2,
      powerAfter: 3,
      powerReview: { asked: ["a", "b", "c"] },
    });
  });

  test("a room that joins later asks one review later", () => {
    const reports = simulate(createHouse(), 1920, (time) => ({
      a: fallingAfterFirstReview(time),
      b: time < 900 ? 500 : 850,
      c: 500,
    }));

    expect(at(reports, 720).powerReview).toMatchObject({ raised: true, asked: ["a"] });
    expect(at(reports, 1320).powerReview).toMatchObject({ raised: false, held: ["a", "b"] });
    expect(at(reports, 1920).powerReview).toMatchObject({
      raised: true,
      asked: ["b"],
      held: ["a"],
    });
    expect(at(reports, 1920).powerAfter).toBe(4);
  });

  test("the night maximum is the limit at night", () => {
    const reports = simulate(createHouse({ hru: 4 }), 3000, steady(1000), NIGHT);

    expect(at(reports, 720).powerAfter).toBe(5);
    expect(reports.every((report) => report.powerAfter <= 5)).toBe(true);
  });

  test("the clock restarts when no room is above TH1 any more", () => {
    const house = createHouse();
    house.engine.hruPowerStepDownInterval = 100000;
    const reports = simulate(house, 2220, (time) => {
      if (time < 800) return onlyA(900);
      return onlyA(time < 1500 ? 700 : 900);
    });

    expect(reviews(reports)).toEqual([
      { time: 720, lane: "slow", raised: true },
      { time: 2220, lane: "slow", raised: true },
    ]);
    expect(at(reports, 1620)).toMatchObject({ branch: "th1", roomsActedOn: ["a"] });
  });

  test.each([
    ["0", 0],
    ["NaN", Number.NaN],
  ])("an interval of %s switches the slow lane off", (_name, interval) => {
    const house = createHouse();
    house.engine.powerReviewInterval = interval;
    const reports = simulate(house, 3600, steady(900));

    expect(powerChanges(reports)).toEqual([]);
  });

  test("decides the same with a run every 60 seconds", () => {
    const everySecond = simulate(createHouse(), 1920, (time) =>
      onlyA(fallingAfterFirstReview(time)),
    );
    const sparse = createHouse();
    const sparsePower = new Map<number, number>();
    for (let time = 0; time <= 1920; time += 60) {
      sparsePower.set(time, runAt(sparse, time, onlyA(fallingAfterFirstReview(time))).powerAfter);
    }

    for (const time of [720, 1320, 1920]) {
      expect(sparsePower.get(time)).toBe(at(everySecond, time).powerAfter);
    }
  });
});

describe("slow lane: the guard for a room that does not respond", () => {
  test("a steady room gets three steps", () => {
    const reports = simulate(createHouse(), 3600, steady(900));

    expect(powerChanges(reports)).toEqual([
      { time: 720, power: 3 },
      { time: 1320, power: 4 },
      { time: 1920, power: 5 },
    ]);
    expect(at(reports, 2520).powerReview).toEqual({
      lane: "slow",
      raised: false,
      asked: [],
      held: ["a"],
    });
  });

  test("falling resets the count", () => {
    const reports = simulate(createHouse(), 3120, (time) => onlyA(time <= 1920 ? 900 : 860));

    expect(at(reports, 1920).powerAfter).toBe(5);
    expect(at(reports, 2520).powerReview?.raised).toBe(false);
    expect(at(reports, 3120).powerReview?.raised).toBe(true);
    expect(at(reports, 3120).powerAfter).toBe(6);
  });

  test("a room that is clearly rising asks past the limit", () => {
    // Three steps at a steady 900 ppm, then the room climbs by 5 ppm a minute.
    const reports = simulate(createHouse(), 3720, (time) =>
      onlyA(time <= 2520 ? 900 : Math.round(900 + (time - 2520) / 12)),
    );

    expect(at(reports, 1920).powerAfter).toBe(5);
    expect(at(reports, 2520).powerReview?.raised).toBe(false);
    expect(at(reports, 3120).powerReview).toMatchObject({ raised: true, asked: ["a"] });
    expect(at(reports, 3720).powerReview).toMatchObject({ raised: true, asked: ["a"] });
    expect(at(reports, 3720).powerAfter).toBe(7);
  });

  test("a rise within twice the margin does not lift the limit", () => {
    const reports = simulate(createHouse(), 3120, (time) => onlyA(time <= 2520 ? 900 : 920));

    expect(at(reports, 3120).powerReview?.raised).toBe(false);
    expect(at(reports, 3120).powerAfter).toBe(5);
  });

  test("asking at the maximum does not use up the limit", () => {
    // Night from 23:00 with the power already at the night maximum of 5; the day starts at 07:00.
    const reports = simulate(createHouse({ hru: 5 }), 10 * 3600, steady(900), NIGHT);
    const dayStarts = 8 * 3600;

    expect(at(reports, dayStarts).powerAfter).toBe(5);
    expect(
      powerChanges(reports)
        .filter((change) => change.time > dayStarts)
        .map((change) => change.power),
    ).toEqual([6, 7, 8]);
  });

  test("a room that comes under TH1 starts with a clean count", () => {
    const house = createHouse();
    // A margin this wide keeps the drop to 790 ppm from counting as falling.
    house.engine.co2FallingMargin = 200;
    const reports = simulate(house, 3720, (time) => {
      if (time <= 1920) return onlyA(900);
      return onlyA(time <= 2520 ? 790 : 810);
    });

    expect(at(reports, 1920).powerAfter).toBe(5);
    expect(at(reports, 2520).powerReview?.raised).toBe(false);
    expect(at(reports, 3720).powerReview).toMatchObject({ raised: true, asked: ["a"] });
  });

  test("an unusable limit counts as three", () => {
    const house = createHouse();
    house.engine.powerReviewStepLimit = 0;
    const reports = simulate(house, 3600, steady(900));

    expect(at(reports, 3600).powerAfter).toBe(5);
  });
});

describe("fast lane: a room above TH2", () => {
  test("a steady room steps as before", () => {
    const reports = simulate(createHouse(), 400, steady(1300));

    expect(powerChanges(reports)).toEqual([
      { time: 120, power: 3 },
      { time: 240, power: 4 },
      { time: 360, power: 5 },
    ]);
    expect(at(reports, 120).powerReview).toEqual({
      lane: "fast",
      raised: true,
      asked: ["a"],
      held: [],
    });
  });

  test("a falling room stops the ramp, and a held review marks nothing", () => {
    const reports = simulate(createHouse(), 480, (time) =>
      onlyA(time <= 240 ? 1300 : Math.round(1300 - (time - 240) / 2)),
    );

    expect(powerChanges(reports)).toEqual([
      { time: 120, power: 3 },
      { time: 240, power: 4 },
    ]);
    expect(at(reports, 360)).toMatchObject({
      branch: "th2",
      roomsActedOn: [],
      powerReview: { lane: "fast", raised: false, asked: [], held: ["a"] },
    });
    expect(at(reports, 480).powerReview?.raised).toBe(false);
  });

  test("a room under TH2 does not ask", () => {
    const reports = simulate(createHouse(), 800, (time) => onlyA(time < 300 ? 1300 : 1150));

    expect(at(reports, 800).roomsAboveTh2).toEqual(["a"]);
    expect(powerChanges(reports)).toEqual([
      { time: 120, power: 3 },
      { time: 240, power: 4 },
    ]);
  });

  test("a room that is only above TH1 causes no fast step", () => {
    const reports = simulate(createHouse(), 400, (time) => ({
      a: 1300,
      b: time < 60 ? 500 : 900,
      c: 500,
    }));

    expect(powerChanges(reports).map((change) => change.time)).toEqual([120, 240, 360]);
  });

  test("a room takes part only after the time limit above TH2", () => {
    // Room b is due at second 370 (above TH1 since 250) and has been above TH2 for ten seconds then.
    const reports = simulate(createHouse(), 500, (time) => {
      let b = 500;
      if (time >= 250) b = time < 360 ? 900 : 1300;
      return { a: 1300, b, c: 500 };
    });

    expect(powerChanges(reports).map((change) => change.time)).toEqual([120, 240, 360, 480, 490]);
  });

  test("a new episode starts fresh", () => {
    const reports = simulate(createHouse(), 1120, (time) => {
      if (time < 400) return onlyA(1300);
      return onlyA(time < 1000 ? 1000 : 1300);
    });

    expect(powerChanges(reports).map((change) => change.time)).toEqual([120, 240, 360, 1120]);
    expect(at(reports, 1120).powerReview).toEqual({
      lane: "fast",
      raised: true,
      asked: ["a"],
      held: [],
    });
  });

  test("a room stuck in the TH2 band is picked up by the slow lane", () => {
    const reports = simulate(createHouse(), 2100, (time) => onlyA(time < 300 ? 1300 : 1150));

    expect(powerChanges(reports)).toEqual([
      { time: 120, power: 3 },
      { time: 240, power: 4 },
      { time: 2040, power: 5 },
    ]);
    expect(
      reviews(reports)
        .filter((review) => review.lane === "slow")
        .map((review) => review.time),
    ).toEqual([840, 1440, 2040]);
  });
});

describe("an unusable falling margin", () => {
  test.each([
    ["NaN", Number.NaN],
    ["a negative number", -50],
  ])("%s counts as 0", (_name, margin) => {
    const house = createHouse();
    house.engine.co2FallingMargin = margin;
    // 1000 ppm, then 999 ppm: falling with a margin of 0, not falling with the default of 10.
    const reports = simulate(house, 1320, (time) => onlyA(time <= 720 ? 1000 : 999));

    expect(at(reports, 1320).powerReview?.raised).toBe(false);
  });
});

describe("the report of a review", () => {
  test("a slow step between two valve actions is not an action on a room", () => {
    const house = createHouse();
    house.engine.powerReviewInterval = 650;
    const reports = simulate(house, 770, steady(900));

    expect(at(reports, 720).roomsActedOn).toEqual(["a"]);
    expect(at(reports, 770)).toMatchObject({
      branch: "th1",
      powerBefore: 2,
      powerAfter: 3,
      roomsActedOn: [],
      powerReview: { lane: "slow", raised: true, asked: ["a"], held: [] },
    });
  });

  test("a run without a review reports none", () => {
    const reports = simulate(createHouse(), 121, steady(900));

    expect(at(reports, 121).powerReview).toBeNull();
  });
});
