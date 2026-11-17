import { describe, expect, test, vi } from "vitest";

import testovaciDum from "../../houses/testovaci-dum.json";
import { hruFlowM3h } from "./airflow.ts";
import { AutomaticModeEngine, Building, ThresholdType } from "./engine.ts";
import { applyEngineParams, engineDefaults, readEngineParams } from "./engineParams.ts";
import type { EngineParams } from "./engineParams.ts";
import { PRESET_HOUSES } from "./presets.ts";
import { Simulation } from "./simulation.ts";
import { parseHouse } from "./house.ts";
import type { House, Scenario } from "./house.ts";
import type { RoomSnapshot, SimulationOptions } from "./simulation.ts";
import { DEFAULT_SIM_SETTINGS, HISTORY_LENGTH } from "./settings.ts";
import type { SimSettings } from "./settings.ts";

const HOUR = 3600;

type Points = [time: number, value: number][];

function presetHouse(id: string): House {
  const house = PRESET_HOUSES.find((candidate) => candidate.id === id);
  if (house === undefined) {
    throw new Error(`missing preset ${id}`);
  }
  return house;
}

function settings(overrides: Partial<SimSettings> = {}): SimSettings {
  return {
    ...DEFAULT_SIM_SETTINGS,
    co2PerPersonLph: { ...DEFAULT_SIM_SETTINGS.co2PerPersonLph },
    ...overrides,
  };
}

function createSimulation(overrides: Partial<SimulationOptions> = {}): Simulation {
  return new Simulation({
    house: presetHouse("testovaci-dum"),
    scenario: null,
    startSecondOfDay: 8 * HOUR,
    settings: settings(),
    ...overrides,
  });
}

function roomSnapshot(sim: Simulation, roomId: string): RoomSnapshot {
  const room = sim.snapshot().rooms.find((candidate) => candidate.id === roomId);
  if (room === undefined) {
    throw new Error(`missing room ${roomId}`);
  }
  return room;
}

/** The scripted readings of the package tests: linear between points, rounded, flat outside. */
function scripted(pointsBySensor: Record<string, Points>) {
  return function reading(sensorId: string, epochSecond: number): number | null {
    const points = pointsBySensor[sensorId] ?? [];
    const first = points[0];
    const last = points.at(-1);
    if (first === undefined || last === undefined) {
      return null;
    }
    if (epochSecond <= first[0]) {
      return first[1];
    }
    if (epochSecond >= last[0]) {
      return last[1];
    }
    for (const [index, [time, value]] of points.entries()) {
      const next = points[index + 1];
      if (next !== undefined && epochSecond >= time && epochSecond <= next[0]) {
        return Math.round(value + ((epochSecond - time) / (next[0] - time)) * (next[1] - value));
      }
    }
    return null;
  };
}

function pracovnaOptions(): Partial<SimulationOptions> {
  return {
    startSecondOfDay: 8 * HOUR,
    settings: settings({ enginePeriodS: 1, sensorIntervalS: 1 }),
    journal: true,
    sensorOverride: scripted({
      sensor_obyvak: [[0, 600]],
      sensor_loznice: [[0, 600]],
      sensor_pracovna: [
        [0, 600],
        [200, 900],
        [400, 1050],
        [600, 700],
      ],
    }),
  };
}

