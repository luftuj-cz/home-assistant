import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempDatabase } from "../helpers/testDb.js";
import { serveRouters, silentLogger, type ServedRouter } from "../helpers/httpRouter.js";

type DatabaseModule = typeof import("../../src/services/database.js");

const UNIT = "atrea-am";
const SOURCE = 1;
const OTHER_UNIT_MODE = 2;
const URL = "/api/timeline/modes";

/** `POST /modes?duplicateOf=` - the duplicate dialog's save. */
describe("duplicating a mode through the API", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let database: DatabaseModule;
  let api: ServedRouter;
  let springId: number;
  let summerId: number;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    database = temp.database as DatabaseModule;

    database.setAppSetting("hru.settings", JSON.stringify({ unit: UNIT }));
    const insertSeason = db.prepare(
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       VALUES (?, ?, ?, ?, 1, ?)`,
    );
    springId = Number(insertSeason.run("spring", UNIT, "01-01", "06-30", 0).lastInsertRowid);
    summerId = Number(insertSeason.run("summer", UNIT, "07-01", "12-31", 1).lastInsertRowid);

    const insertMode = db.prepare(
      `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id) VALUES (?, ?, '#1971c2', 0, ?)`,
    );
    insertMode.run(SOURCE, "Komfort", UNIT);
    insertMode.run(OTHER_UNIT_MODE, "Cizí", "zehnder");
    db.prepare(
      `INSERT INTO timeline_mode_values (mode_id, timeline_id, power) VALUES (?, ?, 60)`,
    ).run(SOURCE, springId);

    const { createTimelineRouter } = await import("../../src/routes/timeline.js");
    api = await serveRouters({
      "/api/timeline": createTimelineRouter(
        silentLogger() as never,
        {} as never,
        { getAllUnits: () => [{ id: UNIT }] } as never,
        { refreshDiscovery: vi.fn(async () => undefined) } as never,
      ),
    });
  });

  afterEach(async () => {
    await api.close();
    cleanup();
  });

  // Scripts only, so the payload needs no HRU validation.
  const dialogValues = { name: "Komfort (kopie)", scriptEntityIds: ["script.okno"] };

  function modeCount(): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM timeline_modes`).get() as { n: number }).n;
  }

  it("creates the mode with the source's values in the other seasons", async () => {
    const result = await api.call(
      "POST",
      `${URL}?seasonId=${summerId}&duplicateOf=${SOURCE}`,
      dialogValues,
    );

    expect(result.status).toBe(201);
    const id = result.body!.id as number;
    const inSpring = database.getTimelineModes(UNIT, springId).find((mode) => mode.id === id);
    const inSummer = database.getTimelineModes(UNIT, summerId).find((mode) => mode.id === id);
    expect(inSpring).toMatchObject({ power: 60, configured: true });
    expect(inSummer).toMatchObject({ scriptEntityIds: ["script.okno"], configured: true });
  });

  it("accepts a source stored without a unit, which the mode list shows as shared", async () => {
    db.prepare(
      `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id) VALUES (3, 'Sdílený', '#1971c2', 0, '')`,
    ).run();

    const result = await api.call(
      "POST",
      `${URL}?seasonId=${summerId}&duplicateOf=3`,
      dialogValues,
    );

    expect(result.status).toBe(201);
  });

  it("refuses a source from another unit and creates nothing", async () => {
    const before = modeCount();

    const result = await api.call(
      "POST",
      `${URL}?seasonId=${summerId}&duplicateOf=${OTHER_UNIT_MODE}`,
      dialogValues,
    );

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ code: "MODE_NOT_FOUND" });
    expect(modeCount()).toBe(before);
  });

  it("refuses a source that does not exist", async () => {
    const result = await api.call(
      "POST",
      `${URL}?seasonId=${summerId}&duplicateOf=999`,
      dialogValues,
    );

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ code: "MODE_NOT_FOUND" });
  });

  it("refuses a source id that is not a number", async () => {
    const result = await api.call(
      "POST",
      `${URL}?seasonId=${summerId}&duplicateOf=abc`,
      dialogValues,
    );

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "INVALID_MODE_ID" });
  });

  it("refuses a source id given more than once instead of picking one", async () => {
    const before = modeCount();

    const result = await api.call(
      "POST",
      `${URL}?seasonId=${summerId}&duplicateOf=${SOURCE}&duplicateOf=${OTHER_UNIT_MODE}`,
      dialogValues,
    );

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "INVALID_MODE_ID" });
    expect(modeCount()).toBe(before);
  });
});
