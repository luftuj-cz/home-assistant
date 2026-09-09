import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type SeasonsModule = typeof import("../../../src/services/db/seasons.js");
type FeatureModule = typeof import("../../../src/services/db/seasonsFeature.js");
type TimelineModule = typeof import("../../../src/services/db/timeline.js");

const UNIT = "atrea-am";

/**
 * Regressions found by the 1.1.0 release review: each describe block is one
 * finding, phrased as the upgrade scenario that used to break.
 */
describe("1.1.0 release gate regressions", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let seasons: SeasonsModule;
  let feature: FeatureModule;
  let timeline: TimelineModule;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    seasons = await import("../../../src/services/db/seasons.js");
    feature = await import("../../../src/services/db/seasonsFeature.js");
    timeline = await import("../../../src/services/db/timeline.js");
  });

  afterEach(() => {
    cleanup();
  });

  function insertLegacyMode(id: number, name: string, columns: Record<string, string | number>) {
    const keys = Object.keys(columns);
    db.prepare(
      `INSERT INTO timeline_modes (id, name, is_boost, hru_id${keys.map((k) => `, ${k}`).join("")})
       VALUES (?, ?, 1, ?${keys.map(() => ", ?").join("")})`,
    ).run(id, name, UNIT, ...Object.values(columns));
  }

  describe("boost-only install: modes but no events, so migration 013 created no season", () => {
    beforeEach(() => {
      // As 1.0.9 stored them: legacy columns only, no per-season values.
      insertLegacyMode(1, "Komfort", { power: 60 });
      insertLegacyMode(2, "Noc", { variables: '{"power":20}' });
      expect((db.prepare(`SELECT COUNT(*) AS n FROM timelines`).get() as { n: number }).n).toBe(0);
    });

    it("keeps every existing mode configured after the first write creates a season", () => {
      const seasonId = seasons.ensureActiveSeasonId(UNIT)!;
      expect(seasonId).toBeDefined();

      const modes = timeline.getTimelineModes(UNIT, seasonId);
      expect(modes.map((m) => [m.name, m.configured])).toEqual([
        ["Komfort", true],
        ["Noc", true],
      ]);
      expect(modes.find((m) => m.name === "Komfort")?.power).toBe(60);
      expect(modes.find((m) => m.name === "Noc")?.variables).toEqual({ power: 20 });
    });

    it("does the same when disabled placeholders from a Settings visit are enabled", () => {
      seasons.ensureSeasons(UNIT);
      const seasonId = seasons.ensureActiveSeasonId(UNIT)!;

      for (const mode of timeline.getTimelineModes(UNIT, seasonId)) {
        expect(mode.configured, mode.name).toBe(true);
      }
    });

    it("does not overwrite values a mode already has in that season", () => {
      seasons.ensureSeasons(UNIT);
      const spring = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "spring")!;
      db.prepare(
        `INSERT INTO timeline_mode_values (mode_id, timeline_id, power) VALUES (1, ?, 45)`,
      ).run(spring.id);

      const seasonId = seasons.ensureActiveSeasonId(UNIT)!;
      expect(seasonId).toBe(spring.id);
      expect(timeline.getTimelineModes(UNIT, seasonId).find((m) => m.id === 1)?.power).toBe(45);
    });
  });

  describe("valve-only modes", () => {
    it("count as configured, so they stay saveable and boostable after the update", () => {
      insertLegacyMode(1, "Jen ventily", { luftator_config: '{"number.luftator_kuchyne":80}' });
      const seasonId = seasons.ensureActiveSeasonId(UNIT)!;

      const mode = timeline.getTimelineModes(UNIT, seasonId).find((m) => m.id === 1)!;
      expect(mode.configured).toBe(true);

      // Re-saving it for the season is accepted rather than rejected as empty.
      expect(() =>
        timeline.upsertTimelineMode(
          { id: 1, name: "Jen ventily", luftatorConfig: { "number.luftator_kuchyne": 80 } },
          seasonId,
        ),
      ).not.toThrow();
    });

    it("still rejects a mode with nothing at all to do", () => {
      const seasonId = seasons.ensureActiveSeasonId(UNIT)!;
      expect(() => timeline.upsertTimelineMode({ id: 0, name: "Nic" }, seasonId)).toThrow(
        timeline.ModeValuesEmptyError,
      );
    });
  });

  describe("turning the feature off and on again", () => {
    beforeEach(() => {
      insertLegacyMode(1, "Komfort", { power: 60 });
      timeline.upsertTimelineEvent({
        startTime: "06:00",
        dayOfWeek: 1,
        hruConfig: { mode: 1 },
        enabled: true,
        priority: 0,
        hruId: UNIT,
        timelineId: null,
      });
      feature.enableSeasonsFeature(UNIT, true);
    });

    it("restores the boundaries the user had moved and the seasons they had switched off", () => {
      seasons.updateSeason(UNIT, "spring", { spanStart: "02-15" });
      seasons.updateSeason(UNIT, "winter", { enabled: false });
      const before = seasons.getSeasons(UNIT).map((s) => [s.seasonKey, s.spanStart, s.enabled]);

      feature.disableSeasonsFeature(UNIT, "summer");
      expect(seasons.getEnabledSeasons(UNIT).map((s) => s.seasonKey)).toEqual(["summer"]);

      feature.enableSeasonsFeature(UNIT, true);
      const after = seasons.getSeasons(UNIT).map((s) => [s.seasonKey, s.spanStart, s.enabled]);
      expect(after).toEqual(before);
    });

    it("keeps the season the user chose as the whole-year one while the feature is off", () => {
      feature.disableSeasonsFeature(UNIT, "autumn");
      const autumn = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "autumn")!;

      // Legacy columns mirror the sole enabled season, whichever key it has.
      timeline.upsertTimelineMode({ id: 1, name: "Komfort", power: 35 }, autumn.id);
      const legacy = db.prepare(`SELECT power FROM timeline_modes WHERE id = 1`).get() as {
        power: number;
      };
      expect(legacy.power).toBe(35);
    });

    it("seeds the defaults on a first enable with nothing parked", () => {
      expect(seasons.getSeasons(UNIT).map((s) => [s.seasonKey, s.spanStart, s.enabled])).toEqual([
        ["spring", "03-01", true],
        ["summer", "06-01", true],
        ["autumn", "09-01", true],
        ["winter", "12-01", true],
      ]);
    });
  });

  describe("adopting a unit-less season into the unit", () => {
    it("carries its mode values over instead of deleting them", () => {
      db.prepare(
        `INSERT INTO timeline_modes (id, name, is_boost, hru_id) VALUES (1, 'Komfort', 0, NULL)`,
      ).run();
      const unitless = seasons.ensureActiveSeasonId(null)!;
      db.prepare(
        `INSERT OR REPLACE INTO timeline_mode_values (mode_id, timeline_id, power)
         VALUES (1, ?, 77)`,
      ).run(unitless);
      // The unit already owns an (empty) season, so the rows are repointed.
      const own = seasons.ensureActiveSeasonId(UNIT)!;
      db.prepare(`DELETE FROM timeline_mode_values WHERE timeline_id = ?`).run(own);

      timeline.assignLegacyEventsToUnit(UNIT);

      expect(timeline.getTimelineModes(UNIT, own).find((m) => m.id === 1)?.power).toBe(77);
      expect(
        (
          db.prepare(`SELECT COUNT(*) AS n FROM timelines WHERE hru_id IS NULL`).get() as {
            n: number;
          }
        ).n,
      ).toBe(0);
    });
  });

  describe("updating an event without naming a season", () => {
    let summerId: number;
    let winterId: number;
    let eventId: number;
    let resolve: typeof import("../../../src/services/timeline/eventSeason.js").resolveEventWriteSeasonId;

    beforeEach(async () => {
      insertLegacyMode(1, "Komfort", { power: 60 });
      feature.enableSeasonsFeature(UNIT, false);
      summerId = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "summer")!.id;
      winterId = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "winter")!.id;
      eventId = timeline.upsertTimelineEvent({
        startTime: "06:00",
        dayOfWeek: 1,
        hruConfig: { mode: 1 },
        enabled: true,
        priority: 0,
        hruId: UNIT,
        timelineId: summerId,
      }).id!;
      resolve = (await import("../../../src/services/timeline/eventSeason.js"))
        .resolveEventWriteSeasonId;
    });

    it("keeps the event in the season it already belongs to", () => {
      // Whatever season is active today, the summer event stays summer's.
      expect(resolve(undefined, eventId, UNIT)).toBe(summerId);
      expect(resolve("", eventId, UNIT)).toBe(summerId);
    });

    it("moves it when the request names a season explicitly", () => {
      expect(resolve(String(winterId), eventId, UNIT)).toBe(winterId);
    });

    it("sends a new event to the active season", () => {
      expect(resolve(undefined, undefined, UNIT)).toBe(seasons.getActiveSeasonId(UNIT));
    });

    it("falls back to the active season for an event that predates seasons", () => {
      db.prepare(`UPDATE timeline_events SET timeline_id = NULL WHERE id = ?`).run(eventId);
      expect(resolve(undefined, eventId, UNIT)).toBe(seasons.getActiveSeasonId(UNIT));
    });
  });
});
