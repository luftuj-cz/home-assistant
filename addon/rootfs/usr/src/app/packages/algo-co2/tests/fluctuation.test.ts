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

type Reading = number | null;

interface Readings {
  a: Reading;
  b: Reading;
  c: Reading;
}

interface House {
  engine: AutomaticModeEngine;
  hru: SimulatedHRU;
  sensors: { a: Sensor; b: Sensor; c: Sensor };
  valves: Valve[];
}

/**
 * Rooms a, b and c, one sensor and one supply valve (default 10) each. Fluctuation is on (the default)
 * with Pmove 40, and the CO2 filter is off (alpha 1) so the readings are the filtered values.
 */
function createHouse(hruPower = 20): House {
  const sensors = {
    a: new Sensor("sensor_a"),
    b: new Sensor("sensor_b"),
    c: new Sensor("sensor_c"),
  };
  const rooms = [
    new Room("a", [sensors.a]),
    new Room("b", [sensors.b]),
    new Room("c", [sensors.c]),
  ];
  const valves = rooms.map(
    (room) => new Valve(`valve_${room.id}`, VALVE_DEFAULT, room, ValveType.Supply),
  );
  const hru = new SimulatedHRU(hruPower);
  const engine = new AutomaticModeEngine(new Building(rooms, [new Box(valves)]), hru, logger);
  engine.co2FilterAlpha = 1;
  engine.hruMovePower = 40;
  return { engine, hru, sensors, valves };
}

/**
 * Runs seconds 0..lastSecond, setting the readings before each run, and returns the reports indexed
 * by second. `beforeRun` may change the engine before a given second's run.
 */
