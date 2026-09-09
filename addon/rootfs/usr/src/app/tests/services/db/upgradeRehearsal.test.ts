import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDatabaseAt,
  makeTempDir,
  openApplicationDatabase,
  PRE_SEASONS_MIGRATION,
} from "../../helpers/legacyDb.js";

const UNIT = "atrea-am";

type LegacyEvent = {
  id: number;
  start_time: string;
  day_of_week: number | null;
  hru_config: string | null;
  enabled: number;
  priority: number;
};

/**
 * What 1.0.9 stored, as 1.0.9 stored it. Three kinds of install:
 *  - schedule: modes and a full week of events, the common case;
 *  - boost-only: modes but not a single event, so migration 013 creates no
 *    season at all;
 *  - both include a valve-only mode and a mode with a decimal power, which
 *    1.0.9 accepted.
 */
function seedLegacyInstall(db: DatabaseType, withEvents: boolean): void {
  const insertMode = db.prepare(
    `INSERT INTO timeline_modes (id, name, color, power, temperature, luftator_config, is_boost,
                                 hru_id, native_mode, variables, script_entity_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertMode.run(1, "Komfort", "#1971c2", 60, 21.5, null, 0, UNIT, 2, null, null);
  insertMode.run(2, "Utlum", "#868e96", 20, 19, null, 0, UNIT, 2, null, null);
  insertMode.run(3, "Vetrani", "#fd7e14", 47.5, null, null, 1, UNIT, null, null, null);
  insertMode.run(
    4,
    "Jen ventily",
    "#40c057",
    null,
    null,
    JSON.stringify({ "number.luftator_kuchyne": 100, "number.luftator_loznice": 0 }),
    1,
    UNIT,
    null,
    null,
    null,
  );
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`).run(
    "hru.settings",
    JSON.stringify({ unit: UNIT }),
  );

  if (!withEvents) return;
  const insertEvent = db.prepare(
    `INSERT INTO timeline_events (start_time, day_of_week, hru_config, luftator_config, enabled,
                                  priority, hru_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let day = 0; day < 7; day++) {
    insertEvent.run("06:00", day, JSON.stringify({ mode: "1" }), null, 1, 0, UNIT);
    insertEvent.run("22:00", day, JSON.stringify({ mode: "2" }), null, 1, 0, UNIT);
  }
  // A legacy event referencing its mode by name, and a disabled one.
  insertEvent.run("12:00", 5, JSON.stringify({ mode: "Komfort" }), null, 1, 0, UNIT);
  insertEvent.run("15:00", 6, JSON.stringify({ mode: "2" }), null, 0, 0, UNIT);
}

/** The 1.0.9 pick, over the raw rows: latest event at or before now, searching back through the week. */
function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

function legacyPick(events: LegacyEvent[], nowMinutes: number, today: number): LegacyEvent | null {
  for (let d = 0; d < 7; d++) {
    const targetDay = (today - d + 7) % 7;
    let candidates = events.filter(
      (e) => e.enabled === 1 && (e.day_of_week === null || e.day_of_week === targetDay),
    );
    if (d === 0) candidates = candidates.filter((e) => toMinutes(e.start_time) <= nowMinutes);
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const diff = toMinutes(b.start_time) - toMinutes(a.start_time);
        return diff !== 0 ? diff : b.priority - a.priority;
      });
      return candidates[0]!;
    }
  }
  return null;
}

describe("upgrade rehearsal: a 1.0.9 database meets this build", () => {
  let temp: ReturnType<typeof makeTempDir>;
  let opened: Awaited<ReturnType<typeof openApplicationDatabase>> | null = null;

  beforeEach(() => {
    temp = makeTempDir("luftator-upgrade-rehearsal-");
  });

  afterEach(() => {
    opened?.cleanup();
    opened = null;
    temp.remove();
  });

  describe("schedule install", () => {
    let legacyEvents: LegacyEvent[];

    beforeEach(async () => {
      const legacy = buildDatabaseAt(temp.dbPath, PRE_SEASONS_MIGRATION);
      seedLegacyInstall(legacy, true);
      legacyEvents = legacy.prepare(`SELECT * FROM timeline_events`).all() as LegacyEvent[];
      legacy.close();

      opened = await openApplicationDatabase(temp.dbPath);
    });

    it("runs every pending migration and leaves the feature off", () => {
      const applied = opened!.db.prepare(`SELECT id FROM migrations ORDER BY id`).all() as {
        id: string;
      }[];
      expect(applied.map((m) => m.id)).toContain("015_timelines_unique_per_unit");
      expect(opened!.database.getAppSetting("timeline.seasons_enabled")).not.toBe("true");
      expect(opened!.database.getEnabledSeasons(UNIT)).toHaveLength(1);
    });

    it("resolves the same event in every one of the week's 10 080 minute slots", async () => {
      const picker = await import("../../../src/services/timeline/eventPicker.js");
      let compared = 0;
      for (let day = 0; day < 7; day++) {
        for (let minute = 0; minute < 24 * 60; minute++) {
          const expected = legacyPick(legacyEvents, minute, day);
          const actual = picker.pickActiveEvent(UNIT, minute, day);
          expect(actual?.id ?? null, `day ${day} minute ${minute}`).toBe(expected?.id ?? null);
          compared++;
        }
      }
      expect(compared).toBe(10_080);
    });

    it("keeps every mode configured for the active season, valve-only included", () => {
      const { database } = opened!;
      const modes = database.getTimelineModes(UNIT, database.getActiveSeasonId(UNIT));
      expect(modes.map((m) => [m.name, m.configured]).sort()).toEqual(
        [
          ["Jen ventily", true],
          ["Komfort", true],
          ["Utlum", true],
          ["Vetrani", true],
        ].sort(),
      );
      expect(modes.find((m) => m.name === "Vetrani")?.power).toBe(47.5);
    });

    it("lets a mode saved with a decimal power under 1.0.9 be saved again", async () => {
      const { timelineModeInputSchema } = await import("../../../src/schemas/timeline.js");
      const parsed = timelineModeInputSchema.parse({ name: "Vetrani", power: 47.5, isBoost: true });
      expect(parsed.power).toBe(48);
    });

    it("can still boost the valve-only mode", async () => {
      const { database } = opened!;
      const { buildBoostOverride } =
        await import("../../../src/services/timeline/boostOverride.js");
      const mode = database
        .getTimelineModes(UNIT, database.getActiveSeasonId(UNIT))
        .find((m) => m.name === "Jen ventily")!;
      const override = buildBoostOverride(mode, 30, new Date().toISOString());
      expect(override.customConfig?.luftatorConfig).toEqual({
        "number.luftator_kuchyne": 100,
        "number.luftator_loznice": 0,
      });
    });

    it("does not drive the unit to the safe state while the feature is off", async () => {
      const { TimelineScheduler } = await import("../../../src/services/timelineScheduler.js");
      const scheduler = new TimelineScheduler(
        {} as never,
        { getAllUnits: () => [{ id: UNIT, variables: [] }] } as never,
        { setTimelineOverride: vi.fn() } as never,
        { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      );
      const resolve = (
        scheduler as unknown as { resolveNoEventPayload: (u: string) => unknown }
      ).resolveNoEventPayload.bind(scheduler);
      expect(resolve(UNIT)).toBeNull();
    });
  });

  describe("boost-only install (modes, no events)", () => {
    beforeEach(async () => {
      const legacy = buildDatabaseAt(temp.dbPath, PRE_SEASONS_MIGRATION);
      seedLegacyInstall(legacy, false);
      legacy.close();
      opened = await openApplicationDatabase(temp.dbPath);
    });

    it("has no season after the migration and reads modes from the legacy columns", () => {
      const { database } = opened!;
      expect(database.getSeasons(UNIT)).toHaveLength(0);
      expect(database.getActiveSeasonId(UNIT)).toBeUndefined();
      const modes = database.getTimelineModes(UNIT, undefined);
      expect(modes).toHaveLength(4);
      expect(modes.every((m) => m.configured === undefined)).toBe(true);
    });

    it("keeps every mode boostable after the first write brings a season into existence", async () => {
      const { database } = opened!;
      // The first save of anything - here, one mode being edited.
      const seasonId = database.ensureActiveSeasonId(UNIT)!;
      database.upsertTimelineMode({ id: 1, name: "Komfort", hruId: UNIT, power: 65 }, seasonId);

      const modes = database.getTimelineModes(UNIT, database.getActiveSeasonId(UNIT));
      expect(modes.every((m) => m.configured === true)).toBe(true);
      expect(modes.find((m) => m.id === 1)?.power).toBe(65);
      expect(modes.find((m) => m.id === 3)?.power).toBe(47.5);

      const { buildBoostOverride } =
        await import("../../../src/services/timeline/boostOverride.js");
      for (const mode of modes) {
        expect(() => buildBoostOverride(mode, 30, "x"), mode.name).not.toThrow();
      }
    });
  });
});
