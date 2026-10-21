import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempDatabase } from "../helpers/testDb.js";
import { serveRouters, silentLogger, type ServedRouter } from "../helpers/httpRouter.js";

type DatabaseModule = typeof import("../../src/services/database.js");
type StoreModule = typeof import("../../src/services/db/customTimelines.js");

const UNIT = "atrea-am";
const UTLUM = 1;
const KOMFORT = 2;

/**
 * Existing mode and season operations that a custom timeline can now be broken
 * by, and season renaming.
 */
describe("season and mode routes with custom timelines", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let database: DatabaseModule;
  let store: StoreModule;
  let api: ServedRouter;
  let springId: number;
  let timelineId: number;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    database = temp.database as DatabaseModule;
    store = await import("../../src/services/db/customTimelines.js");

    database.setAppSetting("hru.settings", JSON.stringify({ unit: UNIT }));
    database.setAppSetting("ui.language", "en");
    db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       VALUES ('spring', ?, '01-01', '12-31', 1, 0)`,
    ).run(UNIT);
    springId = database.getActiveSeasonId(UNIT)!;
    for (const [id, name] of [
      [UTLUM, "Útlum"],
      [KOMFORT, "Komfort"],
    ] as const) {
      db.prepare(
        `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id) VALUES (?, ?, '#1971c2', 0, ?)`,
      ).run(id, name, UNIT);
      db.prepare(
        `INSERT INTO timeline_mode_values (mode_id, timeline_id, power) VALUES (?, ?, 30)`,
      ).run(id, springId);
    }

    timelineId = store.createCustomTimeline(UNIT, "Dovolená").id;
    store.upsertCustomTimelineEvent({
      customTimelineId: timelineId,
      modeId: UTLUM,
      dayOfWeek: null,
      startTime: "00:00",
      enabled: true,
      priority: 0,
    });

    const scheduler = {
      executeScheduledEvent: vi.fn(async () => undefined),
      executeScheduledEventOrThrow: vi.fn(async () => undefined),
      restart: vi.fn(),
      isCustomOverrideDegraded: () => false,
    };
    const mqtt = {
      refreshDiscovery: vi.fn(async () => undefined),
      publishCustomOverrideState: vi.fn(async () => undefined),
    };
    const hruService = { getAllUnits: () => [{ id: UNIT }] };
    const { createTimelineRouter } = await import("../../src/routes/timeline.js");
    const { createSeasonsRouter } = await import("../../src/routes/seasons.js");
    api = await serveRouters({
      "/api/timeline": createTimelineRouter(
        silentLogger() as never,
        scheduler as never,
        hruService as never,
        mqtt as never,
      ),
      "/api/seasons": createSeasonsRouter(
        silentLogger() as never,
        hruService as never,
        scheduler as never,
      ),
    });
  });

  afterEach(async () => {
    await api.close();
    cleanup();
  });

  function seasonRow(key: string) {
    return db
      .prepare(`SELECT id, enabled, name FROM timelines WHERE season_key = ? AND hru_id = ?`)
      .get(key, UNIT) as { id: number; enabled: number; name: string | null } | undefined;
  }

  function customEventCount(): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM custom_timeline_events`).get() as { n: number })
      .n;
  }

  function modeValues(modeId: number, timelineId: number) {
    return db
      .prepare(`SELECT power FROM timeline_mode_values WHERE mode_id = ? AND timeline_id = ?`)
      .get(modeId, timelineId) as { power: number } | undefined;
  }

  describe("mode values and deletion", () => {
    it("refuses to remove values a custom timeline relies on from an enabled season", async () => {
      const result = await api.call(
        "DELETE",
        `/api/timeline/modes/${UTLUM}/values?seasonId=${springId}`,
      );

      expect(result.status).toBe(409);
      expect(result.body!.code).toBe("MODE_VALUES_IN_USE_BY_CUSTOM_TIMELINE");
      expect(result.body!.details).toMatchObject({ customTimelines: [{ name: "Dovolená" }] });
    });

    it("still removes values of a mode no custom timeline uses", async () => {
      const result = await api.call(
        "DELETE",
        `/api/timeline/modes/${KOMFORT}/values?seasonId=${springId}`,
      );

      expect(result.status).toBe(204);
    });

    it("lists custom timelines in the mode usage report", async () => {
      const result = await api.call("GET", `/api/timeline/modes/${UTLUM}/usage`);

      expect(result.body!.customTimelines).toEqual([
        {
          customTimelineId: timelineId,
          name: "Dovolená",
          enabledEvents: 1,
          wouldBeLeftEmpty: true,
          isOverriding: false,
        },
      ]);
    });

    it("ends the override when deleting the mode empties its timeline", async () => {
      const { writeCustomOverride, readCustomOverride } =
        await import("../../src/services/timeline/customOverride.js");
      const now = new Date().toISOString();
      writeCustomOverride({
        customTimelineId: timelineId,
        startsAt: now,
        endsAt: null,
        activatedAt: now,
      });

      const result = await api.call("DELETE", `/api/timeline/modes/${UTLUM}`);

      expect(result.status).toBe(204);
      expect(customEventCount()).toBe(0);
      expect(readCustomOverride()).toBeNull();
    });
  });

  describe("enabling seasons", () => {
    beforeEach(() => {
      database.setAppSetting("timeline.seasons_enabled", "true");
      for (const [key, start] of [
        ["summer", "06-21"],
        ["autumn", "09-22"],
        ["winter", "12-21"],
      ] as const) {
        db.prepare(
          `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
           VALUES (?, ?, ?, ?, 0, 0)`,
        ).run(key, UNIT, start, start);
      }
      db.prepare(`UPDATE timelines SET span_start = '03-20' WHERE id = ?`).run(springId);
    });

    it("copies the values a custom timeline uses from the active season when enabling", async () => {
      const result = await api.call("PATCH", "/api/seasons/summer", { enabled: true });

      expect(result.status).toBe(200);
      expect(seasonRow("summer")!.enabled).toBe(1);
      // Only what custom timelines need travels: the season stays otherwise empty.
      expect(modeValues(UTLUM, seasonRow("summer")!.id)).toEqual({ power: 30 });
      expect(modeValues(KOMFORT, seasonRow("summer")!.id)).toBeUndefined();
    });

    it("leaves no copied values behind when the season change itself is rejected", async () => {
      // The same start as spring: valid on its own, refused as a partition.
      const result = await api.call("PATCH", "/api/seasons/summer", {
        enabled: true,
        spanStart: "03-20",
      });

      expect(result.status).toBe(409);
      expect(result.body!.code).toBe("INVALID_SEASON_PARTITION");
      expect(seasonRow("summer")!.enabled).toBe(0);
      expect(modeValues(UTLUM, seasonRow("summer")!.id)).toBeUndefined();
    });

    it("refuses to enable a season when no enabled season has the mode either", async () => {
      db.prepare(`DELETE FROM timeline_mode_values WHERE mode_id = ? AND timeline_id = ?`).run(
        UTLUM,
        springId,
      );

      const result = await api.call("PATCH", "/api/seasons/summer", { enabled: true });

      expect(result.status).toBe(409);
      expect(result.body!.code).toBe("MODE_NOT_CONFIGURED_FOR_CUSTOM_TIMELINES");
      expect(result.body!.details).toMatchObject({
        missing: [{ modeId: UTLUM, seasons: [{ seasonKey: "summer" }] }],
        usedBy: [{ modeId: UTLUM, customTimelines: ["Dovolená"] }],
      });
      expect(seasonRow("summer")!.enabled).toBe(0);
    });

    it("enables it once the mode has values there", async () => {
      db.prepare(
        `INSERT INTO timeline_mode_values (mode_id, timeline_id, power) VALUES (?, ?, 20)`,
      ).run(UTLUM, seasonRow("summer")!.id);

      const result = await api.call("PATCH", "/api/seasons/summer", { enabled: true });

      expect(result.status).toBe(200);
      expect(seasonRow("summer")!.enabled).toBe(1);
    });
  });

  describe("disabling the seasons feature", () => {
    beforeEach(() => {
      database.setAppSetting("timeline.seasons_enabled", "true");
      db.prepare(
        `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
         VALUES ('summer', ?, '06-21', '12-31', 0, 0)`,
      ).run(UNIT);
    });

    it("copies the values a custom timeline uses into a kept season that lacks them", async () => {
      const result = await api.call("POST", "/api/seasons/disable", { keepSeasonKey: "summer" });

      expect(result.status).toBe(200);
      expect(database.getAppSetting("timeline.seasons_enabled")).toBe("false");
      expect(seasonRow("summer")!.enabled).toBe(1);
      expect(seasonRow("spring")!.enabled).toBe(0);
      expect(modeValues(UTLUM, seasonRow("summer")!.id)).toEqual({ power: 30 });
      // Only what custom timelines need travels.
      expect(modeValues(KOMFORT, seasonRow("summer")!.id)).toBeUndefined();
    });

    it("rolls the disable back when no season can supply a used mode", async () => {
      db.prepare(`DELETE FROM timeline_mode_values WHERE mode_id = ? AND timeline_id = ?`).run(
        UTLUM,
        springId,
      );

      const result = await api.call("POST", "/api/seasons/disable", { keepSeasonKey: "summer" });

      expect(result.status).toBe(409);
      expect(result.body!.code).toBe("MODE_NOT_CONFIGURED_FOR_CUSTOM_TIMELINES");
      expect(result.body!.details).toMatchObject({
        missing: [{ modeId: UTLUM, seasons: [{ seasonKey: "summer" }] }],
      });
      expect(database.getAppSetting("timeline.seasons_enabled")).toBe("true");
      expect(seasonRow("spring")!.enabled).toBe(1);
      expect(seasonRow("summer")!.enabled).toBe(0);
    });

    it("keeps a season that has the values", async () => {
      const result = await api.call("POST", "/api/seasons/disable", { keepSeasonKey: "spring" });

      expect(result.status).toBe(200);
      expect(database.getAppSetting("timeline.seasons_enabled")).toBe("false");
      expect(seasonRow("spring")!.enabled).toBe(1);
    });
  });

  describe("enabling the seasons feature", () => {
    it("rolls back an enable without copying that would leave a used mode missing", async () => {
      const result = await api.call("POST", "/api/seasons/enable", { cloneCurrent: false });

      expect(result.status).toBe(409);
      expect(result.body!.code).toBe("MODE_NOT_CONFIGURED_FOR_CUSTOM_TIMELINES");
      expect(database.getAppSetting("timeline.seasons_enabled")).not.toBe("true");
      expect(database.getEnabledSeasons(UNIT)).toHaveLength(1);
    });

    it("allows the enable with copying, which gives every new season the values", async () => {
      const result = await api.call("POST", "/api/seasons/enable", { cloneCurrent: true });

      expect(result.status).toBe(200);
      expect(database.getEnabledSeasons(UNIT)).toHaveLength(4);
    });
  });

  describe("season names", () => {
    beforeEach(() => {
      database.setAppSetting("timeline.seasons_enabled", "true");
    });

    it("renames a season and exposes the display name", async () => {
      const rename = await api.call("PATCH", "/api/seasons/spring", { name: "Topná sezóna" });
      const list = await api.call("GET", "/api/seasons");

      expect(rename.status).toBe(200);
      expect(seasonRow("spring")!.name).toBe("Topná sezóna");
      const spring = (list.body!.seasons as { seasonKey: string; displayName: string }[]).find(
        (season) => season.seasonKey === "spring",
      );
      expect(spring?.displayName).toBe("Topná sezóna");
    });

    it("restores the translated name", async () => {
      await api.call("PATCH", "/api/seasons/spring", { name: "Topná sezóna" });

      await api.call("PATCH", "/api/seasons/spring", { name: null });
      const list = await api.call("GET", "/api/seasons");

      expect(seasonRow("spring")!.name).toBeNull();
      const spring = (list.body!.seasons as { seasonKey: string; displayName: string }[]).find(
        (season) => season.seasonKey === "spring",
      );
      expect(spring?.displayName).toBe("Spring");
    });

    it("refuses a name another season shows", async () => {
      const result = await api.call("PATCH", "/api/seasons/spring", { name: "winter" });

      expect(result.status).toBe(409);
      expect(result.body!.code).toBe("PLAN_NAME_TAKEN");
    });

    it("refuses a custom timeline's name", async () => {
      const result = await api.call("PATCH", "/api/seasons/spring", { name: "dovolená" });

      expect(result.status).toBe(409);
      expect(result.body!.details).toMatchObject({ conflict: { kind: "custom" } });
    });
  });
});
