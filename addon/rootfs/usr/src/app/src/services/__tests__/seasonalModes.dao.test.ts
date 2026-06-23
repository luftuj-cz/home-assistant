import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempDatabase } from "./testDb.js";

type TestDatabase = Awaited<ReturnType<typeof setupTempDatabase>>;

describe("seasonal modes DAO", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await setupTempDatabase();
    testDb.database.upsertTimelineMode({
      id: 1,
      name: "Global base",
      power: 10,
    });
    testDb.database.upsertTimelineMode({
      id: 2,
      name: "Unit base",
      hruId: "unit-a",
      power: 20,
    });
  });

  afterEach(() => {
    testDb.cleanup();
  });

  it("upserts one global row per season", () => {
    testDb.database.upsertSeasonalMode({
      season: "summer",
      hruId: null,
      baseModeId: 1,
      power: 30,
      enabled: true,
    });
    testDb.database.upsertSeasonalMode({
      season: "summer",
      hruId: null,
      baseModeId: 1,
      power: 40,
      enabled: true,
    });

    const rows = testDb.db
      .prepare("SELECT season, hru_id, power FROM timeline_seasons WHERE season = 'summer'")
      .all() as Array<{ hru_id: string; power: number }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.hru_id).toBe("__global__");
    expect(rows[0]?.power).toBe(40);
    expect(testDb.database.getSeasonalMode("summer", null)?.hruId).toBeNull();
  });

  it("prefers unit row and falls back to global row", () => {
    testDb.database.upsertSeasonalMode({
      season: "winter",
      hruId: null,
      baseModeId: 1,
      power: 10,
      enabled: true,
    });
    testDb.database.upsertSeasonalMode({
      season: "winter",
      hruId: "unit-a",
      baseModeId: 2,
      power: 20,
      enabled: true,
    });

    expect(testDb.database.getSeasonalMode("winter", "unit-a")?.baseModeId).toBe(2);
    expect(testDb.database.getSeasonalMode("winter", "unit-missing")?.baseModeId).toBe(1);
  });

  it("deletes only the exact requested key", () => {
    testDb.database.upsertSeasonalMode({
      season: "spring",
      hruId: null,
      baseModeId: 1,
      enabled: true,
    });
    testDb.database.upsertSeasonalMode({
      season: "spring",
      hruId: "unit-a",
      baseModeId: 2,
      enabled: true,
    });

    testDb.database.deleteSeasonalMode("spring", "unit-a");
    expect(testDb.database.getSeasonalMode("spring", "unit-a")?.hruId).toBeNull();

    testDb.database.deleteSeasonalMode("spring", null);
    expect(testDb.database.getSeasonalMode("spring", "unit-a")).toBeNull();
  });

  it("lists global and unit-specific seasonal rows without exposing the sentinel", () => {
    testDb.database.upsertSeasonalMode({
      season: "autumn",
      hruId: null,
      baseModeId: 1,
      enabled: true,
    });
    testDb.database.upsertSeasonalMode({
      season: "summer",
      hruId: "unit-a",
      baseModeId: 2,
      enabled: true,
    });

    const rows = testDb.database.listSeasonalModes("unit-a");

    expect(rows.map((row) => row.hruId).toSorted()).toEqual([null, "unit-a"]);
  });
});
