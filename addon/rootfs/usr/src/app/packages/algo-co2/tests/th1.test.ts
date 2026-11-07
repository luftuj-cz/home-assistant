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
    // The valve positions are what these tests assert on; log lines would only add noise.
  },
};

interface Readings {
  a: number;
  b: number;
  c: number;
}

/**
 * Rooms a, b and c with one sensor and one supply valve (default 0) each, the CO2 filter off so the
 * readings are the filtered values. Runs seconds 0..lastSecond and returns the valve positions
 * after each run, with the report.
 */
function simulate(
  lastSecond: number,
  readingsAt: (time: number) => Readings,
): { positions: number[][]; reports: RunReport[] } {
  const sensors = [new Sensor("sensor_a"), new Sensor("sensor_b"), new Sensor("sensor_c")];
  const rooms = sensors.map((sensor, i) => new Room(["a", "b", "c"][i] ?? "", [sensor]));
  const valves = rooms.map((room) => new Valve(`valve_${room.id}`, 0, room, ValveType.Supply));
  const engine = new AutomaticModeEngine(
    new Building(rooms, [new Box(valves)]),
    new SimulatedHRU(2),
    logger,
  );
  engine.co2FilterAlpha = 1;

  const positions: number[][] = [];
  const reports: RunReport[] = [];
  for (let time = 0; time <= lastSecond; time++) {
    const readings = readingsAt(time);
    [readings.a, readings.b, readings.c].forEach((co2, i) => {
      const sensor = sensors[i];
      if (sensor !== undefined) sensor.co2 = co2;
    });
    reports.push(engine.run(Timestamp.simulate(time, 8)));
    positions.push(valves.map((valve) => valve.value));
  }
  return { positions, reports };
}

/** Room a above TH1 from the start, room b from second 60, room c at 500 ppm throughout. */
function staggered(time: number): Readings {
  return { a: 900, b: time >= 60 ? 900 : 500, c: 500 };
}

describe("TH1 branch with several rooms above TH1", () => {
  test("acting on a second room keeps the first one open", () => {
    const { positions } = simulate(180, staggered);

    expect(positions[120]).toEqual([0, 45, 45]);
    expect(positions[180]).toEqual([0, 0, 45]);
  });

  test("the rooms do not take turns once both are open", () => {
    const { positions, reports } = simulate(900, staggered);
    const changesAfterBothOpen = reports.slice(181).filter((r) => r.valvesChanged);

    expect(changesAfterBothOpen).toEqual([]);
    expect(positions[900]).toEqual([0, 0, 45]);
  });

  test("the cooldown still limits how often a room is acted on", () => {
    const { reports } = simulate(300, staggered);
    const actedOnA = reports.flatMap((r, time) => (r.roomsActedOn.includes("a") ? [time] : []));

    expect(actedOnA).toEqual([120, 240]);
  });
});
