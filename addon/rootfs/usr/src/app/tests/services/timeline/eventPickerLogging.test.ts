import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type DatabaseModule = typeof import("../../../src/services/database.js");
type PickerModule = typeof import("../../../src/services/timeline/eventPicker.js");

const UNIT = "atrea-am";
const DROP_MESSAGE = "pickActiveEvent: dropping events whose mode cannot be resolved";

/**
 * An enabled event whose mode cannot be resolved means the schedule is losing
 * entries, so it has to be reported at error level. It also has to stay
 * readable: the scheduler ticks every ten seconds and the picker walks seven
 * days per tick, so reporting per day per tick produced tens of thousands of
 * identical lines a day - in the log and in the bug-report bundle.
 */
describe("pickActiveEvent reporting of unresolvable events", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let database: DatabaseModule;
  let picker: PickerModule;
  let errors: string[];

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    database = temp.database as DatabaseModule;

    errors = [];
    const logger = {
      error: (context: unknown, message?: string) => {
        errors.push(message ?? String(context));
      },
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    // setupDatabase returns early while a handle is open, so the logger is
    // attached by reopening: getModuleLogger() is what the picker reports
    // through, and without it the assertions below would pass vacuously.
    database.closeDatabase();
    database.setupDatabase(logger as never);
    db = database.getDatabase()!;

    db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       VALUES ('spring', ?, '01-01', '12-31', 1, 0)`,
    ).run(UNIT);

    picker = await import("../../../src/services/timeline/eventPicker.js");
  });

  afterEach(() => {
    cleanup();
  });

  function addEvent(startTime: string, mode: string) {
    db.prepare(
      `INSERT INTO timeline_events
         (start_time, day_of_week, hru_config, enabled, priority, hru_id, timeline_id)
       VALUES (?, NULL, ?, 1, 0, ?, ?)`,
    ).run(startTime, JSON.stringify({ mode }), UNIT, database.getActiveSeasonId(UNIT));
  }

  function dropReports() {
    return errors.filter((message) => message.includes(DROP_MESSAGE)).length;
  }

  it("reports once per call, not once per weekday", () => {
    addEvent("06:00", "999");

    picker.pickActiveEvent(UNIT, 7 * 60, 1);

    expect(dropReports()).toBe(1);
  });

  it("does not repeat itself while the condition is unchanged", () => {
    addEvent("06:00", "999");

    for (let tick = 0; tick < 5; tick++) {
      picker.pickActiveEvent(UNIT, 7 * 60, 1);
    }

    expect(dropReports()).toBe(1);
  });

  it("reports again when a different event becomes unresolvable", () => {
    addEvent("06:00", "999");
    picker.pickActiveEvent(UNIT, 7 * 60, 1);

    addEvent("18:00", "998");
    picker.pickActiveEvent(UNIT, 7 * 60, 1);

    expect(dropReports()).toBe(2);
  });

  it("says nothing when every mode resolves", () => {
    db.prepare(
      `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id)
       VALUES (1, 'Komfort', '#1971c2', 0, ?)`,
    ).run(UNIT);
    db.prepare(
      `INSERT INTO timeline_mode_values (mode_id, timeline_id, power) VALUES (1, ?, 60)`,
    ).run(database.getActiveSeasonId(UNIT));
    addEvent("06:00", "1");

    picker.pickActiveEvent(UNIT, 7 * 60, 1);

    expect(dropReports()).toBe(0);
  });
});
