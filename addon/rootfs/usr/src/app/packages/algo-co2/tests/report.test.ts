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
  type Logger,
  type RunReport,
} from "../src/index.js";

const logger: Logger = {
  info() {
    // The report is what these tests assert on; log lines would only add noise.
  },
};

class FixedHRU implements HRU {
  constructor(private power: number) {}

  getPower(): number {
    return this.power;
  }

  setPower(power: number): void {
    this.power = power;
  }
}

interface House {
  engine: AutomaticModeEngine;
  a: Sensor;
  b: Sensor;
}

/** Rooms a and b, each with one sensor and one supply valve at default 0. */
function createHouse(hruPower = 20): House {
  const a = new Sensor("sensor_a");
  const b = new Sensor("sensor_b");
  const roomA = new Room("a", [a]);
  const roomB = new Room("b", [b]);
  const building = new Building(
    [roomA, roomB],
    [
      new Box([
        new Valve("valve_a", 0, roomA, ValveType.Supply),
        new Valve("valve_b", 0, roomB, ValveType.Supply),
      ]),
    ],
  );
  return { engine: new AutomaticModeEngine(building, new FixedHRU(hruPower), logger), a, b };
}

/** Runs seconds 0..lastSecond from 08:00 with fixed readings and returns the last report. */
function runUntil(
  house: House,
  readings: { a: number | null; b: number | null },
  lastSecond: number,
): RunReport {
  house.a.co2 = readings.a;
  house.b.co2 = readings.b;
  for (let time = 0; time < lastSecond; time++) {
    house.engine.run(Timestamp.simulate(time, 8));
  }
  return house.engine.run(Timestamp.simulate(lastSecond, 8));
}

describe("run() report", () => {
  test("reports TH2 and the power step when a room stays above TH2", () => {
    const report = runUntil(createHouse(), { a: 1300, b: 500 }, 120);

    expect(report).toEqual({
      branch: "th2",
      roomsWithReading: ["a", "b"],
      roomsAboveTh2: ["a"],
      roomsAboveTh1: ["a"],
      roomsBelowTh1: ["b"],
      roomsInCooldown: [],
      roomsActedOn: ["a"],
      valvesChanged: true,
      powerBefore: 20,
      powerAfter: 30,
      maxPower: 100,
    });
  });

  test("reports none before the time limit", () => {
    const report = runUntil(createHouse(), { a: 1300, b: 500 }, 119);

    expect(report.branch).toBe("none");
    expect(report.roomsActedOn).toEqual([]);
    expect(report.valvesChanged).toBe(false);
  });

  test("reports TH1 with every TH1 room in cooldown", () => {
    const house = createHouse();
    const readings = { a: 900, b: 500 };

    const acting = runUntil(house, readings, 120);
    expect(acting.branch).toBe("th1");
    expect(acting.roomsActedOn).toEqual(["a"]);
    expect(acting.valvesChanged).toBe(true);

    const cooldown = house.engine.run(Timestamp.simulate(121, 8));
    expect(cooldown.branch).toBe("th1");
    expect(cooldown.roomsActedOn).toEqual([]);
    expect(cooldown.roomsInCooldown).toEqual(["a"]);
    expect(cooldown.valvesChanged).toBe(false);
    expect(cooldown.powerBefore).toBe(20);
    expect(cooldown.powerAfter).toBe(20);
  });

  test("reports allBelow and lowers power", () => {
    const report = runUntil(createHouse(40), { a: 500, b: 500 }, 120);

    expect(report.branch).toBe("allBelow");
    expect(report.roomsActedOn).toEqual(["a", "b"]);
    expect(report.powerBefore).toBe(40);
    expect(report.powerAfter).toBe(30);
    expect(report.valvesChanged).toBe(false);
  });

  test("takes allBelow when no room has a reading", () => {
    const report = runUntil(createHouse(), { a: null, b: null }, 0);

    expect(report.branch).toBe("allBelow");
    expect(report.roomsWithReading).toEqual([]);
    expect(report.roomsActedOn).toEqual([]);
  });

  test("reports the hysteresis band as none", () => {
    const report = runUntil(createHouse(), { a: 780, b: 780 }, 200);

    expect(report.branch).toBe("none");
  });

  test("reports the night maximum, with 22:00:00 still day", () => {
    function maxPowerAt(timestamp: Timestamp): number {
      return createHouse().engine.run(timestamp).maxPower;
    }

    expect(maxPowerAt(new Timestamp(0, 79200))).toBe(100);
    expect(maxPowerAt(new Timestamp(0, 79201))).toBe(50);
    expect(maxPowerAt(new Timestamp(0, 21600))).toBe(50);
  });
});
