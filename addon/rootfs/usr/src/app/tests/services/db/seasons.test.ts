import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type SeasonsModule = typeof import("../../../src/services/db/seasons.js");

const UNIT = "atrea-am";

describe("season partition", () => {
  let cleanup: () => void;
  let seasons: SeasonsModule;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    seasons = await import("../../../src/services/db/seasons.js");
    seasons.ensureSeasons(UNIT);
  });

  afterEach(() => {
    cleanup();
  });

  function enableAll() {
    for (const key of seasons.SEASON_KEYS) {
      seasons.setSeasonEnabled(UNIT, key, true);
    }
  }

  describe("inRange", () => {
    it("includes both boundary days of a normal span", () => {
      expect(seasons.inRange("03-01", "03-01", "05-31")).toBe(true);
      expect(seasons.inRange("05-31", "03-01", "05-31")).toBe(true);
      expect(seasons.inRange("06-01", "03-01", "05-31")).toBe(false);
      expect(seasons.inRange("02-28", "03-01", "05-31")).toBe(false);
    });

    it("handles a span that wraps the year end", () => {
      expect(seasons.inRange("12-01", "12-01", "02-28")).toBe(true);
      expect(seasons.inRange("12-31", "12-01", "02-28")).toBe(true);
      expect(seasons.inRange("01-01", "12-01", "02-28")).toBe(true);
      expect(seasons.inRange("02-28", "12-01", "02-28")).toBe(true);
      expect(seasons.inRange("03-01", "12-01", "02-28")).toBe(false);
      expect(seasons.inRange("11-30", "12-01", "02-28")).toBe(false);
    });
  });

  describe("previousMonthDay", () => {
    it("steps back within a month and across month ends", () => {
      expect(seasons.previousMonthDay("03-02")).toBe("03-01");
      expect(seasons.previousMonthDay("06-01")).toBe("05-31");
      expect(seasons.previousMonthDay("09-01")).toBe("08-31");
    });

    it("wraps the year start", () => {
      expect(seasons.previousMonthDay("01-01")).toBe("12-31");
    });

    it("yields 02-29 so a leap day is never skipped by the partition", () => {
      expect(seasons.previousMonthDay("03-01")).toBe("02-29");
    });
  });

  describe("derived spans", () => {
    it("a single enabled season covers the whole year", () => {
      seasons.setSeasonEnabled(UNIT, "spring", true);
      const spring = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "spring")!;
      expect(spring.spanEnd).toBe(seasons.previousMonthDay(spring.spanStart));

      for (const probe of [new Date(2026, 0, 1), new Date(2026, 6, 15), new Date(2026, 11, 31)]) {
        expect(seasons.resolveActiveSeason(UNIT, probe)?.seasonKey).toBe("spring");
      }
    });

    it("four enabled seasons tile the year with no gap or overlap", () => {
      enableAll();
      const enabled = seasons.getEnabledSeasons(UNIT);
      expect(enabled).toHaveLength(4);

      // Walk every day of a leap year: exactly one season must match.
      const cursor = new Date(2024, 0, 1);
      let checked = 0;
      while (cursor.getFullYear() === 2024) {
        const matches = enabled.filter((season) =>
          seasons.inRange(seasons.toMonthDay(cursor), season.spanStart, season.spanEnd),
        );
        expect(matches).toHaveLength(1);
        checked++;
        cursor.setDate(cursor.getDate() + 1);
      }
      expect(checked).toBe(366);
    });

    it("resolves the expected season for representative dates", () => {
      enableAll();
      function on(month: number, day: number) {
        return seasons.resolveActiveSeason(UNIT, new Date(2026, month - 1, day))?.seasonKey;
      }

      expect(on(4, 15)).toBe("spring");
      expect(on(7, 28)).toBe("summer");
      expect(on(10, 5)).toBe("autumn");
      expect(on(1, 20)).toBe("winter");
      expect(on(12, 1)).toBe("winter");
      expect(on(2, 28)).toBe("winter");
      expect(on(3, 1)).toBe("spring");
    });
  });

  describe("enable and disable", () => {
    it("disabling absorbs the span into the preceding enabled season", () => {
      enableAll();
      seasons.setSeasonEnabled(UNIT, "autumn", false);

      const summer = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "summer")!;
      expect(summer.spanEnd).toBe("11-30");
      expect(seasons.resolveActiveSeason(UNIT, new Date(2026, 9, 5))?.seasonKey).toBe("summer");
    });

    it("disabling is non-destructive and re-enabling reclaims the same span", () => {
      enableAll();
      const before = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "autumn")!;

      seasons.setSeasonEnabled(UNIT, "autumn", false);
      seasons.setSeasonEnabled(UNIT, "autumn", true);

      const after = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "autumn")!;
      expect(after.id).toBe(before.id);
      expect(after.spanStart).toBe(before.spanStart);
      expect(after.spanEnd).toBe(before.spanEnd);
    });

    it("two enabled seasons express a heating and non-heating period", () => {
      seasons.setSeasonEnabled(UNIT, "spring", true);
      seasons.setSeasonEnabled(UNIT, "winter", true);
      seasons.setSeasonStart(UNIT, "spring", "04-15");
      seasons.setSeasonStart(UNIT, "winter", "10-01");

      function on(month: number, day: number) {
        return seasons.resolveActiveSeason(UNIT, new Date(2026, month - 1, day))?.seasonKey;
      }
      expect(on(7, 1)).toBe("spring");
      expect(on(11, 1)).toBe("winter");
      expect(on(1, 15)).toBe("winter");
      expect(on(4, 15)).toBe("spring");
      expect(on(4, 14)).toBe("winter");
    });

    it("refuses to disable the last enabled season", () => {
      seasons.setSeasonEnabled(UNIT, "spring", true);
      expect(() => seasons.setSeasonEnabled(UNIT, "spring", false)).toThrow(/at least one season/i);
    });

    it("refuses a boundary that collides with another enabled season", () => {
      enableAll();
      expect(() => seasons.setSeasonStart(UNIT, "summer", "03-01")).toThrow(/boundary/i);
    });

    it("rejects a malformed boundary", () => {
      enableAll();
      expect(() => seasons.setSeasonStart(UNIT, "summer", "6-1")).toThrow(/MM-DD/);
      expect(() => seasons.setSeasonStart(UNIT, "summer", "13-01")).toThrow(/MM-DD/);
    });
  });

  describe("per-unit isolation", () => {
    it("keeps another unit's configuration when the active unit changes", () => {
      enableAll();
      seasons.setSeasonStart(UNIT, "summer", "06-15");

      seasons.ensureSeasons("korado");
      seasons.setSeasonEnabled("korado", "winter", true);

      const original = seasons.getSeasons(UNIT).find((s) => s.seasonKey === "summer")!;
      expect(original.spanStart).toBe("06-15");
      expect(original.enabled).toBe(true);

      const other = seasons.getSeasons("korado");
      expect(other.filter((s) => s.enabled).map((s) => s.seasonKey)).toEqual(["winter"]);
    });

    it("ensureSeasons is idempotent and never duplicates rows", () => {
      seasons.ensureSeasons(UNIT);
      seasons.ensureSeasons(UNIT);
      expect(seasons.getSeasons(UNIT)).toHaveLength(4);
    });
  });

  describe("DST", () => {
    it("resolves the boundary day the same regardless of time of day", () => {
      enableAll();
      // 2026-03-29 is the European DST switch. The boundary must depend on the
      // local calendar day only, not on the hour or the UTC offset.
      const keys = [0, 1, 2, 3, 12, 23].map(
        (hour) => seasons.resolveActiveSeason(UNIT, new Date(2026, 2, 29, hour, 30))?.seasonKey,
      );
      expect(new Set(keys).size).toBe(1);
      expect(keys[0]).toBe("spring");
    });
  });
});

