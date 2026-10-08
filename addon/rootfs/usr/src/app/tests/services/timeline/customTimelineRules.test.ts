import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type DatabaseModule = typeof import("../../../src/services/database.js");
type RulesModule = typeof import("../../../src/services/timeline/customTimelineRules.js");
type StoreModule = typeof import("../../../src/services/db/customTimelines.js");

const UNIT = "atrea-am";
const UTLUM = 1;
const KOMFORT = 2;

describe("custom timeline rules", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let database: DatabaseModule;
  let rules: RulesModule;
  let store: StoreModule;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    database = temp.database as DatabaseModule;
    rules = await import("../../../src/services/timeline/customTimelineRules.js");
    store = await import("../../../src/services/db/customTimelines.js");

    db.prepare(
      `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id, power)
       VALUES (?, 'Útlum', '#1971c2', 0, ?, 20), (?, 'Komfort', '#1971c2', 0, ?, NULL)`,
    ).run(UTLUM, UNIT, KOMFORT, UNIT);
  });

  afterEach(() => {
    cleanup();
  });

  function addSeason(key: string, spanStart: string, enabled: boolean): number {
    const result = db
      .prepare(
        `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
         VALUES (?, ?, ?, ?, ?, 0)`,
      )
      .run(key, UNIT, spanStart, spanStart, enabled ? 1 : 0);
    return Number(result.lastInsertRowid);
  }

  function configure(modeId: number, seasonId: number) {
    db.prepare(
      `INSERT INTO timeline_mode_values (mode_id, timeline_id, power) VALUES (?, ?, 40)`,
    ).run(modeId, seasonId);
  }

  describe("modes missing in enabled seasons", () => {
    it("accepts a mode configured in the only enabled season", () => {
      const spring = addSeason("spring", "01-01", true);
      configure(UTLUM, spring);

      expect(rules.findModesMissingInEnabledSeasons(UNIT, [UTLUM])).toEqual([]);
    });

    it("names every enabled season in which the mode has no values", () => {
      const spring = addSeason("spring", "03-20", true);
      addSeason("summer", "06-21", true);
      addSeason("winter", "12-21", true);
      configure(UTLUM, spring);

      const missing = rules.findModesMissingInEnabledSeasons(UNIT, [UTLUM]);

      expect(missing).toHaveLength(1);
      expect(missing[0]!.modeName).toBe("Útlum");
      expect(missing[0]!.seasons.map((season) => season.seasonKey).sort()).toEqual([
        "summer",
        "winter",
      ]);
    });

    it("ignores a disabled season", () => {
      const spring = addSeason("spring", "01-01", true);
      addSeason("summer", "06-21", false);
      configure(UTLUM, spring);

      expect(rules.findModesMissingInEnabledSeasons(UNIT, [UTLUM])).toEqual([]);
    });

    it("checks the given seasons only, for a season about to be enabled", () => {
      const spring = addSeason("spring", "01-01", true);
      const summer = addSeason("summer", "06-21", false);
      configure(UTLUM, spring);

      const missing = rules.findModesMissingInSeasons(
        UNIT,
        [UTLUM],
        [{ id: summer, seasonKey: "summer" }],
      );

      expect(missing.map((entry) => entry.modeId)).toEqual([UTLUM]);
    });

    it("falls back to the legacy values when the unit has no season rows", () => {
      const missing = rules.findModesMissingInEnabledSeasons(UNIT, [UTLUM, KOMFORT]);

      expect(missing).toEqual([
        { modeId: KOMFORT, modeName: "Komfort", seasons: [{ id: null, seasonKey: null }] },
      ]);
    });

    it("reports a mode that does not exist for the unit", () => {
      addSeason("spring", "01-01", true);

      expect(rules.findModesMissingInEnabledSeasons(UNIT, [999])).toEqual([
        { modeId: 999, modeName: null, seasons: [] },
      ]);
    });
  });

  describe("plan name conflicts", () => {
    it("finds a season shown under the name in the current language", () => {
      addSeason("spring", "01-01", true);
      database.setAppSetting("ui.language", "cs");

      expect(rules.findPlanNameConflict(UNIT, "  jaro ")).toMatchObject({
        kind: "season",
        name: "Jaro",
      });
      expect(rules.findPlanNameConflict(UNIT, "Spring")).toBeNull();
    });

    it("uses a season's own name once it has one", () => {
      const spring = addSeason("spring", "01-01", true);
      db.prepare(`UPDATE timelines SET name = 'Topná sezóna' WHERE id = ?`).run(spring);

      expect(rules.findPlanNameConflict(UNIT, "TOPNÁ SEZÓNA")?.kind).toBe("season");
      expect(rules.findPlanNameConflict(UNIT, "Spring")).toBeNull();
    });

    it("finds another custom timeline, ignoring case beyond ASCII", () => {
      store.createCustomTimeline(UNIT, "Dovolená");

      expect(rules.findPlanNameConflict(UNIT, "DOVOLENÁ")).toMatchObject({ kind: "custom" });
    });

    it("does not report the plan being renamed", () => {
      const own = store.createCustomTimeline(UNIT, "Dovolená");

      expect(
        rules.findPlanNameConflict(UNIT, "dovolená", { kind: "custom", id: own.id }),
      ).toBeNull();
    });
  });
});
