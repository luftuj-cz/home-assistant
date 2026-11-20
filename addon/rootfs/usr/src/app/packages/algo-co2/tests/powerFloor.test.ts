import { describe, expect, test } from "vitest";

import type { HRU } from "../src/index.js";
import { ALL_LOW, allLow, at, createHouse, powerChanges, runAt, simulate } from "./house.js";

const NIGHT = 23 * 3600;

interface RecordingHru {
  hru: HRU;
  writes: { time: number; power: number }[];
  setTime(time: number): void;
}

/** An HRU that reads `read()` whatever is written to it, and records the writes. */
function recordingHru(read: () => number): RecordingHru {
  const writes: { time: number; power: number }[] = [];
  let now = 0;
  return {
    hru: {
      getPower: read,
      setPower: (power) => {
        writes.push({ time: now, power });
      },
    },
    writes,
    setTime: (time) => {
      now = time;
    },
  };
}

describe("power below the minimum", () => {
  test("is raised in the first run of a quiet house", () => {
    const report = runAt(createHouse({ hru: 0 }), 0, ALL_LOW);

    expect(report.powerAfter).toBe(2);
  });

  test("is raised first and stepped up by th2 afterwards", () => {
    const reports = simulate(createHouse({ hru: 0 }), 120, () => ({ a: 1300, b: 500, c: 500 }));

    expect(powerChanges(reports)).toEqual([
      { time: 0, power: 2 },
      { time: 120, power: 3 },
    ]);
  });

  test("goes only to the maximum where the minimum is above it", () => {
    const house = createHouse({ hru: 3 });
    house.engine.hruMinPower = 6;
    const report = runAt(house, 0, ALL_LOW, NIGHT);

    expect(report.maxPower).toBe(5);
    expect(report.powerAfter).toBe(5);
  });

  test("leaves a power at or above the minimum alone", () => {
    const reports = simulate(createHouse({ hru: 4 }), 300, () => ({ a: 1000, b: 500, c: 500 }));

    expect(reports.every((report) => report.powerAfter === 4)).toBe(true);
  });
});

describe("raising to the minimum", () => {
  test("is reported through powerBefore and powerAfter, and is not an action on a room", () => {
    const report = runAt(createHouse({ hru: 0 }), 0, ALL_LOW);

    expect(report).toMatchObject({
      branch: "none",
      powerBefore: 0,
      powerAfter: 2,
      roomsActedOn: [],
    });
  });

  test("is logged as a raise to the minimum", () => {
    const house = createHouse({ hru: 0 });
    runAt(house, 0, ALL_LOW);

    expect(house.logs.filter((line) => line.includes("raising HRU power"))).toEqual([
      "[08:00] raising HRU power from 0 to 2 (minimum)",
    ]);
  });

  test("writes nothing when the HRU reports no usable power", () => {
    const recording = recordingHru(() => Number.NaN);
    simulate(createHouse({ hru: recording.hru }), 300, allLow);

    expect(recording.writes).toEqual([]);
  });
});

describe("a limit write the HRU does not follow", () => {
  test("is retried once per time limit when the unit is off", () => {
    const recording = recordingHru(() => 0);
    const house = createHouse({ hru: recording.hru });
    for (let time = 0; time <= 600; time++) {
      recording.setTime(time);
      runAt(house, time, ALL_LOW);
    }

    expect(recording.writes).toEqual(
      [0, 120, 240, 360, 480, 600].map((time) => ({ time, power: 2 })),
    );
  });

  test("is retried the same way for the maximum", () => {
    const recording = recordingHru(() => 10);
    const house = createHouse({ hru: recording.hru });
    // A room above TH1 keeps the engine out of the branches that write the power themselves.
    for (let time = 0; time <= 300; time++) {
      recording.setTime(time);
      runAt(house, time, { a: 1000, b: 500, c: 500 }, NIGHT);
    }

    expect(recording.writes).toEqual([0, 120, 240].map((time) => ({ time, power: 5 })));
  });

  test("does not hold back the next write once it was followed", () => {
    let power = 0;
    const writes: number[] = [];
    const house = createHouse({
      hru: {
        getPower: () => power,
        setPower: (value) => {
          power = value;
          writes.push(value);
        },
      },
    });
    // A room above TH1 keeps the engine out of the branches that write the power themselves.
    const readings = { a: 900, b: 500, c: 500 };
    runAt(house, 0, readings);
    runAt(house, 1, readings);
    power = 0;
    const report = runAt(house, 30, readings);

    expect(writes).toEqual([2, 2]);
    expect(report.powerAfter).toBe(2);
  });
});

describe("a branch write the HRU does not follow", () => {
  test("Pmove is retried once per time limit when the unit is off", () => {
    const recording = recordingHru(() => 0);
    const house = createHouse({ hru: recording.hru });
    for (let time = 0; time <= 400; time++) {
      recording.setTime(time);
      runAt(house, time, { a: 720, b: 720, c: 500 });
    }

    expect(recording.writes.filter((write) => write.power === 4)).toEqual(
      [120, 240, 360].map((time) => ({ time, power: 4 })),
    );
  });

  test("a step down is retried once per time limit when the unit stays where it is", () => {
    const recording = recordingHru(() => 10);
    const house = createHouse({ hru: recording.hru });
    for (let time = 0; time <= 300; time++) {
      recording.setTime(time);
      runAt(house, time, ALL_LOW);
    }

    expect(recording.writes).toEqual([120, 240].map((time) => ({ time, power: 9 })));
  });
});

describe("existing limits", () => {
  test("the maximum still applies in the same step", () => {
    const reports = simulate(createHouse({ hru: 10 }), 1, allLow, NIGHT);

    expect(at(reports, 0)).toMatchObject({ powerBefore: 10, powerAfter: 5 });
  });
});
