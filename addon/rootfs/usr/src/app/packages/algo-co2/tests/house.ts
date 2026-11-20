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

export type Reading = number | null;

export interface Readings {
  a: Reading;
  b: Reading;
  c: Reading;
}

export interface House {
  engine: AutomaticModeEngine;
  sensors: Sensor[];
  valves: Valve[];
  logs: string[];
}

export interface HouseOptions {
  /** A number starts a `SimulatedHRU` at that power; default 2. */
  hru?: HRU | number;
  /** Default position of every valve; default 0. */
  valveDefault?: number;
  /** The CO2 filter is off (alpha 1) unless this is set. */
  alpha?: number;
}

/** Rooms a, b and c with one sensor and one supply valve each. */
export function createHouse(options: HouseOptions = {}): House {
  const logs: string[] = [];
  const sensors = [new Sensor("sensor_a"), new Sensor("sensor_b"), new Sensor("sensor_c")];
  const rooms = sensors.map((sensor, i) => new Room(["a", "b", "c"][i] ?? "", [sensor]));
  const valveDefault = options.valveDefault ?? 0;
  const valves = rooms.map((room) => {
    const valve = new Valve(`valve_${room.id}`, valveDefault, room, ValveType.Supply);
    valve.value = valveDefault;
    return valve;
  });
  const hru = typeof options.hru === "object" ? options.hru : new SimulatedHRU(options.hru ?? 2);
  const engine = new AutomaticModeEngine(new Building(rooms, [new Box(valves)]), hru, {
    info: (message) => logs.push(message),
  });
  engine.co2FilterAlpha = options.alpha ?? 1;
  return { engine, sensors, valves, logs };
}

/** One run at `time` seconds, with the time of day counted from `startSecondOfDay`. */
export function runAt(
  house: House,
  time: number,
  readings: Readings,
  startSecondOfDay = 8 * 3600,
): RunReport {
  [readings.a, readings.b, readings.c].forEach((co2, i) => {
    const sensor = house.sensors[i];
    if (sensor !== undefined) sensor.co2 = co2;
  });
  return house.engine.run(new Timestamp(time, (startSecondOfDay + time) % 86400));
}

/** Runs every second from 0 to `lastSecond`; the reports are indexed by second. */
export function simulate(
  house: House,
  lastSecond: number,
  readingsAt: (time: number) => Readings,
  startSecondOfDay = 8 * 3600,
): RunReport[] {
  const reports: RunReport[] = [];
  for (let time = 0; time <= lastSecond; time++) {
    reports.push(runAt(house, time, readingsAt(time), startSecondOfDay));
  }
  return reports;
}

export function at(reports: RunReport[], time: number): RunReport {
  const report = reports[time];
  if (report === undefined) {
    throw new Error(`No report for second ${time}`);
  }
  return report;
}

/** The seconds at which the HRU power changed, with the new power. */
export function powerChanges(reports: RunReport[]): { time: number; power: number }[] {
  return reports.flatMap((report, time) =>
    report.powerAfter === report.powerBefore ? [] : [{ time, power: report.powerAfter }],
  );
}

export const ALL_LOW: Readings = { a: 500, b: 500, c: 500 };

export function allLow(): Readings {
  return ALL_LOW;
}
