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

const ALL_LOW: Readings = { a: 500, b: 500, c: 500 };

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

describe("timed decisions and the run period", () => {
  test("land on the first run after the limit", () => {
    const house = createHouse();
    house.engine.co2FilterAlpha = 1;
    const reports = simulate(house, 50, 150, () => ({ a: 900, b: 500, c: 500 }));

    expect(reports.get(100)?.branch).toBe("none");
    expect(reports.get(150)).toMatchObject({ branch: "th1", roomsActedOn: ["a"] });
  });
});
