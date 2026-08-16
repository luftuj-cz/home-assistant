import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type DatabaseModule = typeof import("../../../src/services/database.js");
type SeasonsModule = typeof import("../../../src/services/db/seasons.js");
type FeatureModule = typeof import("../../../src/services/db/seasonsFeature.js");
type TimelineModule = typeof import("../../../src/services/db/timeline.js");
type PickerModule = typeof import("../../../src/services/timeline/eventPicker.js");

const UNIT = "atrea-am";

/**
 * Migration 013 back-fills a season only for units that already owned events,
 * so an installation created after this release starts with an empty
 * `timelines` table. Everything written before the feature is switched on has
 * to survive that switch - these tests exist because it did not.
 */
describe("content written before any season exists", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let database: DatabaseModule;
  let seasons: SeasonsModule;
  let feature: FeatureModule;
  let timeline: TimelineModule;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    database = temp.database as DatabaseModule;
    seasons = await import("../../../src/services/db/seasons.js");
    feature = await import("../../../src/services/db/seasonsFeature.js");
    timeline = await import("../../../src/services/db/timeline.js");

    // A mode as the pre-seasons code stored it: legacy columns only, no row in
    // timeline_mode_values.
    db.prepare(
      `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id, variables)
       VALUES (1, 'Komfort', '#1971c2', 0, ?, '{"power":60}')`,
    ).run(UNIT);
  });

  afterEach(() => {
    cleanup();
  });

  function addEvent(startTime: string, timelineId: number | null, hruId: string | null = UNIT) {
    timeline.upsertTimelineEvent({
      startTime,
      dayOfWeek: 1,
      hruConfig: { mode: 1 },
      enabled: true,
      priority: 0,
      hruId,
      timelineId,
    });
  }

  it("starts with no season at all", () => {
    expect((db.prepare(`SELECT COUNT(*) AS n FROM timelines`).get() as { n: number }).n).toBe(0);
    expect(database.getActiveSeasonId(UNIT)).toBeUndefined();
  });

  describe("ensureActiveSeasonId", () => {
    it("creates the whole-year spring season a write can be stored against", () => {
      const id = seasons.ensureActiveSeasonId(UNIT);
      expect(id).toBeDefined();

      const created = seasons.getSeasons(UNIT);
      expect(created).toHaveLength(1);
      expect(created[0]!.seasonKey).toBe("spring");
      expect(created[0]!.spanStart).toBe("01-01");
      expect(created[0]!.enabled).toBe(true);
    });

    it("enables spring when only disabled placeholders exist", () => {
      // What a visit to the Settings page leaves behind while the feature is off.
      seasons.ensureSeasons(UNIT);
      expect(seasons.getEnabledSeasons(UNIT)).toHaveLength(0);

      const id = seasons.ensureActiveSeasonId(UNIT);

      const spring = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "spring")!;
      expect(id).toBe(spring.id);
      expect(spring.enabled).toBe(true);
      expect(spring.spanStart).toBe("01-01");
      expect(seasons.getEnabledSeasons(UNIT)).toHaveLength(1);
    });

    it("leaves an existing partition alone", () => {
      feature.enableSeasonsFeature(UNIT, false);
      const before = seasons.getSeasons(UNIT);

      expect(seasons.ensureActiveSeasonId(UNIT)).toBe(database.getActiveSeasonId(UNIT));
      expect(seasons.getSeasons(UNIT)).toEqual(before);
    });
  });

  describe("enabling the feature", () => {
    it("adopts events that belong to no season instead of orphaning them", () => {
      addEvent("06:00", null);

      feature.enableSeasonsFeature(UNIT, true);

      const active = database.getActiveSeasonId(UNIT);
      expect(active).toBeDefined();
      expect(timeline.getTimelineEvents(UNIT, active).map((e) => e.startTime)).toContain("06:00");

      const orphans = db
        .prepare(`SELECT COUNT(*) AS n FROM timeline_events WHERE timeline_id IS NULL`)
        .get() as { n: number };
      expect(orphans.n).toBe(0);
    });

    it("keeps the schedule reachable to the scheduler", async () => {
      addEvent("06:00", null);
      feature.enableSeasonsFeature(UNIT, true);

      const picker: PickerModule = await import("../../../src/services/timeline/eventPicker.js");
      // Monday 07:00, so the 06:00 event is the one in force.
      expect(picker.pickActiveEvent(UNIT, 7 * 60, 1)?.startTime).toBe("06:00");
    });

    it("carries legacy mode values into every season rather than leaving them unconfigured", () => {
      feature.enableSeasonsFeature(UNIT, true);

      for (const season of seasons.getSeasons(UNIT)) {
        const mode = timeline.getTimelineModes(UNIT, season.id).find((m) => m.id === 1);
        expect(mode?.configured, `mode should be configured in ${season.seasonKey}`).toBe(true);
        expect(mode?.variables).toEqual({ power: 60 });
      }
    });

    it("folds unit-less events in as well, matching migration 013", () => {
      addEvent("07:30", null, null);

      feature.enableSeasonsFeature(UNIT, false);

      const orphans = db
        .prepare(`SELECT COUNT(*) AS n FROM timeline_events WHERE timeline_id IS NULL`)
        .get() as { n: number };
      expect(orphans.n).toBe(0);
    });
  });

  describe("the write path", () => {
    it("stores an event against a season from the very first save", () => {
      const seasonId = seasons.ensureActiveSeasonId(UNIT);
      addEvent("06:00", seasonId ?? null);

      const stored = db.prepare(`SELECT timeline_id FROM timeline_events`).all() as {
        timeline_id: number | null;
      }[];
      expect(stored.every((row) => row.timeline_id !== null)).toBe(true);

      // And enabling the feature afterwards changes nothing about what runs.
      feature.enableSeasonsFeature(UNIT, true);
      const active = database.getActiveSeasonId(UNIT);
      expect(timeline.getTimelineEvents(UNIT, active).map((e) => e.startTime)).toContain("06:00");
    });
  });
});