describe("event scoping by season", () => {
  let cleanup: () => void;
  let db: import("better-sqlite3").Database;
  let timeline: typeof import("../../../src/services/db/timeline.js");
  let seasonsMod: typeof import("../../../src/services/db/seasons.js");

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    timeline = await import("../../../src/services/db/timeline.js");
    seasonsMod = await import("../../../src/services/db/seasons.js");
    seasonsMod.ensureSeasons(UNIT);
    seasonsMod.setSeasonEnabled(UNIT, "spring", true);
  });

  afterEach(() => {
    cleanup();
  });

  it("returns only the requested season's events", () => {
    const all = seasonsMod.getSeasons(UNIT);
    const spring = all.find((s) => s.seasonKey === "spring")!;
    const winter = all.find((s) => s.seasonKey === "winter")!;

    timeline.upsertTimelineEvent({
      startTime: "06:00",
      dayOfWeek: 0,
      enabled: true,
      priority: 0,
      hruId: UNIT,
      timelineId: spring.id,
    });
    timeline.upsertTimelineEvent({
      startTime: "07:00",
      dayOfWeek: 0,
      enabled: true,
      priority: 0,
      hruId: UNIT,
      timelineId: winter.id,
    });

    expect(timeline.getTimelineEvents(UNIT, spring.id).map((e) => e.startTime)).toEqual(["06:00"]);
    expect(timeline.getTimelineEvents(UNIT, winter.id).map((e) => e.startTime)).toEqual(["07:00"]);
  });

  it("without a season, returns the unit-wide list - the pre-seasons behaviour", () => {
    const spring = seasonsMod.getSeasons(UNIT).find((s) => s.seasonKey === "spring")!;
    timeline.upsertTimelineEvent({
      startTime: "06:00",
      dayOfWeek: 0,
      enabled: true,
      priority: 0,
      hruId: UNIT,
      timelineId: spring.id,
    });

    expect(timeline.getTimelineEvents(UNIT)).toHaveLength(1);
  });

  it("a single enabled season resolves the same events as no season at all", () => {
    const spring = seasonsMod.getSeasons(UNIT).find((s) => s.seasonKey === "spring")!;
    for (const time of ["06:00", "12:00", "22:00"]) {
      timeline.upsertTimelineEvent({
        startTime: time,
        dayOfWeek: 0,
        enabled: true,
        priority: 0,
        hruId: UNIT,
        timelineId: spring.id,
      });
    }

    const scoped = timeline.getTimelineEvents(UNIT, spring.id).map((e) => e.startTime);
    const unscoped = timeline.getTimelineEvents(UNIT).map((e) => e.startTime);
    expect(scoped).toEqual(unscoped);
    void db;
  });
});

