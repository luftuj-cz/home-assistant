import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";
import type { TimelineOverride } from "../../../src/types/index.js";

type SchedulerModule = typeof import("../../../src/services/timelineScheduler.js");
type Scheduler = InstanceType<SchedulerModule["TimelineScheduler"]>;

/** The private resolution step under test, reached without starting timers. */
type BoostResolver = {
  resolveBoostPayload: (
    override: NonNullable<TimelineOverride>,
    unitId: string | undefined,
  ) => { hruConfig?: Record<string, unknown>; scriptEntityIds?: string[] } | undefined;
};

const UNIT = "atrea-am";

/**
 * A boost freezes the values of the season it started in (D6). The season can
 * change under a running boost, and the mode may have no values in the new one
 * - that must not end the boost early, because the snapshot is exactly what
 * makes the crossing survivable.
 */
describe("boost across a season boundary", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let scheduler: Scheduler;
  let setTimelineOverride: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;

    // One whole-year season, and a mode with no values in it: the state a boost
    // finds after crossing into a season it was not configured for.
    db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       VALUES ('spring', ?, '01-01', '12-31', 1, 0)`,
    ).run(UNIT);
    db.prepare(
      `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id)
       VALUES (1, 'Vetrani', '#fd7e14', 1, ?)`,
    ).run(UNIT);

    const { TimelineScheduler } = await import("../../../src/services/timelineScheduler.js");
    setTimelineOverride = vi.fn();
    scheduler = new TimelineScheduler(
      {} as never,
      { getAllUnits: () => [] } as never,
      { setTimelineOverride } as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    );
  });

  afterEach(() => {
    cleanup();
  });

  function resolve(override: NonNullable<TimelineOverride>) {
    return (scheduler as unknown as BoostResolver).resolveBoostPayload(override, UNIT);
  }

  function endTimeInThirtyMinutes() {
    return new Date(Date.now() + 30 * 60 * 1000).toISOString();
  }

  it("keeps running on the values captured when it started", () => {
    const payload = resolve({
      modeId: 1,
      endTime: endTimeInThirtyMinutes(),
      durationMinutes: 30,
      customConfig: {
        power: 80,
        temperature: 22,
        variables: { power: 80 },
        scriptEntityIds: ["script.open_window"],
      },
    } as NonNullable<TimelineOverride>);

    expect(payload).toBeDefined();
    expect(payload?.hruConfig).toMatchObject({ power: 80, temperature: 22 });
    expect(payload?.scriptEntityIds).toEqual(["script.open_window"]);
    // The boost must not be cancelled just because the new season has no values.
    expect(setTimelineOverride).not.toHaveBeenCalled();
  });

  it("still refuses a boost that has no snapshot to fall back on", () => {
    const payload = resolve({
      modeId: 1,
      endTime: endTimeInThirtyMinutes(),
      durationMinutes: 30,
    } as NonNullable<TimelineOverride>);

    expect(payload).toBeUndefined();
    expect(setTimelineOverride).toHaveBeenCalledWith(null);
  });
});