function simulate(
  house: House,
  lastSecond: number,
  readingsAt: (time: number) => Readings,
  options: { startHour?: number; beforeRun?: (time: number) => void } = {},
): RunReport[] {
  const reports: RunReport[] = [];
  for (let time = 0; time <= lastSecond; time++) {
    const readings = readingsAt(time);
    house.sensors.a.co2 = readings.a;
    house.sensors.b.co2 = readings.b;
    house.sensors.c.co2 = readings.c;
    options.beforeRun?.(time);
    reports.push(house.engine.run(Timestamp.simulate(time, options.startHour ?? 8)));
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

function constant(readings: Readings): () => Readings {
  return () => readings;
}

/** Rooms a and b in the band at 720 ppm, room c at 500 ppm. */
const TWO_IN_BAND: Readings = { a: 720, b: 720, c: 500 };

describe("fluctuation", () => {
  describe("on by default, can be turned off", () => {
    test("is enabled by default", () => {
      const engine = new AutomaticModeEngine(new Building([], []), new SimulatedHRU(20), logger);

      expect(engine.fluctuationEnabled).toBe(true);
    });

    test("never switches on while disabled", () => {
      const house = createHouse();
      house.engine.fluctuationEnabled = false;
      const reports = simulate(house, 300, constant(TWO_IN_BAND));

      expect(reports.every((r) => !r.fluctuationActive && r.branch !== "fluctuation")).toBe(true);
      expect(at(reports, 120).branch).toBe("allBelow");
    });

    test("switches off in the run after it is disabled", () => {
      const house = createHouse();
      const reports = simulate(house, 121, constant(TWO_IN_BAND), {
        beforeRun: (time) => {
          if (time === 121) house.engine.fluctuationEnabled = false;
        },
      });

      expect(at(reports, 120).fluctuationActive).toBe(true);
      expect(at(reports, 121).fluctuationActive).toBe(false);
      expect(at(reports, 121).branch).not.toBe("fluctuation");
    });
  });

  describe("per-room level tracking", () => {
    test("a dip below the level restarts the room's timer", () => {
      const reports = simulate(createHouse(), 230, (time) => ({
        a: time === 100 ? 690 : 720,
        b: 720,
        c: 500,
      }));

      expect(at(reports, 120).fluctuationActive).toBe(false);
      expect(at(reports, 220).fluctuationActive).toBe(false);
      expect(at(reports, 221).fluctuationActive).toBe(true);
    });

    test("a sensor dropout clears the room's timer", () => {
      const reports = simulate(createHouse(), 210, (time) => ({
        a: time >= 60 && time < 80 ? null : 720,
        b: 720,
        c: 500,
      }));

      expect(at(reports, 120).fluctuationActive).toBe(false);
      expect(at(reports, 199).fluctuationActive).toBe(false);
      expect(at(reports, 200).fluctuationActive).toBe(true);
    });
  });

  describe("switching on", () => {
    test("two rooms in the band for the time limit switch it on", () => {
      const reports = simulate(createHouse(), 120, constant(TWO_IN_BAND));

      expect(at(reports, 119).fluctuationActive).toBe(false);
      expect(at(reports, 120).fluctuationActive).toBe(true);
      expect(at(reports, 120).branch).toBe("fluctuation");
    });

    test("one room alone is not a fluctuation", () => {
      const reports = simulate(createHouse(), 300, constant({ a: 780, b: 500, c: 500 }));

      expect(reports.some((r) => r.fluctuationActive)).toBe(false);
    });

    test("a room above TH1 takes precedence", () => {
      const reports = simulate(createHouse(), 200, constant({ a: 900, b: 720, c: 500 }));

      expect(at(reports, 120).branch).toBe("th1");
      expect(reports.some((r) => r.fluctuationActive)).toBe(false);
    });
  });

  describe("staying on", () => {
    test("stays on while one of the two rooms remains in the band", () => {
      const reports = simulate(createHouse(), 600, (time) => ({
        a: 720,
        b: time >= 200 ? 500 : 720,
        c: 500,
      }));

      expect(reports.slice(120).every((r) => r.fluctuationActive)).toBe(true);
      expect(at(reports, 600).powerAfter).toBe(40);
    });

    test("switches off once every room has been below the level for the time limit", () => {
      const house = createHouse();
      const reports = simulate(house, 320, (time) =>
        time >= 200 ? { a: 500, b: 500, c: 500 } : TWO_IN_BAND,
      );

      expect(at(reports, 319).fluctuationActive).toBe(true);
      expect(at(reports, 320).fluctuationActive).toBe(false);
      expect(at(reports, 320).branch).toBe("allBelow");
      expect(at(reports, 320).powerAfter).toBe(30);
    });

    test("a short dip of every room does not switch it off", () => {
      const reports = simulate(createHouse(), 600, (time) =>
        time >= 200 && time < 260 ? { a: 500, b: 500, c: 500 } : TWO_IN_BAND,
      );

      expect(reports.slice(120).every((r) => r.fluctuationActive)).toBe(true);
      expect(reports.slice(120).every((r) => r.powerAfter === 40)).toBe(true);
    });

    test("switches off when no room has a reading", () => {
      const reports = simulate(createHouse(), 200, (time) =>
        time >= 200 ? { a: null, b: null, c: null } : TWO_IN_BAND,
      );

      expect(at(reports, 199).fluctuationActive).toBe(true);
      expect(at(reports, 200).fluctuationActive).toBe(false);
    });

    test("survives a TH1 episode", () => {
      const reports = simulate(createHouse(), 900, (time) => ({
        a: time >= 200 && time < 600 ? 900 : 720,
        b: 720,
        c: 500,
      }));

      expect(at(reports, 400).branch).toBe("th1");
      expect(at(reports, 400).fluctuationActive).toBe(true);
      expect(at(reports, 600).branch).toBe("fluctuation");
      expect(at(reports, 900).fluctuationActive).toBe(true);
    });
  });

  describe("fluctuation branch", () => {
    test("raises power to Pmove in one run and puts valves at their defaults", () => {
      const house = createHouse();
      const reports = simulate(house, 120, constant(TWO_IN_BAND));
      const report = at(reports, 120);

      expect(report.powerBefore).toBe(20);
      expect(report.powerAfter).toBe(40);
      expect(report.valvesChanged).toBe(true);
      expect(house.valves.map((v) => v.value)).toEqual([
        VALVE_DEFAULT,
        VALVE_DEFAULT,
        VALVE_DEFAULT,
      ]);
    });

    test("steps power down to Pmove, not to Pmin", () => {
      const reports = simulate(createHouse(80), 130, constant(TWO_IN_BAND));

      expect(reports.slice(120, 125).map((r) => r.powerAfter)).toEqual([70, 60, 50, 40, 40]);
      expect(at(reports, 130).powerAfter).toBe(40);
    });

    test("caps Pmove by the night maximum", () => {
      const house = createHouse();
      house.engine.hruMovePower = 60;
      const reports = simulate(house, 120, constant(TWO_IN_BAND), { startHour: 23 });

      expect(at(reports, 120).maxPower).toBe(50);
      expect(at(reports, 120).powerAfter).toBe(50);
    });

    test("never goes below the HRU minimum", () => {
      const house = createHouse(30);
      house.engine.hruMovePower = 10;
      const reports = simulate(house, 125, constant(TWO_IN_BAND));

      expect(at(reports, 125).powerAfter).toBe(20);
    });

    test("does not put rooms into cooldown", () => {
      const reports = simulate(createHouse(), 260, (time) => ({
        a: time >= 130 ? 900 : 720,
        b: 720,
        c: 500,
      }));
      const firstTh1 = reports.findIndex((r) => r.roomsAboveTh1.includes("a"));

      expect(firstTh1).toBe(250);
      expect(at(reports, firstTh1).branch).toBe("th1");
      expect(at(reports, firstTh1).roomsActedOn).toEqual(["a"]);
    });
  });

  describe("report", () => {
    test("lists the rooms above the level in building order", () => {
      const reports = simulate(createHouse(), 120, constant({ a: 500, b: 720, c: 720 }));

      expect(at(reports, 119).roomsAboveFluctuation).toEqual([]);
      expect(at(reports, 120).roomsAboveFluctuation).toEqual(["b", "c"]);
    });
  });
});
