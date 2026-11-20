import { describe, expect, test } from "vitest";

import {
  AutomaticModeEngine,
  Box,
  Building,
  Room,
  Sensor,
  Timestamp,
  Valve,
  ValveType,
  type Logger,
  type RunReport,
} from "../src/index.js";
import { SimulatedHRU } from "./simulator.js";

const logger: Logger = {
  info() {
    // The reports are what these tests assert on; log lines would only add noise.
  },
};

type Reading = number | null;

interface Readings {
  a: Reading;
  b: Reading;
  c: Reading;
}

interface House {
  engine: AutomaticModeEngine;
  hru: SimulatedHRU;
  sensors: Sensor[];
}

/** Rooms a, b and c with one sensor and one supply valve each. */
function createHouse(hruPower = 2): House {
  const sensors = [new Sensor("sensor_a"), new Sensor("sensor_b"), new Sensor("sensor_c")];
  const rooms = sensors.map((sensor, i) => new Room(["a", "b", "c"][i] ?? "", [sensor]));
  const valves = rooms.map((room) => new Valve(`valve_${room.id}`, 0, room, ValveType.Supply));
  const hru = new SimulatedHRU(hruPower);
  const engine = new AutomaticModeEngine(new Building(rooms, [new Box(valves)]), hru, logger);
  return { engine, hru, sensors };
}

function runAt(house: House, time: number, readings: Readings): RunReport {
  [readings.a, readings.b, readings.c].forEach((co2, i) => {
    const sensor = house.sensors[i];
    if (sensor !== undefined) sensor.co2 = co2;
  });
  return house.engine.run(Timestamp.simulate(time, 8));
}