describe("seasons feature enable and disable", () => {
  let cleanup: () => void;
  let db: import("better-sqlite3").Database;
  let feature: typeof import("../../../src/services/db/seasonsFeature.js");
  let seasonsMod: typeof import("../../../src/services/db/seasons.js");
  let timeline: typeof import("../../../src/services/db/timeline.js");

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    feature = await import("../../../src/services/db/seasonsFeature.js");
    seasonsMod = await import("../../../src/services/db/seasons.js");
    timeline = await import("../../../src/services/db/timeline.js");

    // A running single-season install, as migration 013 leaves it.
    db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       VALUES ('spring', ?, '01-01', '12-31', 1, 0)`,
    ).run(UNIT);
    const springId = (
      db.prepare(`SELECT id FROM timelines WHERE hru_id = ?`).get(UNIT) as { id: number }
    ).id;
    db.prepare(
      `INSERT INTO timeline_modes (id, name, is_boost, hru_id) VALUES (1,'Komfort',0,?)`,
    ).run(UNIT);
    timeline.upsertTimelineMode({ id: 1, name: "Komfort", hruId: UNIT, power: 60 }, springId);
    for (const time of ["06:00", "22:00"]) {
      timeline.upsertTimelineEvent({
        startTime: time,
        dayOfWeek: 0,
        hruConfig: { mode: "1" },
        enabled: true,
        priority: 0,
        hruId: UNIT,
        timelineId: springId,
      });
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("is off by default", () => {
    expect(feature.isSeasonsFeatureEnabled()).toBe(false);
  });

  it("enabling with clone leaves every season an exact copy of the running schedule", () => {
    feature.enableSeasonsFeature(UNIT, true);

    const all = seasonsMod.getSeasons(UNIT);
    expect(all).toHaveLength(4);
    expect(all.every((s) => s.enabled)).toBe(true);

    for (const season of all) {
      const events = timeline.getTimelineEvents(UNIT, season.id);
      expect(events.map((e) => e.startTime).sort()).toEqual(["06:00", "22:00"]);

      const modes = timeline.getTimelineModes(UNIT, season.id);
      expect(modes.every((m) => m.configured)).toBe(true);
      expect(modes.find((m) => m.id === 1)?.power).toBe(60);
    }
  });

  it("enabling with clone keeps the same event applying at any moment of the year", () => {
    const before = timeline
      .getTimelineEvents(UNIT)
      .map((e) => e.startTime)
      .sort();
    feature.enableSeasonsFeature(UNIT, true);

    for (const probe of [new Date(2026, 0, 15), new Date(2026, 6, 15), new Date(2026, 10, 15)]) {
      const active = seasonsMod.resolveActiveSeason(UNIT, probe)!;
      const events = timeline
        .getTimelineEvents(UNIT, active.id)
        .map((e) => e.startTime)
        .sort();
      expect(events).toEqual(before);
    }
  });

  it("enabling without clone leaves the other seasons empty", () => {
    feature.enableSeasonsFeature(UNIT, false);

    const summer = seasonsMod.getSeasons(UNIT).find((s) => s.seasonKey === "summer")!;
    expect(timeline.getTimelineEvents(UNIT, summer.id)).toHaveLength(0);
    expect(timeline.getTimelineModes(UNIT, summer.id).every((m) => m.configured === false)).toBe(
      true,
    );
  });

  it("seeds meteorological boundaries", () => {
    feature.enableSeasonsFeature(UNIT, true);
    const starts = Object.fromEntries(
      seasonsMod.getSeasons(UNIT).map((s) => [s.seasonKey, s.spanStart]),
    );
    expect(starts).toEqual({
      spring: "03-01",
      summer: "06-01",
      autumn: "09-01",
      winter: "12-01",
    });
  });

  it("disabling leaves exactly one season applying all year", () => {
    feature.enableSeasonsFeature(UNIT, true);
    feature.disableSeasonsFeature(UNIT, "spring");

    // The scheduler resolves only through enabled seasons, so one enabled
    // whole-year season is what makes this indistinguishable from an install
    // that never had the feature on.
    const enabled = seasonsMod.getEnabledSeasons(UNIT);
    expect(enabled).toHaveLength(1);
    expect(enabled[0]).toMatchObject({ seasonKey: "spring", spanStart: "01-01", enabled: true });
    expect(feature.isSeasonsFeatureEnabled()).toBe(false);
  });

  it("disabling destroys nothing - the parked seasons keep their events", () => {
    feature.enableSeasonsFeature(UNIT, true);
    const events = db.prepare(`SELECT COUNT(*) AS n FROM timeline_events`).get() as { n: number };
    const values = db.prepare(`SELECT COUNT(*) AS n FROM timeline_mode_values`).get() as {
      n: number;
    };

    feature.disableSeasonsFeature(UNIT, "spring");

    expect(seasonsMod.getSeasons(UNIT)).toHaveLength(4);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM timeline_events`).get()).toEqual(events);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM timeline_mode_values`).get()).toEqual(values);
  });

  it("an off and on round trip brings the other seasons back with their events", () => {
    feature.enableSeasonsFeature(UNIT, true);
    const winter = seasonsMod.getSeasons(UNIT).find((s) => s.seasonKey === "winter")!;
    timeline.upsertTimelineEvent({
      startTime: "03:00",
      dayOfWeek: 1,
      hruConfig: { mode: "1" },
      enabled: true,
      priority: 0,
      hruId: UNIT,
      timelineId: winter.id,
    });

    feature.disableSeasonsFeature(UNIT, "spring");
    // Parked, so not applied - but still there.
    expect(seasonsMod.getSeasons(UNIT).find((s) => s.seasonKey === "winter")?.enabled).toBe(false);

    feature.enableSeasonsFeature(UNIT, false);

    const winterAgain = seasonsMod.getSeasons(UNIT).find((s) => s.seasonKey === "winter")!;
    expect(winterAgain.enabled).toBe(true);
    expect(timeline.getTimelineEvents(UNIT, winterAgain.id).map((e) => e.startTime)).toContain(
      "03:00",
    );
  });

  it("re-enabling with clone does not overwrite a parked season's schedule", () => {
    feature.enableSeasonsFeature(UNIT, true);
    const winter = seasonsMod.getSeasons(UNIT).find((s) => s.seasonKey === "winter")!;
    timeline.upsertTimelineEvent({
      startTime: "03:00",
      dayOfWeek: 1,
      hruConfig: { mode: "1" },
      enabled: true,
      priority: 0,
      hruId: UNIT,
      timelineId: winter.id,
    });
    const parked = timeline
      .getTimelineEvents(UNIT, winter.id)
      .map((e) => e.startTime)
      .sort();

    feature.disableSeasonsFeature(UNIT, "spring");
    // The default path: the clone checkbox is ticked, and it used to delete
    // every parked season's events on the way back in.
    feature.enableSeasonsFeature(UNIT, true);

    const winterAgain = seasonsMod.getSeasons(UNIT).find((s) => s.seasonKey === "winter")!;
    expect(
      timeline
        .getTimelineEvents(UNIT, winterAgain.id)
        .map((e) => e.startTime)
        .sort(),
    ).toEqual(parked);
  });

  it("still clones into a season that has nothing of its own", () => {
    // First enable on a single-season install: the other three are empty, so
    // cloning is exactly what should fill them.
    feature.enableSeasonsFeature(UNIT, true);

    const counts = seasonsMod
      .getSeasons(UNIT)
      .map((season) => timeline.getTimelineEvents(UNIT, season.id).length);
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBeGreaterThan(0);
  });

  it("applies a boundary move and a disable as one unit, or not at all", () => {
    feature.enableSeasonsFeature(UNIT, true);
    const before = seasonsMod.getSeasons(UNIT).find((s) => s.seasonKey === "summer")!.spanStart;

    // Moving summer onto autumn's start day is only invalid in combination -
    // the boundary alone would have been committed before the enable failed.
    expect(() =>
      seasonsMod.updateSeason(UNIT, "summer", { spanStart: "09-01", enabled: true }),
    ).toThrow();
    expect(seasonsMod.getSeasons(UNIT).find((s) => s.seasonKey === "summer")?.spanStart).toBe(
      before,
    );
  });

  it("keeping a season other than spring works without renaming it", () => {
    feature.enableSeasonsFeature(UNIT, true);

    feature.disableSeasonsFeature(UNIT, "winter");

    const enabled = seasonsMod.getEnabledSeasons(UNIT);
    expect(enabled).toHaveLength(1);
    expect(enabled[0]).toMatchObject({ seasonKey: "winter", spanStart: "01-01" });
  });

  it("reports which season stays in charge, per season", () => {
    feature.enableSeasonsFeature(UNIT, true);
    const impact = feature.getDisableImpact(UNIT, "spring");

    expect(impact).toHaveLength(4);
    expect(impact.find((i) => i.seasonKey === "spring")?.wouldBeKept).toBe(true);
    expect(impact.filter((i) => !i.wouldBeKept)).toHaveLength(3);
    expect(impact.every((i) => i.enabledEvents === 2)).toBe(true);
  });
});