describe("engine fidelity", () => {
  test('replays the engine test "pracovna" journal', () => {
    const sim = createSimulation(pracovnaOptions());

    sim.advance(1000);

    expect(sim.engine.getJournalString()).toBe(
      "256,2,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:45,loznice_privod_2:45,pracovna_privod:0;694,2,obyvak_privod_1:0,obyvak_privod_2:0,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0",
    );
  });

  test('replays the engine test "noc" journal', () => {
    const sim = createSimulation({
      startSecondOfDay: 22 * HOUR,
      settings: settings({ enginePeriodS: 1, sensorIntervalS: 1 }),
      journal: true,
      sensorOverride: scripted({
        sensor_obyvak: [[0, 600]],
        sensor_loznice: [
          [0, 800],
          [300, 1202],
        ],
        sensor_pracovna: [[0, 900]],
      }),
    });

    sim.advance(1000);

    expect(sim.engine.getJournalString()).toBe(
      "120,2,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0;480,3,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0;600,4,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0;720,5,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0",
    );
  });

  test("logs the decision with valve changes", () => {
    const sim = createSimulation(pracovnaOptions());

    sim.advance(1000);

    const decision = sim
      .getLog()
      .find((entry) => entry.kind === "decision" && entry.epochSecond === 256);
    expect(decision?.kind).toBe("decision");
    if (decision?.kind !== "decision") {
      return;
    }
    expect(decision.report.branch).toBe("th1");
    expect(decision.valveChanges).toContainEqual({ valveId: "obyvak_privod_1", from: 0, to: 45 });
  });

  test("logs the engine's threshold messages", () => {
    const sim = createSimulation(pracovnaOptions());

    sim.advance(1000);

    const messages = sim.getLog().flatMap((entry) => (entry.kind === "engine" ? [entry] : []));
    expect(messages.length).toBeGreaterThan(0);
    for (const entry of messages) {
      expect(entry.message).toContain("threshold");
    }
    expect(messages[0]?.message).toContain("pracovna");
  });
});

describe("schedules", () => {
  test("calls the engine once per engine period", () => {
    const sim = createSimulation({ settings: settings({ enginePeriodS: 10 }) });
    const run = vi.spyOn(sim.engine, "run");

    sim.advance(30);

    expect(run).toHaveBeenCalledTimes(3);
  });

  test("changing the engine period mid-run keeps the schedule going", () => {
    const sim = createSimulation({ settings: settings({ enginePeriodS: 1 }) });
    const run = vi.spyOn(sim.engine, "run");

    sim.advance(5);
    expect(run).toHaveBeenCalledTimes(5);

    sim.setSettings(settings({ enginePeriodS: 60 }));
    sim.advance(59);
    expect(run).toHaveBeenCalledTimes(5);

    sim.advance(1);
    expect(run).toHaveBeenCalledTimes(6);
  });

  test("holds sensor readings between updates", () => {
    const sim = createSimulation({ settings: settings({ sensorIntervalS: 30 }) });
    sim.setOccupancy("loznice", { people: 4, activity: "active" });
    const initial = roomSnapshot(sim, "loznice");

    sim.advance(10);
    const held = roomSnapshot(sim, "loznice");

    expect(held.co2Ppm).toBeGreaterThan(initial.co2Ppm);
    expect(held.sensors[0]?.reading).toBe(initial.sensors[0]?.reading);

    sim.advance(20);
    const updated = roomSnapshot(sim, "loznice");

    expect(updated.sensors[0]?.reading).toBe(Math.round(updated.co2Ppm));
  });

  test("a scenario step overrides a manual change", () => {
    const scenario: Scenario = {
      id: "krok",
      name: "Krok",
      initialCo2Ppm: {},
      steps: [{ atSecondOfDay: 8 * HOUR + 60, roomId: "loznice", people: 2, activity: "sitting" }],
    };
    const sim = createSimulation({ scenario, startSecondOfDay: 8 * HOUR });
    sim.setOccupancy("loznice", { people: 5, activity: "sitting" });

    sim.advance(59);
    expect(roomSnapshot(sim, "loznice").occupancy.people).toBe(5);

    sim.advance(1);
    expect(roomSnapshot(sim, "loznice").occupancy.people).toBe(2);
  });

  test("applies a scenario step on the second day", () => {
    const scenario: Scenario = {
      id: "pulnoc",
      name: "Půlnoc",
      initialCo2Ppm: {},
      steps: [{ atSecondOfDay: 10, roomId: "loznice", people: 3, activity: "sleeping" }],
    };
    const sim = createSimulation({ scenario, startSecondOfDay: 24 * HOUR - 30 });
    sim.setOccupancy("loznice", { people: 1, activity: "sitting" });

    sim.advance(39);
    expect(roomSnapshot(sim, "loznice").occupancy).toEqual({ people: 1, activity: "sitting" });

    sim.advance(1);
    expect(roomSnapshot(sim, "loznice").occupancy).toEqual({ people: 3, activity: "sleeping" });
  });

  test("counts days and applies the night maximum", () => {
    const midnight = createSimulation({ startSecondOfDay: 24 * HOUR - 30 });
    midnight.advance(60);
    expect(midnight.snapshot().day).toBe(2);
    expect(midnight.snapshot().secondOfDay).toBe(30);

    const evening = createSimulation({ startSecondOfDay: 22 * HOUR - 60 });
    evening.advance(62);
    expect(evening.snapshot().maxPower).toBe(5);
  });

  test("samples history every 10 s for 24 h", () => {
    const sim = createSimulation();

    sim.advance(25 * HOUR);

    const history = sim.getHistory();
    expect(history).toHaveLength(HISTORY_LENGTH);
    expect(history.at(-1)?.epochSecond).toBe(90000);
    expect(history[0]?.epochSecond).toBe(3610);
  });

  test("history samples carry room CO2, the filtered value and the power", () => {
    const sim = createSimulation({ scenario: presetHouse("testovaci-dum").scenarios[0] ?? null });

    sim.advance(10);

    const sample = sim.getHistory().at(-1);
    expect(sample?.epochSecond).toBe(10);
    expect(Object.keys(sample?.co2Ppm ?? {})).toEqual(["obyvak", "pracovna", "loznice"]);
    expect(sample?.filteredCo2Ppm.loznice).toBe(900);
    expect(sample?.power).toBe(sim.snapshot().power);
  });
});

