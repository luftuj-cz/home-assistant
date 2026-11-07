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
} from "../src/index.js";

const logger: Logger = {
  info() {
    // The written powers are what these tests assert on; log lines would only add noise.
  },
};

/** Remembers every power the engine writes. */
class RecordingHRU implements HRU {
  readonly writes: number[] = [];

  constructor(private power: number) {}

  getPower(): number {
    return this.power;
  }

  setPower(power: number): void {
    this.writes.push(power);
    this.power = power;
  }
}

/**
 * One room above TH2 for `lastSecond` seconds from 08:00, with the given HRU power and step; returns
 * the powers the engine wrote.
 */
function raisePower(startPower: number, step: number, lastSecond: number): number[] {
  const sensor = new Sensor("sensor_a");
  sensor.co2 = 1300;
  const room = new Room("a", [sensor]);
  const hru = new RecordingHRU(startPower);
  const engine = new AutomaticModeEngine(
    new Building([room], [new Box([new Valve("valve_a", 0, room, ValveType.Supply)])]),
    hru,
    logger,
  );
  engine.hruMinPower = 0;
  engine.hruPowerStep = step;
  for (let time = 0; time <= lastSecond; time++) {
    engine.run(Timestamp.simulate(time, 8));
  }
  return hru.writes;
}

describe("power scale 0–10", () => {
  test("defaults are on the 0–10 scale", () => {
    const engine = new AutomaticModeEngine(new Building([], []), new RecordingHRU(2), logger);

    expect(engine.hruMinPower).toBe(2);
    expect(engine.hruMaxPowerDay).toBe(10);
    expect(engine.hruMaxPowerNight).toBe(5);
    expect(engine.hruPowerStep).toBe(1);
    expect(engine.hruMovePower).toBe(4);
  });

  test("a decimal step raises power in decimal steps", () => {
    expect(raisePower(2, 0.5, 240)).toEqual([2.5, 3]);
  });

  test("written powers are rounded to two decimals", () => {
    expect(raisePower(0.2, 0.1, 360)).toEqual([0.3, 0.4, 0.5]);
  });
});
