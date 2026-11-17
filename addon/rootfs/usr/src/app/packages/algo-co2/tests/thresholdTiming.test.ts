import { describe, expect, test } from "vitest";

import {
  AutomaticModeEngine,
  Box,
  Building,
  Room,
  Sensor,
  ThresholdType,
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

interface Readings {
  a: number;
  b: number;
  c: number;
}

/**
 * Rooms a, b and c with one sensor and one supply valve each, the CO2 filter off so the readings are
 * the filtered values. `configure` may change the engine before the first run. Returns the reports
 * indexed by second.
 */
function simulate(
  lastSecond: number,
  readingsAt: (time: number) => Readings,
  configure: (engine: AutomaticModeEngine) => void = () => {
    // Defaults only.
  },
): RunReport[] {
  const sensors = [new Sensor("sensor_a"), new Sensor("sensor_b"), new Sensor("sensor_c")];
  const rooms = sensors.map((sensor, i) => new Room(["a", "b", "c"][i] ?? "", [sensor]));
  const valves = rooms.map((room) => new Valve(`valve_${room.id}`, 0, room, ValveType.Supply));
  const engine = new AutomaticModeEngine(
    new Building(rooms, [new Box(valves)]),
    new SimulatedHRU(2),
    logger,
  );
  engine.co2FilterAlpha = 1;
  configure(engine);

  const reports: RunReport[] = [];
  for (let time = 0; time <= lastSecond; time++) {
    const readings = readingsAt(time);
    [readings.a, readings.b, readings.c].forEach((co2, i) => {
      const sensor = sensors[i];
      if (sensor !== undefined) sensor.co2 = co2;
    });
    reports.push(engine.run(Timestamp.simulate(time, 8)));
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

/** Room a at `before` until second 200 and at `after` from then on; b and c at 500 ppm. */
function roomAFalls(before: number, after: number): (time: number) => Readings {
  return (time) => ({ a: time >= 200 ? after : before, b: 500, c: 500 });
}

/** Topen 300 s, Tzone at its default 120 s. */
function longTopen(engine: AutomaticModeEngine): void {
  engine.belowTimeLimit = 300;
}

describe("per-threshold hysteresis", () => {
  test("defaults to TH1 50 and TH2 100", () => {
    const engine = new AutomaticModeEngine(new Building([], []), new SimulatedHRU(2), logger);

    expect(engine.co2Hysteresis.get(ThresholdType.TH1)).toBe(50);
    expect(engine.co2Hysteresis.get(ThresholdType.TH2)).toBe(100);
  });

  test("TH2 is held until 100 ppm below it", () => {
    const reports = simulate(400, roomAFalls(1300, 1120));

    expect(at(reports, 199).roomsAboveTh2).toEqual(["a"]);
    expect(at(reports, 400).roomsAboveTh2).toEqual(["a"]);
  });

  test("TH2 is released under its own hysteresis", () => {
    const reports = simulate(201, roomAFalls(1300, 1090));

    expect(at(reports, 199).roomsAboveTh2).toEqual(["a"]);
    expect(at(reports, 201).roomsAboveTh2).toEqual([]);
  });

  test("TH1 keeps its own hysteresis", () => {
    const reports = simulate(201, roomAFalls(900, 740));

    expect(at(reports, 199).roomsAboveTh1).toEqual(["a"]);
    expect(at(reports, 201).roomsAboveTh1).toEqual([]);
  });

  test("a threshold without a hysteresis entry uses 0", () => {
    const reports = simulate(201, roomAFalls(1300, 1199), (engine) => {
      engine.co2Hysteresis.delete(ThresholdType.TH2);
    });

    expect(at(reports, 199).roomsAboveTh2).toEqual(["a"]);
    expect(at(reports, 201).roomsAboveTh2).toEqual([]);
  });
});

describe("separate Tzone and Topen", () => {
  test("defaults Topen to 120 s", () => {
    const engine = new AutomaticModeEngine(new Building([], []), new SimulatedHRU(2), logger);

    expect(engine.belowTimeLimit).toBe(120);
  });

  test("all-below waits for Topen", () => {
    const reports = simulate(300, () => ({ a: 500, b: 500, c: 500 }), longTopen);

    expect(at(reports, 120).branch).toBe("none");
    expect(at(reports, 299).branch).toBe("none");
    expect(at(reports, 300).branch).toBe("allBelow");
  });

  test("above TH1 still waits for Tzone", () => {
    const reports = simulate(120, () => ({ a: 900, b: 500, c: 500 }), longTopen);

    expect(at(reports, 119).branch).toBe("none");
    expect(at(reports, 120).branch).toBe("th1");
    expect(at(reports, 120).roomsActedOn).toEqual(["a"]);
  });

  test("fluctuation switches on after Tzone", () => {
    const reports = simulate(120, () => ({ a: 720, b: 720, c: 500 }), longTopen);

    expect(at(reports, 119).fluctuationActive).toBe(false);
    expect(at(reports, 120).fluctuationActive).toBe(true);
  });

  test("fluctuation switches off after Topen", () => {
    const reports = simulate(
      500,
      (time) => (time >= 200 ? { a: 500, b: 500, c: 500 } : { a: 720, b: 720, c: 500 }),
      longTopen,
    );

    expect(at(reports, 499).fluctuationActive).toBe(true);
    expect(at(reports, 500).fluctuationActive).toBe(false);
  });
});