describe("sensors", () => {
  test("keeps running with every sensor broken", () => {
    const sim = createSimulation();
    for (const sensorId of ["sensor_obyvak", "sensor_pracovna", "sensor_loznice"]) {
      sim.setSensorBroken(sensorId, true);
    }

    sim.advance(200);

    const snapshot = sim.snapshot();
    expect(snapshot.lastReport?.branch).toBe("allBelow");
    expect(snapshot.rooms.map((room) => room.filteredCo2Ppm)).toEqual([null, null, null]);
  });

  test("a broken sensor reads null at once and reads again once repaired", () => {
    const sim = createSimulation({ settings: settings({ sensorIntervalS: 30 }) });

    sim.setSensorBroken("sensor_loznice", true);
    expect(roomSnapshot(sim, "loznice").sensors).toEqual([
      { id: "sensor_loznice", reading: null, broken: true },
    ]);

    sim.setSensorBroken("sensor_loznice", false);
    expect(roomSnapshot(sim, "loznice").sensors).toEqual([
      { id: "sensor_loznice", reading: 500, broken: false },
    ]);
  });

  test("noise perturbs readings with Box–Muller noise of the configured sigma", () => {
    const sim = createSimulation({
      settings: settings({ sensorNoise: true, sensorNoiseSigmaPpm: 15 }),
      // u1 = u2 = 0.5 gives a standard normal draw of -sqrt(2 ln 2), about -1.18.
      random: () => 0.5,
    });

    expect(roomSnapshot(sim, "loznice").sensors[0]?.reading).toBe(482);
  });

  test("without noise the random source is never drawn", () => {
    const random = vi.fn(() => 0.5);
    const sim = createSimulation({ random });

    sim.advance(100);

    expect(random).not.toHaveBeenCalled();
  });
});

