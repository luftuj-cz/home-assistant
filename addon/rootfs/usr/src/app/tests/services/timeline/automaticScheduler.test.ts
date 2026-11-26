import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type SchedulerModule = typeof import("../../../src/services/timelineScheduler.js");
type Scheduler = InstanceType<SchedulerModule["TimelineScheduler"]>;
type DatabaseModule = typeof import("../../../src/services/database.js");

const UNIT = "atrea-am";

const UNIT_DEFINITION = {
  id: UNIT,
  variables: [
    { name: "power", type: "number", editable: true, min: 0, max: 100 },
    { name: "temperature", type: "number", editable: true, min: 10, max: 40 },
  ],
};

/**
 * Where automatic control comes in: the built-in "Automatika" in the schedule, or no schedule event at all.
 * A boost and plan modes come first; when automatic control cannot run, the safe state applies.
 */
describe("scheduler and automatic control", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let database: DatabaseModule;
  let scheduler: Scheduler;
  let writeValues: ReturnType<typeof vi.fn>;
  let override: Record<string, unknown> | null = null;
  let runner: {
    tick: ReturnType<typeof vi.fn>;
    deactivate: ReturnType<typeof vi.fn>;
    getReason: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    database = temp.database as DatabaseModule;
    db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       VALUES ('spring', ?, '01-01', '12-31', 1, 0)`,
    ).run(UNIT);
    db.prepare(
      `INSERT INTO app_settings (key, value) VALUES ('timeline.seasons_enabled', 'true')`,
    ).run();
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('hru.settings', ?)`).run(
      JSON.stringify({ unit: UNIT, host: "x", port: 502, unitId: 1 }),
    );
    db.prepare(
      `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id) VALUES (1, 'Útlum', '#000', 0, ?)`,
    ).run(UNIT);
    db.prepare(
      `INSERT INTO timeline_mode_values (mode_id, timeline_id, power) VALUES (1, ?, 30)`,
    ).run(database.getActiveSeasonId(UNIT));

    const { TimelineScheduler } = await import("../../../src/services/timelineScheduler.js");
    writeValues = vi.fn(async () => undefined);
    runner = {
      tick: vi.fn(async () => null),
      deactivate: vi.fn(),
      getReason: vi.fn(() => null),
    };
    scheduler = new TimelineScheduler(
      { getSnapshot: async () => [], setValue: vi.fn() } as never,
      {
        getAllUnits: () => [UNIT_DEFINITION],
        getUnitById: () => UNIT_DEFINITION,
        writeValues,
        validateWriteValues: () => undefined,
      } as never,
      { getTimelineOverride: () => override, setTimelineOverride: vi.fn() } as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      null,
      runner as never,
    );
  });

  afterEach(() => {
    override = null;
    cleanup();
  });

  function addEvent(mode: string | number) {
    db.prepare(
      `INSERT INTO timeline_events (start_time, day_of_week, hru_config, enabled, priority, hru_id, timeline_id)
       VALUES ('00:00', NULL, ?, 1, 0, ?, ?)`,
    ).run(JSON.stringify({ mode }), UNIT, database.getActiveSeasonId(UNIT));
  }

  it("runs automatic control when the schedule is empty", async () => {
    await scheduler.executeScheduledEventOrThrow();
    expect(runner.tick).toHaveBeenCalledTimes(1);
    expect(scheduler.getActiveState()).toEqual({ source: "automatic", modeName: undefined });
    expect(scheduler.getFormattedActiveMode()).toBe("Automatic");
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('ui.language', 'cs')`).run();
    expect(scheduler.getFormattedActiveMode()).toBe("Automatika");
    expect(writeValues).not.toHaveBeenCalled();
  });

  it("runs automatic control for an Automatika event", async () => {
    addEvent("@automatic");
    await scheduler.executeScheduledEventOrThrow();
    expect(runner.tick).toHaveBeenCalledTimes(1);
  });

  it("stops automatic control while a plan mode applies", async () => {
    addEvent(1);
    await scheduler.executeScheduledEventOrThrow();
    expect(runner.tick).not.toHaveBeenCalled();
    expect(runner.deactivate).toHaveBeenCalledWith("schedule");
    expect(writeValues).toHaveBeenCalled();
  });

  it("applies the safe state once while automatic control cannot run", async () => {
    runner.tick.mockResolvedValue("noRooms");
    runner.getReason.mockReturnValue("noRooms");
    await scheduler.executeScheduledEventOrThrow();
    await scheduler.executeScheduledEventOrThrow();
    expect(writeValues).toHaveBeenCalledTimes(1);
    expect(writeValues).toHaveBeenCalledWith(expect.objectContaining({ power: 0 }));
    expect(scheduler.getActiveState()?.source).toBe("fallback");
    expect(scheduler.getAutomaticReason()).toBe("noRooms");
  });

  it("writes the safe state again after automatic control ran in between", async () => {
    runner.tick.mockResolvedValueOnce("noReadings");
    await scheduler.executeScheduledEventOrThrow();
    runner.tick.mockResolvedValueOnce(null);
    await scheduler.executeScheduledEventOrThrow();
    runner.tick.mockResolvedValueOnce("noReadings");
    await scheduler.executeScheduledEventOrThrow();
    expect(writeValues).toHaveBeenCalledTimes(2);
  });

  it("hands over to a boost at once and takes back when it ends", async () => {
    await scheduler.executeScheduledEventOrThrow();
    override = {
      modeId: 1,
      endTime: new Date(Date.now() + 30 * 60_000).toISOString(),
      durationMinutes: 30,
      customConfig: { power: 80, variables: { power: 80 } },
    };
    // The boost route ticks the scheduler itself; no wait for the 10 s loop.
    await scheduler.executeScheduledEventOrThrow();
    expect(runner.deactivate).toHaveBeenCalledWith("boost");
    expect(writeValues).toHaveBeenCalledWith(expect.objectContaining({ power: 80 }));

    override = null;
    runner.tick.mockClear();
    await scheduler.executeScheduledEventOrThrow();
    expect(runner.tick).toHaveBeenCalledTimes(1);
  });

  it("runs automatic control for an Automatika event of a running custom timeline", async () => {
    addEvent(1);
    db.prepare(
      `INSERT INTO custom_timelines (id, hru_id, name, name_key) VALUES (3, ?, 'Dovolená', 'dovolená')`,
    ).run(UNIT);
    db.prepare(
      `INSERT INTO custom_timeline_events (custom_timeline_id, mode_id, start_time) VALUES (3, NULL, '00:00')`,
    ).run();
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('timeline.custom_override', ?)`).run(
      JSON.stringify({
        customTimelineId: 3,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: null,
        activatedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );
    await scheduler.executeScheduledEventOrThrow();
    // The season's plan mode would apply without the override; the override's Automatika wins.
    expect(runner.tick).toHaveBeenCalledTimes(1);
    expect(scheduler.isCustomOverrideDegraded()).toBe(false);
  });
});
