import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HruVariable } from "../../../src/features/hru/hru.definitions.js";
import type { Room } from "../../../src/services/db/rooms.js";
import type { HassState } from "../../../src/services/homeAssistantClient.js";
import { silentLogger } from "../../helpers/httpRouter.js";
import { setupTempDatabase } from "../../helpers/testDb.js";

type RunnerModule = typeof import("../../../src/services/automatic/runner.js");

function unitVariables(code: string): HruVariable[] {
  const file = path.resolve(`src/features/hru/definitions/units/${code}.json`);
  return (JSON.parse(readFileSync(file, "utf8")) as { variables: HruVariable[] }).variables;
}

function room(id: number, name: string, valves: string[], sensors: string[]): Room {
  return {
    id,
    name,
    sortOrder: id,
    valves,
    sensors: sensors.map((entityId) => ({ entityId, attribute: null })),
    setUp: valves.length > 0 && sensors.length > 0,
  };
}

/** A house around the runner: a clock, valves, a unit and sensors, all in memory. */
function house(options: { unit?: string; power?: number; rooms: Room[] }) {
  let now = new Date(2026, 10, 26, 12, 0, 0);
  const positions = new Map<string, number>();
  for (const r of options.rooms) for (const v of r.valves) positions.set(v, 0);
  positions.set("number.luftator_chodba", 30);
  const unit = { power: options.power ?? 20 };
  const co2 = new Map<string, number | null>();
  let hruOnline = true;

  const valves = {
    getSnapshot: vi.fn(async () =>
      [...positions].map(([entity_id, value]) => ({
        entity_id,
        state: String(value),
        attributes: {},
      })),
    ),
    setValue: vi.fn(async (entityId: string, value: number) => {
      positions.set(entityId, value);
      return { entity_id: entityId, state: String(value), attributes: {} };
    }),
  };
  const hru = {
    getCachedRead: () =>
      hruOnline
        ? {
            result: { values: { power: unit.power }, displayValues: {}, variables: [] },
            fetchedAt: now.getTime(),
          }
        : null,
    getReadFailure: () => null,
    getResolvedConfiguration: () => ({
      settings: { unit: options.unit ?? "atrea-am", host: "", port: 502, unitId: 1 },
      unit: { variables: unitVariables(options.unit ?? "atrea-am") },
    }),
    writeValues: vi.fn(async (data: Record<string, number>) => {
      unit.power = data.power ?? unit.power;
    }),
  };
  const sensors = {
    get(entityId: string): HassState | null | undefined {
      const value = co2.get(entityId);
      if (value === undefined) return undefined;
      return {
        entity_id: entityId,
        state: value === null ? "unavailable" : String(value),
        attributes: { unit_of_measurement: "ppm" },
        last_reported: now.toISOString(),
      };
    },
  };
  const journal = vi.fn();

  return {
    deps: {
      valves,
      hru,
      sensors,
      logger: silentLogger() as never,
      now: () => now,
      journal,
      rooms: () => options.rooms,
    },
    valves,
    hru,
    unit,
    positions,
    co2,
    journal,
    setHruOnline(value: boolean) {
      hruOnline = value;
    },
    advance(seconds: number) {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
}

describe("AutomaticRunner", () => {
  let cleanup: () => void;
  let runnerModule: RunnerModule;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    runnerModule = await import("../../../src/services/automatic/runner.js");
  });

  afterEach(() => cleanup());

  async function runFor(
    runner: InstanceType<RunnerModule["AutomaticRunner"]>,
    h: ReturnType<typeof house>,
    seconds: number,
  ) {
    for (let elapsed = 0; elapsed < seconds; elapsed += 10) {
      await runner.tick();
      h.advance(10);
    }
  }

  const twoRooms = [
    room(1, "Obývák", ["number.luftator_obyvak"], ["sensor.obyvak_co2"]),
    room(2, "Ložnice", ["number.luftator_loznice"], ["sensor.loznice_co2"]),
  ];

  it("a room above TH2 opens itself, closes the others partly and raises the power", async () => {
    const h = house({ rooms: twoRooms });
    h.co2.set("sensor.obyvak_co2", 1300);
    h.co2.set("sensor.loznice_co2", 600);
    const runner = new runnerModule.AutomaticRunner(h.deps);

    await runFor(runner, h, 200);

    expect(runner.status().branch).toBe("th2");
    expect(h.positions.get("number.luftator_loznice")).toBe(45);
    expect(h.valves.setValue).not.toHaveBeenCalledWith("number.luftator_obyvak", expect.anything());
    expect(h.hru.writeValues).toHaveBeenCalledWith({ power: 30 });
    expect(h.journal).toHaveBeenCalledWith("power", expect.anything(), expect.any(Date));
  });

  it("writes nothing in quiet runs", async () => {
    const h = house({ rooms: twoRooms });
    h.co2.set("sensor.obyvak_co2", 600);
    h.co2.set("sensor.loznice_co2", 600);
    const runner = new runnerModule.AutomaticRunner(h.deps);
    await runFor(runner, h, 60);
    expect(h.valves.setValue).not.toHaveBeenCalled();
    expect(h.hru.writeValues).not.toHaveBeenCalled();
  });

  it("never writes a valve outside the rooms, and starts from the real positions", async () => {
    const h = house({ rooms: twoRooms });
    h.positions.set("number.luftator_obyvak", 45);
    h.co2.set("sensor.obyvak_co2", 1300);
    h.co2.set("sensor.loznice_co2", 600);
    const runner = new runnerModule.AutomaticRunner(h.deps);
    await runFor(runner, h, 200);
    // Obývák started partly closed and needs air: opened from its real 45.
    expect(h.valves.setValue).toHaveBeenCalledWith("number.luftator_obyvak", 0);
    expect(h.valves.setValue).not.toHaveBeenCalledWith("number.luftator_chodba", expect.anything());
    expect(runner.lockedValves().map((v) => v.entityId)).toEqual([
      "number.luftator_obyvak",
      "number.luftator_loznice",
    ]);
  });

  it("reports each reason it cannot run, and runs again once it clears", async () => {
    const noRooms = house({ rooms: [room(1, "Koupelna", ["number.luftator_k"], [])] });
    const idle = new runnerModule.AutomaticRunner(noRooms.deps);
    expect(await idle.tick()).toBe("noRooms");

    const h = house({ rooms: twoRooms });
    const runner = new runnerModule.AutomaticRunner(h.deps);
    expect(await runner.tick()).toBe("noReadings");
    h.co2.set("sensor.obyvak_co2", null);
    expect(await runner.tick()).toBe("noReadings");
    h.setHruOnline(false);
    h.co2.set("sensor.obyvak_co2", 700);
    expect(await runner.tick()).toBe("hruUnavailable");
    h.setHruOnline(true);
    expect(await runner.tick()).toBeNull();
    expect(runner.status()).toMatchObject({
      active: true,
      reason: null,
      branch: expect.any(String),
    });
    expect(h.journal).toHaveBeenCalledWith(
      "cannotRun",
      { reason: null, previous: "hruUnavailable" },
      expect.any(Date),
    );
  });

  it("cannot run without a known power maximum", async () => {
    const h = house({ rooms: twoRooms });
    h.co2.set("sensor.obyvak_co2", 700);
    h.deps.hru.getResolvedConfiguration = () => ({
      settings: { unit: "x", host: "", port: 502, unitId: 1 },
      unit: {
        variables: [
          { name: "power", type: "number", editable: true, label: "p", class: "power" },
        ] as HruVariable[],
      },
    });
    expect(await new runnerModule.AutomaticRunner(h.deps).tick()).toBe("noPowerMax");
  });

  it("steps a unit with levels one level at a time", async () => {
    const h = house({ unit: "zehnder", power: 1, rooms: twoRooms });
    h.co2.set("sensor.obyvak_co2", 1300);
    h.co2.set("sensor.loznice_co2", 600);
    const runner = new runnerModule.AutomaticRunner(h.deps);
    await runFor(runner, h, 200);
    expect(h.hru.writeValues).toHaveBeenCalledWith({ power: 2 });
    expect(h.unit.power).toBe(2);
  });

  it("starts a fresh engine on every activation", async () => {
    const h = house({ rooms: twoRooms });
    h.co2.set("sensor.obyvak_co2", 1300);
    h.co2.set("sensor.loznice_co2", 600);
    const runner = new runnerModule.AutomaticRunner(h.deps);
    await runFor(runner, h, 200);
    runner.deactivate("boost");
    expect(runner.isActive()).toBe(false);
    expect(runner.lockedValves()).toEqual([]);
    await runner.tick();
    // A new engine has no timers yet: the room is not counted above TH2 until Tzone passes again.
    expect(runner.status().branch).not.toBe("th2");
    expect(h.journal).toHaveBeenCalledWith("stop", { source: "boost" }, expect.any(Date));
  });
});