describe("initial state", () => {
  test("starts from the house defaults and the scenario's initial CO2", () => {
    const house = presetHouse("testovaci-dum");
    const sim = createSimulation({
      house,
      scenario: house.scenarios.find((scenario) => scenario.id === "noc-dva") ?? null,
    });

    const snapshot = sim.snapshot();
    expect(snapshot.epochSecond).toBe(0);
    expect(snapshot.power).toBe(2);
    expect(snapshot.rooms.find((room) => room.id === "loznice")?.co2Ppm).toBe(900);
    expect(snapshot.rooms.find((room) => room.id === "obyvak")?.co2Ppm).toBe(500);
    expect(snapshot.rooms.flatMap((room) => room.valves.map((valve) => valve.position))).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });

  test("a scenario that lists only some rooms still gives every room a start value", () => {
    const scenario: Scenario = {
      id: "castecny",
      name: "Částečný",
      initialCo2Ppm: { loznice: 700 },
      steps: [],
    };
    const sim = createSimulation({ scenario });

    expect(roomSnapshot(sim, "loznice").co2Ppm).toBe(700);
    expect(roomSnapshot(sim, "obyvak").co2Ppm).toBe(500);
    expect(roomSnapshot(sim, "pracovna").co2Ppm).toBe(500);
  });

  test("valves start at their default position", () => {
    const house = presetHouse("testovaci-dum");
    const [box] = house.boxes;
    const sim = createSimulation({
      house: {
        ...house,
        boxes: [
          {
            id: "box",
            valves: (box?.valves ?? []).map((valve) => ({ ...valve, defaultPosition: 20 })),
          },
        ],
      },
    });

    expect(
      sim.snapshot().rooms.flatMap((room) => room.valves.map((valve) => valve.position)),
    ).toEqual([20, 20, 20, 20, 20]);
  });

  test("the HRU starts at the engine's minimum power when the house gives none", () => {
    const sim = createSimulation({ house: presetHouse("rodinny-dum") });

    expect(sim.snapshot().power).toBe(engineDefaults().hruMinPower);
  });

  test("the HRU minimum power comes from the engine params given at the start", () => {
    const sim = createSimulation({
      house: presetHouse("rodinny-dum"),
      engineParams: { ...engineDefaults(), hruMinPower: 3.5 },
    });

    expect(sim.snapshot().power).toBe(3.5);
  });

  test("rooms without sensors are rooms without a reading, and the run keeps going", () => {
    const sim = createSimulation({
      house: presetHouse("rodinny-dum"),
      scenario: presetHouse("rodinny-dum").scenarios[0] ?? null,
      startSecondOfDay: 6 * HOUR,
    });

    sim.advance(6 * HOUR);

    const snapshot = sim.snapshot();
    for (const roomId of ["wc", "koupelna", "chodba"]) {
      const room = snapshot.rooms.find((candidate) => candidate.id === roomId);
      expect(room?.sensors).toEqual([]);
      expect(room?.filteredCo2Ppm).toBeNull();
    }
    expect(snapshot.lastReport?.roomsWithReading).not.toContain("wc");
    expect(snapshot.rooms.find((room) => room.id === "loznice")?.filteredCo2Ppm).not.toBeNull();
  });
});

