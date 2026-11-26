import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDatabaseAt, makeTempDir, openApplicationDatabase } from "../../helpers/legacyDb.js";

/** 019: custom timeline events may hold Automatika (mode_id NULL); existing events survive the rebuild. */
describe("migration 019_custom_events_automatic", () => {
  let temp: ReturnType<typeof makeTempDir>;

  beforeEach(() => {
    temp = makeTempDir("luftator-custom-automatic-");
  });

  afterEach(() => temp.remove());

  it("keeps every event and its keys, and accepts an event without a mode", async () => {
    const legacy = buildDatabaseAt(temp.dbPath, "018_automatic_mode");
    legacy
      .prepare(
        `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id) VALUES (1, 'Útlum', '#000', 0, 'atrea-am')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO custom_timelines (id, hru_id, name, name_key) VALUES (5, 'atrea-am', 'Dovolená', 'dovolená')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO custom_timeline_events (id, custom_timeline_id, mode_id, day_of_week, start_time)
         VALUES (9, 5, 1, 2, '07:30')`,
      )
      .run();
    legacy.close();

    const app = await openApplicationDatabase(temp.dbPath);
    try {
      expect(app.db.prepare("SELECT * FROM custom_timeline_events").all()).toEqual([
        expect.objectContaining({
          id: 9,
          custom_timeline_id: 5,
          mode_id: 1,
          day_of_week: 2,
          start_time: "07:30",
        }),
      ]);
      app.db
        .prepare(
          `INSERT INTO custom_timeline_events (custom_timeline_id, mode_id, start_time) VALUES (5, NULL, '20:00')`,
        )
        .run();
      // Deleting the timeline still removes its events (the foreign key survived the rebuild).
      app.db.prepare("DELETE FROM custom_timelines WHERE id = 5").run();
      expect(app.db.prepare("SELECT COUNT(*) AS n FROM custom_timeline_events").get()).toEqual({
        n: 0,
      });
      const indexes = app.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'custom_timeline_events'",
        )
        .all();
      expect(indexes).toEqual([{ name: "idx_custom_timeline_events_timeline" }]);
    } finally {
      app.cleanup();
    }
  });
});