/** Runs at seconds 0, period, 2·period, … up to lastSecond; the reports are keyed by second. */
function simulate(
  house: House,
  period: number,
  lastSecond: number,
  readingsAt: (time: number) => Readings,
): Map<number, RunReport> {
  const reports = new Map<number, RunReport>();
  for (let time = 0; time <= lastSecond; time += period) {
    reports.set(time, runAt(house, time, readingsAt(time)));
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

const ALL_LOW: Readings = { a: 500, b: 500, c: 500 };

function allLow(): Readings {
  return ALL_LOW;
}

/** With every room at 500 ppm from second 0, `allBelow` first applies after Topen. */
const FIRST_STEP = 120;

describe("CO2 filter and the run period", () => {
  test("follows the same course at a 1 s and a 10 s period", () => {
    function stepUp(time: number): Readings {
      return { a: time === 0 ? 500 : 1000, b: 500, c: 500 };
    }
    const everySecond = createHouse();
    const everyTenSeconds = createHouse();
    everySecond.engine.co2FilterAlpha = 0.1;
    everyTenSeconds.engine.co2FilterAlpha = 0.1;

    const differences: number[] = [];
    for (let time = 0; time <= 600; time++) {
      runAt(everySecond, time, stepUp(time));
      if (time % 10 === 0) {
        runAt(everyTenSeconds, time, stepUp(time));
        differences.push(
          Math.abs(
            (everySecond.engine.getFilteredCO2("a") ?? 0) -
              (everyTenSeconds.engine.getFilteredCO2("a") ?? 0),
          ),
        );
      }
    }

    expect(Math.max(...differences)).toBeLessThanOrEqual(1);
  });

  test("takes the new reading after a long interval", () => {
    const house = createHouse();
    runAt(house, 0, ALL_LOW);
    runAt(house, 60, { a: 1000, b: 500, c: 500 });

    expect(house.engine.getFilteredCO2("a")).toBe(1000);
  });

  test("does not filter twice in the same second", () => {
    const house = createHouse();
    runAt(house, 0, ALL_LOW);
    runAt(house, 1, ALL_LOW);
    runAt(house, 1, { a: 1000, b: 500, c: 500 });

    expect(house.engine.getFilteredCO2("a")).toBe(500);
  });

  test("restarts from the first reading after a missing one", () => {
    const house = createHouse();
    runAt(house, 0, ALL_LOW);
    runAt(house, 10, { a: null, b: 500, c: 500 });
    runAt(house, 70, { a: 900, b: 500, c: 500 });

    expect(house.engine.getFilteredCO2("a")).toBe(900);
  });
});

describe("power step-down and the run period", () => {
  test("the interval defaults to one second", () => {
    expect(createHouse().engine.hruPowerStepDownInterval).toBe(1);
  });

  test("reaches the minimum in the same time at a 1 s and a 30 s period", () => {
    const everySecond = simulate(createHouse(10), 1, 200, allLow);
    const everyThirtySeconds = simulate(createHouse(10), 30, 200, allLow);

    expect(powerAt(everySecond, FIRST_STEP)).toBe(9);
    expect(powerAt(everySecond, FIRST_STEP + 6)).toBe(3);
    expect(powerAt(everySecond, FIRST_STEP + 7)).toBe(2);
    expect(powerAt(everyThirtySeconds, FIRST_STEP)).toBe(9);
    expect(powerAt(everyThirtySeconds, FIRST_STEP + 30)).toBe(2);
  });

  test.each([1, 30])("a 60 s interval gives one step per minute at a %i s period", (period) => {
    const house = createHouse(10);
    house.engine.hruPowerStepDownInterval = 60;
    const reports = simulate(house, period, 600, allLow);

    expect(powerAt(reports, FIRST_STEP)).toBe(9);
    expect(powerAt(reports, FIRST_STEP + 30)).toBe(9);
    expect(powerAt(reports, FIRST_STEP + 60)).toBe(8);
    expect(powerAt(reports, FIRST_STEP + 390)).toBe(3);
    expect(powerAt(reports, FIRST_STEP + 420)).toBe(2);
  });

  test("carries the remainder of an interval over to the next run", () => {
    const house = createHouse(10);
    house.engine.hruPowerStepDownInterval = 45;
    const reports = simulate(house, 30, 300, allLow);

    const powers = [0, 30, 60, 90, 120, 150, 180].map((offset) =>
      powerAt(reports, FIRST_STEP + offset),
    );
    expect(powers).toEqual([9, 9, 8, 7, 7, 6, 5]);
  });

  test("builds no backlog while the power sits at Pmove", () => {
    const house = createHouse();
    house.engine.co2FilterAlpha = 1;
    house.engine.hruPowerStepDownInterval = 60;
    const fluctuationEnds = 3600;
    const reports = simulate(house, 1, fluctuationEnds + 400, (time) =>
      time < fluctuationEnds ? { a: 720, b: 720, c: 500 } : ALL_LOW,
    );
    const firstAllBelow = [...reports].find(
      ([time, report]) => time >= fluctuationEnds && report.branch === "allBelow",
    )?.[0];
    if (firstAllBelow === undefined) {
      throw new Error("allBelow never applied");
    }

    expect(powerAt(reports, firstAllBelow - 1)).toBe(4);
    expect(powerAt(reports, firstAllBelow + 59)).toBeGreaterThanOrEqual(3);
    expect(powerAt(reports, firstAllBelow + 120)).toBe(2);
  });

  test("starts a new stretch with exactly one step, whatever the time since the last run", () => {
    const house = createHouse(10);
    const first = runAt(house, 0, ALL_LOW);
    const second = runAt(house, 1000, ALL_LOW);

    expect(first.branch).toBe("none");
    expect(second.branch).toBe("allBelow");
    expect(second.powerAfter).toBe(9);
  });

  test("still raises to Pmove in one write", () => {
    const house = createHouse();
    house.engine.co2FilterAlpha = 1;
    house.engine.hruPowerStepDownInterval = 60;
    const reports = simulate(house, 30, 120, () => ({ a: 720, b: 720, c: 500 }));

    expect(reports.get(120)).toMatchObject({
      branch: "fluctuation",
      powerBefore: 2,
      powerAfter: 4,
    });
  });

  test.each([
    ["0", 0],
    ["NaN", Number.NaN],
  ])("an interval of %s goes to the minimum and never writes NaN", (_name, interval) => {
    const house = createHouse(10);
    house.engine.hruPowerStepDownInterval = interval;
    const reports = simulate(house, 1, FIRST_STEP, allLow);

    expect(powerAt(reports, FIRST_STEP)).toBe(2);
    expect(house.hru.getPower()).toBe(2);
  });
});

describe("timed decisions and the run period", () => {
  test("land on the first run after the limit", () => {
    const house = createHouse();
    house.engine.co2FilterAlpha = 1;
    const reports = simulate(house, 50, 150, () => ({ a: 900, b: 500, c: 500 }));

    expect(reports.get(100)?.branch).toBe("none");
    expect(reports.get(150)).toMatchObject({ branch: "th1", roomsActedOn: ["a"] });
  });
});