describe("determinism and isolation", () => {
  test("identical inputs give identical runs", () => {
    const house = presetHouse("testovaci-dum");
    const options = {
      house,
      scenario: house.scenarios[0] ?? null,
      startSecondOfDay: 6 * HOUR,
      settings: settings({ enginePeriodS: 5, sensorIntervalS: 10 }),
    };
    const first = new Simulation(options);
    const second = new Simulation(options);

    first.advance(HOUR);
    second.advance(HOUR);

    expect(first.snapshot()).toEqual(second.snapshot());
    expect(first.getLog()).toEqual(second.getLog());
    expect(first.getHistory()).toEqual(second.getHistory());
  });

  test("a snapshot is a copy that later steps do not change", () => {
    const sim = createSimulation();
    sim.setOccupancy("loznice", { people: 4, activity: "active" });
    sim.advance(30);
    const snapshot = sim.snapshot();
    const frozen = structuredClone(snapshot);

    sim.advance(600);

    expect(snapshot).toEqual(frozen);
    expect(sim.snapshot()).not.toEqual(frozen);
  });

  test("the simulation copies the settings it is given", () => {
    const given = settings();
    const sim = createSimulation({ settings: given });
    const reference = createSimulation({ settings: settings() });
    sim.setOccupancy("loznice", { people: 4, activity: "active" });
    reference.setOccupancy("loznice", { people: 4, activity: "active" });

    given.co2PerPersonLph.active = 0;
    given.outdoorCo2Ppm = 0;
    sim.advance(600);
    reference.advance(600);

    expect(sim.snapshot()).toEqual(reference.snapshot());
  });

  test("setSettings copies the settings and applies them from the next step", () => {
    const sim = createSimulation();
    sim.setOccupancy("loznice", { people: 4, activity: "active" });
    const given = settings({
      co2PerPersonLph: { sleeping: 0, sitting: 0, active: 0 },
      infiltrationAch: 0,
    });
    sim.setSettings(given);
    given.co2PerPersonLph.active = 1000;

    sim.advance(60);

    expect(roomSnapshot(sim, "loznice").co2Ppm).toBeLessThanOrEqual(500);
  });
});

describe("engine params", () => {
  test("engineDefaults reads a fresh engine, and applying then reading round-trips", () => {
    const fresh = new AutomaticModeEngine(
      new Building([], []),
      {
        getPower: () => 0,
        setPower: () => {
          // The engine is only read here.
        },
      },
      {
        info() {
          // The engine is only read here.
        },
      },
    );
    const defaults = engineDefaults();

    expect(defaults.th1).toBe(fresh.thresholds.get(ThresholdType.TH1));
    expect(defaults.th2).toBe(fresh.thresholds.get(ThresholdType.TH2));
    expect(defaults.dayEnd).toBe(fresh.dayEnd);

    const changed = {
      th1: 700,
      th2: 1100,
      th1Hysteresis: 30,
      th2Hysteresis: 60,
      thresholdTimeLimit: 60,
      belowTimeLimit: 90,
      co2FilterAlpha: 0.5,
      hruMinPower: 2.5,
      hruMaxPowerDay: 9,
      hruMaxPowerNight: 4,
      hruPowerStep: 0.5,
      hruMovePower: 3.5,
      fluctuationEnabled: true,
      fluctuationOffset: 80,
      partialCloseValue: 50,
      fullyOpenValue: 5,
      dayStart: 6 * HOUR,
      dayEnd: 21 * HOUR,
    };
    applyEngineParams(fresh, changed);

    expect(readEngineParams(fresh)).toEqual(changed);
  });

  test("setEngineParams reconfigures the running engine", () => {
    const sim = createSimulation();

    sim.setEngineParams({ ...readEngineParams(sim.engine), th1: 400, hruMaxPowerNight: 33 });

    expect(sim.engine.thresholds.get(ThresholdType.TH1)).toBe(400);
    expect(sim.engine.hruMaxPowerNight).toBe(33);
  });

  test("lower thresholds make the engine react to the same air", () => {
    const sim = createSimulation({
      engineParams: { ...engineDefaults(), th1: 450, thresholdTimeLimit: 5 },
    });

    sim.advance(60);

    expect(sim.snapshot().lastReport?.roomsAboveTh1).toEqual(["obyvak", "pracovna", "loznice"]);
  });
});

