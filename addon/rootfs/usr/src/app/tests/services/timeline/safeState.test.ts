import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type SchedulerModule = typeof import("../../../src/services/timelineScheduler.js");
type Scheduler = InstanceType<SchedulerModule["TimelineScheduler"]>;

interface Payload {
  hruConfig: { variables?: Record<string, number> } | null;
  source: string;
}

/** The private resolution step under test, reached without starting timers. */
type NoEventResolver = {
  resolveNoEventPayload: (unitId: string | undefined) => Payload | null;
  applyEventValues: (payload: Payload) => Promise<void>;
};

/** One scheduler tick as the loop runs it: resolve, then apply what came back. */
async function tick(scheduler: Scheduler): Promise<Payload | null> {
  const resolver = scheduler as unknown as NoEventResolver;
  const payload = resolver.resolveNoEventPayload(UNIT);
  if (payload) await resolver.applyEventValues(payload);
  return payload;
}

const UNIT = "atrea-am";

const UNIT_DEFINITION = {
  id: UNIT,
  variables: [
    { name: "power", type: "number", editable: true, min: 0, max: 100 },
    { name: "temperature", type: "number", editable: true, min: 10, max: 40 },
    { name: "mode", type: "select", editable: true },
  ],
};

/**
 * When the active season resolves no event the unit is driven to a defined low
 * state - once. Re-asserting it on every 10s tick would undo any manual
 * adjustment within ten seconds of the user making it, which from the outside
 * is indistinguishable from broken hardware.
 */
describe("safe state", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let scheduler: Scheduler;
  let writeValues: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;

    db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       VALUES ('spring', ?, '01-01', '12-31', 1, 0)`,
    ).run(UNIT);
    db.prepare(
      `INSERT INTO app_settings (key, value) VALUES ('timeline.seasons_enabled', 'true')`,
    ).run();
    // The fallback is gated on the install having had a schedule at some point.
    db.prepare(
      `INSERT INTO timeline_events (start_time, day_of_week, hru_config, enabled, priority, hru_id)
       VALUES ('06:00', 0, '{"mode":"1"}', 1, 0, ?)`,
    ).run(UNIT);

    const { TimelineScheduler } = await import("../../../src/services/timelineScheduler.js");
    writeValues = vi.fn(async () => undefined);
    scheduler = new TimelineScheduler(
      {} as never,
      { getAllUnits: () => [UNIT_DEFINITION], writeValues } as never,
      { setTimelineOverride: vi.fn() } as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    );
  });

  afterEach(() => {
    cleanup();
  });

  function resolve() {
    return (scheduler as unknown as NoEventResolver).resolveNoEventPayload(UNIT);
  }

  it("writes the safe state on entering the no-event condition", () => {
    const payload = resolve();

    expect(payload?.source).toBe("fallback");
    expect(payload?.hruConfig?.variables).toMatchObject({ power: 0, temperature: 20 });
  });

  it("does not re-assert it on subsequent ticks once the write succeeded", async () => {
    await tick(scheduler);
    expect(writeValues).toHaveBeenCalledTimes(1);

    for (let round = 0; round < 5; round++) {
      const payload = await tick(scheduler);
      // Still reported as the fallback, but with nothing to write.
      expect(payload?.source).toBe("fallback");
      expect(payload?.hruConfig).toBeNull();
    }
    expect(writeValues).toHaveBeenCalledTimes(1);
  });

  it("retries on the next tick when the write failed", async () => {
    // Modbus unreachable on the tick the schedule ran out.
    writeValues.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await tick(scheduler);
    expect(writeValues).toHaveBeenCalledTimes(1);

    // Not remembered as applied: the unit is still on its old values.
    const retry = await tick(scheduler);
    expect(retry?.hruConfig?.variables).toMatchObject({ power: 0, temperature: 20 });
    expect(writeValues).toHaveBeenCalledTimes(2);

    // And only now does it settle.
    expect((await tick(scheduler))?.hruConfig).toBeNull();
    expect(writeValues).toHaveBeenCalledTimes(2);
  });

  it("writes it again after something else has applied in between", async () => {
    await tick(scheduler);
    expect((await tick(scheduler))?.hruConfig).toBeNull();

    await (scheduler as unknown as NoEventResolver).applyEventValues({
      hruConfig: { variables: { power: 60 } },
      source: "schedule",
    });

    expect(resolve()?.hruConfig?.variables).toMatchObject({ power: 0, temperature: 20 });
  });

  it("leaves the temperature inside the unit's declared range", () => {
    const payload = resolve();
    const temperature = payload?.hruConfig?.variables?.temperature ?? 0;

    expect(temperature).toBeGreaterThanOrEqual(10);
    expect(temperature).toBeLessThanOrEqual(40);
  });
});
