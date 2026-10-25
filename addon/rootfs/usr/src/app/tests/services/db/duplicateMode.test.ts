import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type TimelineModule = typeof import("../../../src/services/db/timeline.js");

const UNIT = "atrea-am";
const SOURCE = 1;

/**
 * A duplicated mode gets what was entered in the dialog for the season it was
 * created in, and the source's values everywhere else.
 */
describe("duplicating a timeline mode", () => {
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

    // Two enabled seasons: spring is the default the legacy columns mirror.
    const insertSeason = db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       VALUES (?, ?, ?, ?, 1, ?)`,
    );
    springId = Number(insertSeason.run("spring", UNIT, "03-01", "05-31", 0).lastInsertRowid);
    summerId = Number(insertSeason.run("summer", UNIT, "06-01", "08-31", 1).lastInsertRowid);

    db.prepare(
      `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id) VALUES (?, 'Komfort', '#1971c2', 0, ?)`,
    ).run(SOURCE, UNIT);
  });

  afterEach(() => {
    cleanup();
  });

  function setSourceValues(timelineId: number, power: number) {
    db.prepare(
      `INSERT INTO timeline_mode_values (mode_id, timeline_id, power) VALUES (?, ?, ?)`,
    ).run(SOURCE, timelineId, power);
  }

  function duplicate(timelineId: number, power: number) {
    return timeline.duplicateTimelineMode(
      { name: "Komfort (kopie)", color: "#1971c2", isBoost: false, hruId: UNIT, power },
      timelineId,
      SOURCE,
    );
  }

  function modeIn(id: number, timelineId: number) {
    return timeline.getTimelineModes(UNIT, timelineId).find((mode) => mode.id === id);
  }

  it("keeps the dialog's values in its season and takes the source's elsewhere", () => {
    setSourceValues(springId, 60);
    setSourceValues(summerId, 20);

    const created = duplicate(summerId, 35);

    expect(modeIn(created.id, summerId)).toMatchObject({ power: 35, configured: true });
    expect(modeIn(created.id, springId)).toMatchObject({ power: 60, configured: true });
    expect(modeIn(SOURCE, summerId)).toMatchObject({ power: 20 });
  });

  it("leaves a season unconfigured where the source has nothing", () => {
    setSourceValues(springId, 60);

    const created = duplicate(springId, 35);

    expect(modeIn(created.id, summerId)?.configured).toBe(false);
  });

  it("mirrors a copied default season into the legacy columns", () => {
    setSourceValues(springId, 60);

    const created = duplicate(summerId, 35);

    expect(timeline.getTimelineMode(created.id)?.power).toBe(60);
  });

  it("keeps the legacy columns of a duplicate created in the default season", () => {
    setSourceValues(summerId, 20);

    const created = duplicate(springId, 35);

    expect(timeline.getTimelineMode(created.id)?.power).toBe(35);
  });

  it("copies nothing when there is no season the dialog's values belong to", () => {
    setSourceValues(springId, 60);

    const created = timeline.duplicateTimelineMode(
      { name: "Komfort (kopie)", hruId: UNIT, power: 35 },
      undefined,
      SOURCE,
    );

    expect(timeline.getTimelineMode(created.id)?.power).toBe(35);
    expect(modeIn(created.id, springId)?.configured).toBe(false);
  });

  it("copies the seasons of an install without a unit", () => {
    const insertSeason = db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       VALUES (?, NULL, ?, ?, 1, ?)`,
    );
    const noUnitSpring = Number(insertSeason.run("spring", "03-01", "05-31", 0).lastInsertRowid);
    const noUnitSummer = Number(insertSeason.run("summer", "06-01", "08-31", 1).lastInsertRowid);
    setSourceValues(noUnitSpring, 60);

    // The route stores "no unit" as an empty string, seasons keep NULL.
    const created = timeline.duplicateTimelineMode(
      { name: "Komfort (kopie)", hruId: "", power: 35 },
      noUnitSummer,
      SOURCE,
    );

    const inSpring = timeline
      .getTimelineModes("", noUnitSpring)
      .find((mode) => mode.id === created.id);
    expect(inSpring).toMatchObject({ power: 60, configured: true });
  });
});
