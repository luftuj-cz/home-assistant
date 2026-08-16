import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type TimelineModule = typeof import("../../../src/services/db/timeline.js");

const UNIT = "atrea-am";

describe("season-scoped mode resolution", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let timeline: TimelineModule;
  let springId: number;
  let summerId: number;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    timeline = await import("../../../src/services/db/timeline.js");

    const insertSeason = db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       VALUES (?, ?, ?, ?, 1, ?)`,
    );
    springId = Number(insertSeason.run("spring", UNIT, "03-01", "05-31", 0).lastInsertRowid);
    summerId = Number(insertSeason.run("summer", UNIT, "06-01", "08-31", 1).lastInsertRowid);

    const insertMode = db.prepare(
      `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id) VALUES (?, ?, ?, ?, ?)`,
    );
    insertMode.run(1, "Komfort", "#1971c2", 0, UNIT);
    insertMode.run(2, "Okno", "#40c057", 0, UNIT);
  });

  afterEach(() => {
    cleanup();
  });

  function setValues(
    modeId: number,
    timelineId: number,
    values: Partial<{ power: number; temperature: number; variables: string; scripts: string }>,
  ) {
    db.prepare(
      `INSERT INTO timeline_mode_values
         (mode_id, timeline_id, power, temperature, variables, script_entity_ids)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      modeId,
      timelineId,
      values.power ?? null,
      values.temperature ?? null,
      values.variables ?? null,
      values.scripts ?? null,
    );
  }

  it("returns the same modes in every season - identity is shared", () => {
    setValues(1, springId, { power: 60 });

    const inSpring = timeline.getTimelineModes(UNIT, springId);
    const inSummer = timeline.getTimelineModes(UNIT, summerId);

    expect(inSpring.map((m) => m.id)).toEqual(inSummer.map((m) => m.id));
    expect(inSpring.map((m) => m.name)).toEqual(inSummer.map((m) => m.name));
  });

  it("resolves different values per season", () => {
    setValues(1, springId, { power: 60, temperature: 21.5 });
    setValues(1, summerId, { power: 20, temperature: 18 });

    const spring = timeline.getTimelineModes(UNIT, springId).find((m) => m.id === 1)!;
    const summer = timeline.getTimelineModes(UNIT, summerId).find((m) => m.id === 1)!;

    expect(spring).toMatchObject({ power: 60, temperature: 21.5, configured: true });
    expect(summer).toMatchObject({ power: 20, temperature: 18, configured: true });
  });

  it("marks a mode without values for the season as unconfigured but still lists it", () => {
    setValues(1, springId, { power: 60 });

    const komfort = timeline.getTimelineModes(UNIT, summerId).find((m) => m.id === 1)!;

    expect(komfort).toBeDefined();
    expect(komfort.configured).toBe(false);
    expect(komfort.power).toBeUndefined();
    expect(komfort.name).toBe("Komfort");
  });

  it("treats a script-only mode as configured", () => {
    setValues(2, springId, { scripts: JSON.stringify(["script.open_window"]) });

    const okno = timeline.getTimelineModes(UNIT, springId).find((m) => m.id === 2)!;
    expect(okno.configured).toBe(true);
    expect(okno.scriptEntityIds).toEqual(["script.open_window"]);
    expect(okno.power).toBeUndefined();
  });

  it("treats a values row that would write nothing as unconfigured", () => {
    setValues(1, springId, {});

    const komfort = timeline.getTimelineModes(UNIT, springId).find((m) => m.id === 1)!;
    expect(komfort.configured).toBe(false);
  });

  it("treats an explicit zero as configured, not as absent", () => {
    setValues(1, springId, { power: 0 });

    const komfort = timeline.getTimelineModes(UNIT, springId).find((m) => m.id === 1)!;
    expect(komfort.power).toBe(0);
    expect(komfort.configured).toBe(true);
  });

  it("resolves values carried in the variables JSON", () => {
    setValues(1, springId, { variables: JSON.stringify({ power: 45, mode: 2 }) });

    const komfort = timeline.getTimelineModes(UNIT, springId).find((m) => m.id === 1)!;
    expect(komfort.variables).toEqual({ power: 45, mode: 2 });
    expect(komfort.configured).toBe(true);
  });

  it("without a season, falls back to the legacy columns and reports no configured flag", () => {
    db.prepare(`UPDATE timeline_modes SET power = 55, temperature = 20 WHERE id = 1`).run();

    const legacy = timeline.getTimelineModes(UNIT).find((m) => m.id === 1)!;
    expect(legacy).toMatchObject({ power: 55, temperature: 20 });
    expect(legacy.configured).toBeUndefined();
  });

  it("deleting a mode removes its values in every season", () => {
    setValues(1, springId, { power: 60 });
    setValues(1, summerId, { power: 20 });
    setValues(2, springId, { power: 30 });

    // The cascade only fires while foreign keys are enforced. better-sqlite3
    // enables them on every connection, so this holds in the add-on too -
    // asserting it here rather than switching the pragma on keeps the test
    // measuring what production does.
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);

    timeline.deleteTimelineMode(1);

    function count(modeId: number): number {
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM timeline_mode_values WHERE mode_id = ?`)
        .get(modeId) as { n: number };
      return row.n;
    }

    expect(count(1)).toBe(0);
    // Another mode's values are untouched.
    expect(count(2)).toBe(1);
  });
});

describe("request-scoped vs active season", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let timeline: TimelineModule;
  let seasons: typeof import("../../../src/services/db/seasons.js");

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    timeline = await import("../../../src/services/db/timeline.js");
    seasons = await import("../../../src/services/db/seasons.js");

    seasons.ensureSeasons(UNIT);
    seasons.setSeasonEnabled(UNIT, "spring", true);
    seasons.setSeasonEnabled(UNIT, "winter", true);
    db.prepare(
      `INSERT INTO timeline_modes (id, name, is_boost, hru_id) VALUES (1, 'Komfort', 0, ?)`,
    ).run(UNIT);
  });

  afterEach(() => {
    cleanup();
  });

  it("writing to a non-active season leaves the active season untouched", () => {
    const all = seasons.getSeasons(UNIT);
    const spring = all.find((s) => s.seasonKey === "spring")!;
    const winter = all.find((s) => s.seasonKey === "winter")!;

    timeline.upsertTimelineMode({ id: 1, name: "Komfort", hruId: UNIT, power: 60 }, spring.id);
    timeline.upsertTimelineMode({ id: 1, name: "Komfort", hruId: UNIT, power: 15 }, winter.id);

    expect(timeline.getTimelineModes(UNIT, spring.id).find((m) => m.id === 1)?.power).toBe(60);
    expect(timeline.getTimelineModes(UNIT, winter.id).find((m) => m.id === 1)?.power).toBe(15);
  });

  it("rejects a save that would write nothing for the season", () => {
    const spring = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "spring")!;

    expect(() =>
      timeline.upsertTimelineMode({ id: 1, name: "Komfort", hruId: UNIT }, spring.id),
    ).toThrow(/at least one value or one activation script/i);
  });

  it("mirrors the write into the legacy columns so a downgraded build still reads it", () => {
    const spring = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "spring")!;

    timeline.upsertTimelineMode(
      { id: 1, name: "Komfort", hruId: UNIT, power: 42, temperature: 20 },
      spring.id,
    );

    const legacy = db.prepare(`SELECT power, temperature FROM timeline_modes WHERE id = 1`).get();
    expect(legacy).toMatchObject({ power: 42, temperature: 20 });
  });

  it("removing a season's values makes the mode unconfigured there again", () => {
    const spring = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "spring")!;
    timeline.upsertTimelineMode({ id: 1, name: "Komfort", hruId: UNIT, power: 60 }, spring.id);

    timeline.deleteTimelineModeValues(1, spring.id);

    expect(timeline.getTimelineModes(UNIT, spring.id).find((m) => m.id === 1)?.configured).toBe(
      false,
    );
  });
});

describe("configured-before-usable enforcement", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let timeline: TimelineModule;
  let seasons: typeof import("../../../src/services/db/seasons.js");
  let springId: number;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    timeline = await import("../../../src/services/db/timeline.js");
    seasons = await import("../../../src/services/db/seasons.js");

    seasons.ensureSeasons(UNIT);
    seasons.setSeasonEnabled(UNIT, "spring", true);
    springId = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "spring")!.id;

    db.prepare(
      `INSERT INTO timeline_modes (id, name, is_boost, hru_id) VALUES (1, 'Komfort', 0, ?)`,
    ).run(UNIT);
    timeline.upsertTimelineMode({ id: 1, name: "Komfort", hruId: UNIT, power: 60 }, springId);
  });

  afterEach(() => {
    cleanup();
  });

  function addEvent(enabled: number) {
    db.prepare(
      `INSERT INTO timeline_events (start_time, day_of_week, hru_config, enabled, priority,
                                    hru_id, timeline_id)
       VALUES ('06:00', 0, '{"mode":"1"}', ?, 0, ?, ?)`,
    ).run(enabled, UNIT, springId);
  }

  it("refuses to remove values while an enabled event still uses the mode", () => {
    addEvent(1);

    expect(() => timeline.deleteTimelineModeValues(1, springId)).toThrow(/still use this mode/i);
    expect(timeline.getTimelineModes(UNIT, springId).find((m) => m.id === 1)?.configured).toBe(
      true,
    );
  });

  it("allows removing values when only a disabled event references the mode", () => {
    addEvent(0);

    expect(() => timeline.deleteTimelineModeValues(1, springId)).not.toThrow();
  });

  it("counts only enabled events that reference the mode", () => {
    addEvent(1);
    addEvent(0);

    expect(timeline.countEnabledEventsUsingMode(1, springId)).toBe(1);
  });

  it("reports per-season usage and flags a season that would be left empty", () => {
    addEvent(1);

    const usage = timeline.getModeUsage(1, UNIT);
    const spring = usage.find((u) => u.timelineId === springId)!;

    expect(spring.enabledEvents).toBe(1);
    expect(spring.wouldBeLeftEmpty).toBe(true);
  });

  it("does not flag a season that keeps other events", () => {
    addEvent(1);
    db.prepare(
      `INSERT INTO timeline_events (start_time, day_of_week, hru_config, enabled, priority,
                                    hru_id, timeline_id)
       VALUES ('22:00', 0, '{"mode":"99"}', 1, 0, ?, ?)`,
    ).run(UNIT, springId);

    const spring = timeline.getModeUsage(1, UNIT).find((u) => u.timelineId === springId)!;
    expect(spring.wouldBeLeftEmpty).toBe(false);
  });

  it("accepts a mode that only runs scripts, writing no HRU or valve values", () => {
    timeline.upsertTimelineMode(
      { id: 1, name: "Okno", hruId: UNIT, scriptEntityIds: ["script.open_window"] },
      springId,
    );

    const mode = timeline.getTimelineModes(UNIT, springId).find((m) => m.id === 1)!;
    expect(mode.configured).toBe(true);
    expect(mode.scriptEntityIds).toEqual(["script.open_window"]);
    expect(mode.power).toBeUndefined();
    expect(mode.temperature).toBeUndefined();
    expect(mode.variables).toBeUndefined();
    expect(mode.luftatorConfig).toBeUndefined();
  });

  it("rejects an empty save with a typed error the route can translate", () => {
    expect(() =>
      timeline.upsertTimelineMode({ id: 1, name: "Komfort", hruId: UNIT }, springId),
    ).toThrow(timeline.ModeValuesEmptyError);
  });

  it("puts a mode back to unconfigured for one season", () => {
    timeline.deleteTimelineModeValues(1, springId);

    const mode = timeline.getTimelineModes(UNIT, springId).find((m) => m.id === 1);
    expect(mode?.configured).toBe(false);
  });

  it("counts events that reference the mode by name, not only by id", () => {
    // findTimelineModeByReference resolves a name as well as an id, and legacy
    // events use one. Counting ids alone reported "no events use this mode"
    // and let the guard below be walked straight past.
    db.prepare(
      `INSERT INTO timeline_events (start_time, day_of_week, hru_config, enabled, priority,
                                    hru_id, timeline_id)
       VALUES ('07:00', 0, '{"mode":"Komfort"}', 1, 0, ?, ?)`,
    ).run(UNIT, springId);

    expect(timeline.countEnabledEventsUsingMode(1, springId)).toBe(1);
    expect(() => timeline.deleteTimelineModeValues(1, springId)).toThrow(
      timeline.ModeValuesInUseError,
    );
  });

  it("refuses to remove values an enabled event still uses", () => {
    addEvent(1);

    expect(() => timeline.deleteTimelineModeValues(1, springId)).toThrow(
      timeline.ModeValuesInUseError,
    );
    expect(timeline.getTimelineModes(UNIT, springId).find((m) => m.id === 1)?.configured).toBe(
      true,
    );
  });
});

/**
 * The legacy value columns on timeline_modes are what a build from before this
 * change reads. Mirroring any season's values into them would make a downgrade
 * apply that season all year round, so only the default season may write there.
 */
describe("legacy column mirroring", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let timeline: TimelineModule;
  let seasons: typeof import("../../../src/services/db/seasons.js");
  let springId: number;
  let winterId: number;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    timeline = await import("../../../src/services/db/timeline.js");
    seasons = await import("../../../src/services/db/seasons.js");

    seasons.ensureSeasons(UNIT);
    seasons.setSeasonEnabled(UNIT, "spring", true);
    seasons.setSeasonEnabled(UNIT, "winter", true);
    springId = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "spring")!.id;
    winterId = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "winter")!.id;

    db.prepare(
      `INSERT INTO timeline_modes (id, name, is_boost, hru_id, power) VALUES (1, 'Komfort', 0, ?, 60)`,
    ).run(UNIT);
  });

  afterEach(() => {
    cleanup();
  });

  function legacyValues() {
    return db.prepare(`SELECT power, temperature FROM timeline_modes WHERE id = 1`).get() as {
      power: number | null;
      temperature: number | null;
    };
  }

  it("mirrors an edit to the default season, so an older build sees it", () => {
    timeline.upsertTimelineMode({ id: 1, name: "Komfort", hruId: UNIT, power: 75 }, springId);

    expect(legacyValues().power).toBe(75);
  });

  it("leaves the legacy columns alone when another season is edited", () => {
    timeline.upsertTimelineMode({ id: 1, name: "Komfort", hruId: UNIT, power: 20 }, winterId);

    // Winter's 20 must not become what a downgraded build applies in July.
    expect(legacyValues().power).toBe(60);
    expect(timeline.getTimelineModes(UNIT, winterId).find((m) => m.id === 1)?.power).toBe(20);
  });

  it("still writes identity changes made from another season", () => {
    timeline.upsertTimelineMode(
      { id: 1, name: "Komfort plus", hruId: UNIT, color: "#fd7e14", power: 20 },
      winterId,
    );

    const row = db.prepare(`SELECT name, color FROM timeline_modes WHERE id = 1`).get() as {
      name: string;
      color: string;
    };
    expect(row).toMatchObject({ name: "Komfort plus", color: "#fd7e14" });
  });
});
