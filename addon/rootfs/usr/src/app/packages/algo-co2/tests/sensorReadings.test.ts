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

/** Valve default, distinct from fully open (0) and partially closed (45). */
const VALVE_DEFAULT = 10;

/** What a careless caller can put into a sensor, whatever the declared type says. */
function sensorHolding(value: unknown): Sensor {
  const sensor = new Sensor("sensor");
  sensor.co2 = value as number | null;
  return sensor;
}

function roomWith(...values: unknown[]): Room {
  return new Room("room", values.map(sensorHolding));
}

interface Readings {
  a: number;
  b: number;
  c: number;
}

interface House {
  engine: AutomaticModeEngine;
  hru: SimulatedHRU;
  sensors: Sensor[];
  valves: Valve[];
}

/** Rooms a, b and c, one sensor and one supply valve (default 10) each, HRU at power 2. */
function createHouse(): House {
  const sensors = [new Sensor("sensor_a"), new Sensor("sensor_b"), new Sensor("sensor_c")];
  const rooms = sensors.map((sensor, i) => new Room(["a", "b", "c"][i] ?? "", [sensor]));
  const valves = rooms.map((room) => {
    const valve = new Valve(`valve_${room.id}`, VALVE_DEFAULT, room, ValveType.Supply);
    valve.value = VALVE_DEFAULT;
    return valve;
  });
  const hru = new SimulatedHRU(2);
  const engine = new AutomaticModeEngine(new Building(rooms, [new Box(valves)]), hru, logger);
  return { engine, hru, sensors, valves };
}

/** Runs seconds 0..lastSecond with the given readings and returns the reports indexed by second. */
function simulate(
  house: House,
  lastSecond: number,
  readingsAt: (time: number) => Readings,
): RunReport[] {
  const reports: RunReport[] = [];
  for (let time = 0; time <= lastSecond; time++) {
    const readings = readingsAt(time);
    [readings.a, readings.b, readings.c].forEach((co2, i) => {
      const sensor = house.sensors[i];
      if (sensor !== undefined) sensor.co2 = co2;
    });
    reports.push(house.engine.run(Timestamp.simulate(time, 8)));
  }
  return reports;
}

function at(reports: RunReport[], time: number): RunReport {
  const report = reports[time];
  if (report === undefined) {
    throw new Error(`No report for second ${time}`);
  }
  return report;
}

describe("what counts as a reading", () => {
  test.each([
    ["NaN", Number.NaN],
    ["undefined", undefined],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["zero", 0],
    ["a negative number", -5],
    ["a numeric string", "800"],
  ])("%s is no reading", (_name, value) => {
    expect(roomWith(value).getCO2()).toBeNull();
  });

  test("a very high value is kept", () => {
    expect(roomWith(40000).getCO2()).toBe(40000);
  });

  test("a fresh sensor has no reading", () => {
    const sensor = new Sensor("sensor");

    expect(sensor.co2).toBeNull();
    expect(new Room("room", [sensor]).getCO2()).toBeNull();
  });
});

describe("room CO2 from several sensors", () => {
  test("an invalid sensor beside a valid one is ignored", () => {
    expect(roomWith(Number.NaN, 900).getCO2()).toBe(900);
  });

  test("the maximum is taken over the valid sensors", () => {
    expect(roomWith(700, 0, 850).getCO2()).toBe(850);
  });
});

describe("a room with an invalid reading in the engine", () => {
  test("drops out of the decision", () => {
    const house = createHouse();
    const reports = simulate(house, 0, () => ({ a: Number.NaN, b: 600, c: 500 }));

    expect(at(reports, 0).roomsWithReading).toEqual(["b", "c"]);
    expect(house.engine.getFilteredCO2("a")).toBeNull();
  });

  test("has its valves fully open when the airflow is redistributed", () => {
    const house = createHouse();
    house.engine.co2FilterAlpha = 1;
    const reports = simulate(house, 120, () => ({ a: Number.NaN, b: 900, c: 500 }));

    expect(at(reports, 120).branch).toBe("th1");
    expect(house.valves.map((valve) => valve.value)).toEqual([0, 0, 45]);
  });

  test("recovers with the first valid reading", () => {
    const house = createHouse();
    const invalidAt = 300;
    const reports = simulate(house, invalidAt + 1 + house.engine.thresholdTimeLimit, (time) => {
      if (time < invalidAt) return { a: 500, b: 500, c: 500 };
      return { a: time === invalidAt ? Number.NaN : 1500, b: 500, c: 500 };
    });

    expect(at(reports, invalidAt).roomsWithReading).toEqual(["b", "c"]);
    expect(at(reports, invalidAt + 1).roomsWithReading).toEqual(["a", "b", "c"]);

    const last = at(reports, reports.length - 1);
    expect(house.engine.getFilteredCO2("a")).toBe(1500);
    expect(last.roomsAboveTh2).toEqual(["a"]);
    expect(last.powerAfter).toBeGreaterThan(2);
  });
});
