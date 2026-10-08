import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type DatabaseModule = typeof import("../../../src/services/database.js");
type PickerModule = typeof import("../../../src/services/timeline/eventPicker.js");

const UNIT = "atrea-am";
const MONDAY = 0;
const TUESDAY = 1;
const SUNDAY = 6;

/**
 * The schedule repeats weekly, so the picker has to look back a whole week.
 * Searching today plus six days missed the latest event on today's weekday
 * from a week ago: a timeline whose events all sit on one weekday had nothing
 * to apply before that day's first start - which, with seasons on, meant the
 * safe state every week.
 */
describe("pickActiveEvent look-back", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let database: DatabaseModule;
  let picker: PickerModule;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    database = temp.database as DatabaseModule;

    db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       VALUES ('spring', ?, '01-01', '12-31', 1, 0)`,
    ).run(UNIT);
    const seasonId = database.getActiveSeasonId(UNIT);
    for (const [id, name] of [
      [1, "Útlum"],
      [2, "Komfort"],
    ] as const) {
      db.prepare(
        `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id)
         VALUES (?, ?, '#1971c2', 0, ?)`,
      ).run(id, name, UNIT);
      db.prepare(
        `INSERT INTO timeline_mode_values (mode_id, timeline_id, power) VALUES (?, ?, 30)`,
      ).run(id, seasonId);
    }

    picker = await import("../../../src/services/timeline/eventPicker.js");
  });

  afterEach(() => {
    cleanup();
  });

  function addEvent(startTime: string, dayOfWeek: number | null, mode: number): number {
    const result = db
      .prepare(
        `INSERT INTO timeline_events
           (start_time, day_of_week, hru_config, enabled, priority, hru_id, timeline_id)
         VALUES (?, ?, ?, 1, 0, ?, ?)`,
      )
      .run(startTime, dayOfWeek, JSON.stringify({ mode }), UNIT, database.getActiveSeasonId(UNIT));
    return Number(result.lastInsertRowid);
  }

  function pickAt(day: number, time: string) {
    const [hours, minutes] = time.split(":").map(Number);
    return picker.pickActiveEvent(UNIT, hours! * 60 + minutes!, day);
  }

  it("applies last week's event before the first start on its own weekday", () => {
    const monday = addEvent("08:00", MONDAY, 1);

    expect(pickAt(MONDAY, "07:00")?.id).toBe(monday);
    expect(pickAt(MONDAY, "00:00")?.id).toBe(monday);
  });

  it("keeps applying it for the rest of the week", () => {
    const monday = addEvent("08:00", MONDAY, 1);

    expect(pickAt(MONDAY, "08:00")?.id).toBe(monday);
    expect(pickAt(TUESDAY, "10:00")?.id).toBe(monday);
    expect(pickAt(SUNDAY, "23:59")?.id).toBe(monday);
  });

  it("picks the latest of several events on that weekday from a week ago", () => {
    addEvent("08:00", MONDAY, 1);
    const evening = addEvent("20:00", MONDAY, 2);

    expect(pickAt(MONDAY, "07:00")?.id).toBe(evening);
  });

  it("still prefers an event that has started today", () => {
    addEvent("20:00", MONDAY, 2);
    const morning = addEvent("06:00", MONDAY, 1);

    expect(pickAt(MONDAY, "07:00")?.id).toBe(morning);
  });

  it("leaves schedules spread over the week unchanged", () => {
    const sunday = addEvent("22:00", SUNDAY, 1);
    addEvent("08:00", MONDAY, 2);

    expect(pickAt(MONDAY, "07:00")?.id).toBe(sunday);
  });

  it("returns nothing only when there is no enabled event at all", () => {
    expect(pickAt(MONDAY, "07:00")).toBeNull();
  });
});
