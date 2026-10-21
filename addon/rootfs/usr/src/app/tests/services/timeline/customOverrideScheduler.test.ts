import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type DatabaseModule = typeof import("../../../src/services/database.js");
type OverrideModule = typeof import("../../../src/services/timeline/customOverride.js");
type SchedulerModule = typeof import("../../../src/services/timelineScheduler.js");
type Scheduler = InstanceType<SchedulerModule["TimelineScheduler"]>;

interface Payload {
  source: string;
  friendlyModeName?: string;
  customTimelineName?: string;
  activationToken?: string;
  hruConfig?: { power?: number } | null;
}

const UNIT = "atrea-am";
const UTLUM = 1;
const KOMFORT = 2;
const UNIT_DEFINITION = {
  id: UNIT,
  variables: [{ name: "power", type: "number", editable: true, min: 0, max: 100 }],
};

/** 15 January 2026, a Thursday - winter. */
const WINTER_MORNING = new Date(2026, 0, 15, 10, 0);
const WINTER_EVENING = new Date(2026, 0, 15, 21, 0);
/** 15 July 2026 - summer. */
const SUMMER_MORNING = new Date(2026, 6, 15, 10, 0);

describe("custom override in the scheduler", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let database: DatabaseModule;
  let overrides: OverrideModule;
  let scheduler: Scheduler;
  let errors: string[];
  let winterId: number;
  let summerId: number;
  let timelineId: number;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WINTER_MORNING);

    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    database = temp.database as DatabaseModule;
    overrides = await import("../../../src/services/timeline/customOverride.js");

    database.setAppSetting("hru.settings", JSON.stringify({ unit: UNIT }));
    database.setAppSetting("timeline.seasons_enabled", "true");
    summerId = insertSeason("summer", "06-21");
    winterId = insertSeason("winter", "12-21");

    for (const [id, name] of [
      [UTLUM, "Útlum"],
      [KOMFORT, "Komfort"],
    ] as const) {
      db.prepare(
        `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id) VALUES (?, ?, '#1971c2', 0, ?)`,
      ).run(id, name, UNIT);
    }
    setPower(UTLUM, winterId, 15);
    setPower(UTLUM, summerId, 25);
    setPower(KOMFORT, winterId, 40);
    setPower(KOMFORT, summerId, 60);

    // The season schedule the override replaces: Komfort from 06:00.
    for (const seasonId of [winterId, summerId]) {
      db.prepare(
        `INSERT INTO timeline_events (start_time, day_of_week, hru_config, enabled, priority, hru_id, timeline_id)
         VALUES ('06:00', NULL, ?, 1, 0, ?, ?)`,
      ).run(JSON.stringify({ mode: String(KOMFORT) }), UNIT, seasonId);
    }

    const store = await import("../../../src/services/db/customTimelines.js");
    timelineId = store.createCustomTimeline(UNIT, "Dovolená").id;
    for (const [modeId, startTime] of [
      [UTLUM, "00:00"],
      [KOMFORT, "20:00"],
    ] as const) {
      store.upsertCustomTimelineEvent({
        customTimelineId: timelineId,
        modeId,
        dayOfWeek: null,
        startTime,
        enabled: true,
        priority: 0,
      });
    }

    errors = [];
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: (_context: unknown, message?: string) => errors.push(message ?? ""),
    };
    const { SettingsRepository } =
      await import("../../../src/features/settings/settings.repository.js");
    const { TimelineScheduler } = await import("../../../src/services/timelineScheduler.js");
    scheduler = new TimelineScheduler(
      { getSnapshot: async () => [] } as never,
      { getAllUnits: () => [UNIT_DEFINITION], writeValues: vi.fn(async () => undefined) } as never,
      new SettingsRepository(logger as never),
      logger as never,
      { callService: vi.fn(async () => undefined) } as never,
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function insertSeason(key: string, spanStart: string): number {
    const result = db
      .prepare(
        `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
         VALUES (?, ?, ?, ?, 1, 0)`,
      )
      .run(key, UNIT, spanStart, spanStart);
    return Number(result.lastInsertRowid);
  }

  function setPower(modeId: number, seasonId: number, power: number) {
    db.prepare(
      `INSERT INTO timeline_mode_values (mode_id, timeline_id, power) VALUES (?, ?, ?)`,
    ).run(modeId, seasonId, power);
  }

  function activate(options: { startsAt?: Date; endsAt?: Date | null } = {}) {
    const now = new Date();
    overrides.writeCustomOverride({
      customTimelineId: timelineId,
      startsAt: (options.startsAt ?? now).toISOString(),
      endsAt: options.endsAt ? options.endsAt.toISOString() : null,
      activatedAt: now.toISOString(),
    });
  }

  function resolve(): Promise<Payload | null> {
    return (
      scheduler as unknown as { resolveActiveEvent: () => Promise<Payload | null> }
    ).resolveActiveEvent();
  }

  it("applies the override's event with the active season's values", async () => {
    activate();

    const payload = await resolve();

    expect(payload).toMatchObject({
      source: "custom",
      friendlyModeName: "Útlum",
      customTimelineName: "Dovolená",
      hruConfig: { power: 15 },
    });
  });

  it("borrows the other season's values when the date moves into it", async () => {
    activate({ endsAt: null });
    vi.setSystemTime(SUMMER_MORNING);

    expect(await resolve()).toMatchObject({ source: "custom", hruConfig: { power: 25 } });
  });

  it("picks up edited mode values on the next tick", async () => {
    activate();
    db.prepare(
      `UPDATE timeline_mode_values SET power = 18 WHERE mode_id = ? AND timeline_id = ?`,
    ).run(UTLUM, winterId);

    expect(await resolve()).toMatchObject({ hruConfig: { power: 18 } });
  });

  it("lets a boost run on top and hands back to the override, not the season", async () => {
    activate();
    const { buildBoostOverride } = await import("../../../src/services/timeline/boostOverride.js");
    const komfort = database.getTimelineModes(UNIT, winterId).find((mode) => mode.id === KOMFORT)!;
    database.setAppSetting(
      "timeline.override",
      JSON.stringify(
        buildBoostOverride(komfort, 30, new Date(Date.now() + 1_800_000).toISOString()),
      ),
    );

    expect((await resolve())?.source).toBe("boost");

    database.setAppSetting("timeline.override", "null");
    expect((await resolve())?.source).toBe("custom");
  });

  it("has no effect before a scheduled start", async () => {
    activate({ startsAt: new Date(Date.now() + 3_600_000) });

    expect(await resolve()).toMatchObject({ source: "schedule", friendlyModeName: "Komfort" });
    expect(overrides.readCustomOverride()).not.toBeNull();
  });

  it("clears an expired override on the tick and runs the season schedule", async () => {
    activate({
      startsAt: new Date(Date.now() - 7_200_000),
      endsAt: new Date(Date.now() - 60_000),
    });

    expect((await resolve())?.source).toBe("schedule");
    expect(overrides.readCustomOverride()).toBeNull();
  });

  it("keeps running without an end", async () => {
    activate({ endsAt: null });
    vi.setSystemTime(new Date(2026, 5, 1, 10, 0));

    expect((await resolve())?.source).toBe("custom");
  });

  it("skips, but keeps, an override of another unit", async () => {
    activate();
    database.setAppSetting("hru.settings", JSON.stringify({ unit: "other-unit" }));

    expect((await resolve())?.source).not.toBe("custom");
    expect(overrides.readCustomOverride()).not.toBeNull();

    database.setAppSetting("hru.settings", JSON.stringify({ unit: UNIT }));
    expect((await resolve())?.source).toBe("custom");
  });

  it("falls back to the season schedule, loudly and once, when its mode has no values", async () => {
    activate();
    db.prepare(`DELETE FROM timeline_mode_values WHERE mode_id = ? AND timeline_id = ?`).run(
      UTLUM,
      winterId,
    );

    const first = await resolve();
    const second = await resolve();

    expect(first?.source).toBe("schedule");
    expect(second?.source).toBe("schedule");
    expect(scheduler.isCustomOverrideDegraded()).toBe(true);
    expect(
      errors.filter((message) => message.includes("custom override resolves no")),
    ).toHaveLength(1);
  });

  it("forgets a degraded override once a scheduled one replaces it", async () => {
    activate();
    db.prepare(`DELETE FROM timeline_mode_values WHERE mode_id = ? AND timeline_id = ?`).run(
      UTLUM,
      winterId,
    );
    await resolve();
    expect(scheduler.isCustomOverrideDegraded()).toBe(true);

    // Replaced by one that starts later: nothing is degraded while it waits,
    // and when it starts and fails too, that is a new occurrence to report.
    activate({ startsAt: new Date(Date.now() + 3_600_000) });
    await resolve();
    expect(scheduler.isCustomOverrideDegraded()).toBe(false);

    vi.setSystemTime(new Date(Date.now() + 3_600_000 + 1_000));
    await resolve();
    expect(scheduler.isCustomOverrideDegraded()).toBe(true);
    expect(
      errors.filter((message) => message.includes("custom override resolves no")),
    ).toHaveLength(2);
  });

  it("does not engage the safe state while the override applies", async () => {
    db.prepare(`DELETE FROM timeline_events`).run();
    activate();

    expect((await resolve())?.source).toBe("custom");
  });

  it("issues a new script token on each event transition and on re-activation", async () => {
    activate();
    const morning = (await resolve())?.activationToken;
    vi.setSystemTime(WINTER_EVENING);
    const evening = (await resolve())?.activationToken;
    vi.setSystemTime(new Date(WINTER_EVENING.getTime() + 60_000));
    activate();
    const reactivated = (await resolve())?.activationToken;

    expect(new Set([morning, evening, reactivated]).size).toBe(3);
  });

  it("reports itself as the timeline and the mode", async () => {
    activate();

    await scheduler.executeScheduledEventOrThrow();

    expect(scheduler.getActiveState()).toMatchObject({ source: "custom", modeName: "Útlum" });
    expect(scheduler.getFormattedActiveMode()).toBe("Dovolená: Útlum");
  });

  describe("slot independence", () => {
    it("starting and cancelling a boost leaves the override alone", async () => {
      activate();
      const before = overrides.readCustomOverride();

      database.setAppSetting("timeline.override", JSON.stringify({ modeId: KOMFORT }));
      database.setAppSetting("timeline.override", "null");

      expect(overrides.readCustomOverride()).toEqual(before);
    });

    it("activating and ending an override leaves the boost alone", async () => {
      const boost = JSON.stringify({ modeId: KOMFORT, endTime: "2099-01-01T00:00:00.000Z" });
      database.setAppSetting("timeline.override", boost);
      const applier = { executeScheduledEventOrThrow: async () => undefined };
      const logger = { info: vi.fn(), error: vi.fn() };

      await overrides.activateCustomOverride(
        { customTimelineId: timelineId },
        UNIT,
        applier,
        logger as never,
      );
      await overrides.endCustomOverride(applier, logger as never);

      expect(database.getAppSetting("timeline.override")).toBe(boost);
    });
  });
});