describe("closed loop", () => {
  // Thresholds no room can reach: the engine only ever finds every room below TH1, which resets the
  // valves to their defaults and never lowers the power below its minimum, so neither moves.
  const NEUTRAL_ENGINE = { ...engineDefaults(), th1: 5000, th2: 6000 };

  /** The Testovací dům file with the valves of ložnice at `position` by default. */
  function lozniceValvesAt(position: number): House {
    return parseHouse("testovaci-dum", {
      ...testovaciDum,
      boxes: testovaciDum.boxes.map((box) => ({
        ...box,
        valves: box.valves.map((valve) =>
          valve.room === "loznice" ? { ...valve, defaultPosition: position } : valve,
        ),
      })),
    });
  }

  /** The Testovací dům file without an initial power, so the HRU starts at the engine's minimum. */
  function startingAtMinimumPower(): House {
    return parseHouse("testovaci-dum", { ...testovaciDum, hru: { nominalFlowM3h: 200 } });
  }

  function twoSleepersForTwoHours(house: House, engineParams: EngineParams): Simulation {
    const sim = createSimulation({ house, engineParams });
    sim.setOccupancy("loznice", { people: 2, activity: "sleeping" });
    sim.advance(2 * HOUR);
    return sim;
  }

  test("a more closed valve leaves more CO2 in its room", () => {
    const [open, partlyClosed, closed] = [0, 45, 90].map((position) =>
      roomSnapshot(twoSleepersForTwoHours(lozniceValvesAt(position), NEUTRAL_ENGINE), "loznice"),
    );

    expect([open, partlyClosed, closed].map((room) => room.valves.map((v) => v.position))).toEqual([
      [0, 0],
      [45, 45],
      [90, 90],
    ]);
    expect(open.co2Ppm).toBeLessThan(partlyClosed.co2Ppm);
    expect(partlyClosed.co2Ppm).toBeLessThan(closed.co2Ppm);
  });

  test("a higher HRU power leaves less CO2 in the room", () => {
    const lowPower = twoSleepersForTwoHours(startingAtMinimumPower(), {
      ...NEUTRAL_ENGINE,
      hruMinPower: 2,
    });
    const highPower = twoSleepersForTwoHours(startingAtMinimumPower(), {
      ...NEUTRAL_ENGINE,
      hruMinPower: 8,
    });

    expect(lowPower.snapshot().power).toBe(2);
    expect(highPower.snapshot().power).toBe(8);
    expect(roomSnapshot(highPower, "loznice").co2Ppm).toBeLessThan(
      roomSnapshot(lowPower, "loznice").co2Ppm,
    );
  });

  test("the total flow is the nominal flow scaled by the current power", () => {
    const flows = [2, 8].map(
      (hruMinPower) =>
        createSimulation({
          house: startingAtMinimumPower(),
          engineParams: { ...NEUTRAL_ENGINE, hruMinPower },
        }).snapshot().totalFlowM3h,
    );

    expect(flows).toEqual([40, 160]);
    expect(flows).toEqual([hruFlowM3h(200, 2), hruFlowM3h(200, 8)]);
  });

  test("a supply room stays fresh while the exhaust room that draws from it fills", () => {
    const house = parseHouse("privod-odtah", {
      name: "Přívod a odtah",
      hru: { nominalFlowM3h: 200 },
      rooms: [
        { id: "privod", name: "Přívod", rect: { x: 0, y: 0, w: 4, d: 3 }, sensors: [] },
        { id: "odtah", name: "Odtah", rect: { x: 4, y: 0, w: 4, d: 3 }, sensors: [] },
      ],
      boxes: [
        {
          id: "box",
          valves: [
            { id: "privod_v", room: "privod", type: "supply", defaultPosition: 0 },
            { id: "odtah_v", room: "odtah", type: "exhaust", defaultPosition: 0 },
          ],
        },
      ],
      scenarios: [],
    });
    const sim = createSimulation({ house, engineParams: NEUTRAL_ENGINE });
    sim.setOccupancy("odtah", { people: 2, activity: "sleeping" });

    sim.advance(2 * HOUR);

    expect(roomSnapshot(sim, "privod").co2Ppm).toBeLessThan(450);
    expect(roomSnapshot(sim, "odtah").co2Ppm).toBeGreaterThan(900);
  });
});
