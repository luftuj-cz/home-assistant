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
  type HRU,
  type RunReport,
} from "../src/index.js";
import { SimulatedHRU } from "./simulator.js";

const DAY_END = 22 * 3600;
/** The runs start five minutes before the end of the day. */
const START_SECOND_OF_DAY = DAY_END - 300;
/** 22:00:00 is still day, so the first run of the night is one second later. */
const FIRST_NIGHT_RUN = 301;

interface Readings {
  a: number;
  b: number;
  c: number;
}

interface House {
  engine: AutomaticModeEngine;
  sensors: Sensor[];
  logs: string[];
}

/** Rooms a, b and c with one sensor and one supply valve each, the CO2 filter off. */
function createHouse(hru: HRU): House {
  const logs: string[] = [];
  const sensors = [new Sensor("sensor_a"), new Sensor("sensor_b"), new Sensor("sensor_c")];
  const rooms = sensors.map((sensor, i) => new Room(["a", "b", "c"][i] ?? "", [sensor]));
  const valves = rooms.map((room) => new Valve(`valve_${room.id}`, 0, room, ValveType.Supply));
  const engine = new AutomaticModeEngine(new Building(rooms, [new Box(valves)]), hru, {
    info: (message) => logs.push(message),
  });
  engine.co2FilterAlpha = 1;
  return { engine, sensors, logs };
}

/**
 * Runs seconds 0..lastSecond with constant readings and returns the reports indexed by second. The
 * time of day starts at `startSecondOfDay`.
 */
function simulate(
  house: House,
  lastSecond: number,
  readings: Readings,
  startSecondOfDay = START_SECOND_OF_DAY,
): RunReport[] {
  [readings.a, readings.b, readings.c].forEach((co2, i) => {
    const sensor = house.sensors[i];
    if (sensor !== undefined) sensor.co2 = co2;
  });
  const reports: RunReport[] = [];
  for (let time = 0; time <= lastSecond; time++) {
    reports.push(house.engine.run(new Timestamp(time, startSecondOfDay + time)));
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

/** Log lines that call a power change an increase although the new value is lower. */
function falseIncreases(logs: string[]): string[] {
  return logs.filter((line) => {
    const match = /increasing HRU power from ([\d.]+) to ([\d.]+)/.exec(line);
    return match !== null && Number(match[2]) < Number(match[1]);
  });
}

const ABOVE_TH1: Readings = { a: 1000, b: 500, c: 500 };
/** Room a inside the TH1 hysteresis band, never above TH1. */
const IN_BAND: Readings = { a: 780, b: 500, c: 500 };
const ABOVE_TH2: Readings = { a: 1300, b: 500, c: 500 };

describe("power above the maximum of the run", () => {
  test.each([
    ["th1", ABOVE_TH1],
    ["none", IN_BAND],
    ["th2", ABOVE_TH2],
  ] as const)("is lowered in the first run of the night in the %s branch", (branch, readings) => {
    const reports = simulate(createHouse(new SimulatedHRU(10)), FIRST_NIGHT_RUN, readings);

    expect(at(reports, FIRST_NIGHT_RUN - 1).powerAfter).toBe(10);
    expect(at(reports, FIRST_NIGHT_RUN).branch).toBe(branch);
    expect(at(reports, FIRST_NIGHT_RUN).powerAfter).toBe(5);
  });

  test("goes to the maximum in one run, not by a step per run", () => {
    const reports = simulate(createHouse(new SimulatedHRU(10)), FIRST_NIGHT_RUN, ABOVE_TH1);

    expect(at(reports, FIRST_NIGHT_RUN).powerBefore).toBe(10);
    expect(at(reports, FIRST_NIGHT_RUN).powerAfter).toBe(5);
  });

  test("is not raised again during the night while a room is above TH2", () => {
    const reports = simulate(createHouse(new SimulatedHRU(10)), 900, ABOVE_TH2);

    expect(reports.slice(FIRST_NIGHT_RUN).every((report) => report.powerAfter === 5)).toBe(true);
  });

  test("is lowered to the day maximum as well", () => {
    const house = createHouse(new SimulatedHRU(10));
    house.engine.hruMaxPowerDay = 8;
    const reports = simulate(house, 0, ABOVE_TH1, 8 * 3600);

    expect(at(reports, 0).powerAfter).toBe(8);
  });
});

describe("power at or below the maximum", () => {
  test("is left alone at night in the th1 branch", () => {
    const reports = simulate(createHouse(new SimulatedHRU(4)), 600, ABOVE_TH1);

    expect(reports.every((report) => report.powerAfter === 4)).toBe(true);
  });
});

describe("lowering to the maximum", () => {
  test("is reported through powerBefore, powerAfter and maxPower", () => {
    const reports = simulate(createHouse(new SimulatedHRU(10)), FIRST_NIGHT_RUN, IN_BAND);

    expect(at(reports, FIRST_NIGHT_RUN)).toMatchObject({
      branch: "none",
      powerBefore: 10,
      powerAfter: 5,
      maxPower: 5,
    });
  });

  test("is not an action on a room", () => {
    const reports = simulate(createHouse(new SimulatedHRU(10)), FIRST_NIGHT_RUN + 1, IN_BAND);

    expect(at(reports, FIRST_NIGHT_RUN).roomsActedOn).toEqual([]);
    expect(at(reports, FIRST_NIGHT_RUN + 1).roomsInCooldown).toEqual([]);
  });

  test("is logged as a lowering, never as an increase", () => {
    const house = createHouse(new SimulatedHRU(10));
    simulate(house, 900, ABOVE_TH2);

    const lowerings = house.logs.filter((line) => line.includes("lowering HRU power"));
    expect(lowerings).toHaveLength(1);
    expect(lowerings[0]).toContain("from 10 to 5");
    expect(falseIncreases(house.logs)).toEqual([]);
  });

  test("writes nothing when the HRU reports no usable power", () => {
    const writes: number[] = [];
    const unavailableHru: HRU = {
      getPower: () => Number.NaN,
      setPower: (power) => {
        writes.push(power);
      },
    };
    simulate(createHouse(unavailableHru), 600, ABOVE_TH2);

    expect(writes).toEqual([]);
  });

  test("holds with an HRU whose read-back lags behind the write", () => {
    const writes: { time: number; power: number }[] = [];
    let time = 0;
    const laggingHru: HRU = {
      getPower: () => 10,
      setPower: (power) => {
        writes.push({ time, power });
      },
    };
    const house = createHouse(laggingHru);
    [1300, 500, 500].forEach((co2, i) => {
      const sensor = house.sensors[i];
      if (sensor !== undefined) sensor.co2 = co2;
    });
    for (time = 0; time <= 400; time++) {
      house.engine.run(new Timestamp(time, START_SECOND_OF_DAY + time));
    }

    expect(writes[0]).toEqual({ time: FIRST_NIGHT_RUN, power: 5 });
    expect(writes.every((write) => write.power === 5)).toBe(true);
    expect(falseIncreases(house.logs)).toEqual([]);
  });
});
