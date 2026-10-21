import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type DatabaseModule = typeof import("../../../src/services/database.js");
type StoreModule = typeof import("../../../src/services/db/customTimelines.js");

const UNIT = "atrea-am";

describe("migration 016_custom_timelines", () => {
  it("only adds: no DROP, no rebuild, no rewrite of existing rows", async () => {
    const { migrations } = await import("../../../src/services/db/migrations.js");
    const migration = migrations.find((candidate) => candidate.id === "016_custom_timelines");
    expect(migration).toBeDefined();

    for (const statement of migration!.statements) {
      const sql = statement.replace(/--.*$/gm, "").trim().toUpperCase();
      expect(sql).not.toMatch(/\bDROP\b/);
      expect(sql).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\b/);
      expect(sql).not.toMatch(/\bRENAME\b/);
      const isNewTable = sql.startsWith("CREATE TABLE IF NOT EXISTS CUSTOM_");
      const isNewIndex = /^CREATE (UNIQUE )?INDEX IF NOT EXISTS IDX_CUSTOM_/.test(sql);
      const isAddColumn = /^ALTER TABLE \w+ ADD COLUMN\b/.test(sql);
      expect(isNewTable || isNewIndex || isAddColumn).toBe(true);
    }
  });
});

describe("custom timeline store", () => {
  let cleanup: () => void;
  let db: DatabaseType;
  let database: DatabaseModule;
  let store: StoreModule;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    db = temp.db;
    database = temp.database as DatabaseModule;
    store = await import("../../../src/services/db/customTimelines.js");

    for (const [id, name] of [
      [1, "Útlum"],
      [2, "Komfort"],
    ] as const) {
      db.prepare(
        `INSERT INTO timeline_modes (id, name, color, is_boost, hru_id)
         VALUES (?, ?, '#1971c2', 0, ?)`,
      ).run(id, name, UNIT);
    }
  });

  afterEach(() => {
    cleanup();
  });

  function addEvent(customTimelineId: number, modeId: number, startTime = "08:00", enabled = true) {
    return store.upsertCustomTimelineEvent({
      customTimelineId,
      modeId,
      dayOfWeek: null,
      startTime,
      enabled,
      priority: 0,
    });
  }

  function eventCount(): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM custom_timeline_events`).get() as { n: number })
      .n;
  }

  it("creates an empty timeline for the unit", () => {
    const created = store.createCustomTimeline(UNIT, "Dovolená");

    expect(store.getCustomTimelines(UNIT)).toEqual([
      { ...created, enabledEvents: 0, totalEvents: 0 },
    ]);
    expect(store.getCustomTimelineEvents(created.id)).toEqual([]);
  });

  it("refuses a duplicate name within the unit, ignoring case", () => {
    store.createCustomTimeline(UNIT, "Dovolená");

    expect(() => store.createCustomTimeline(UNIT, "dovolená")).toThrow(
      store.CustomTimelineNameTakenError,
    );
    expect(() => store.createCustomTimeline("other-unit", "Dovolená")).not.toThrow();
  });

  it("refuses a rename onto another timeline's name", () => {
    store.createCustomTimeline(UNIT, "Dovolená");
    const chata = store.createCustomTimeline(UNIT, "Chata");

    expect(() => store.renameCustomTimeline(chata.id, "DOVOLENÁ")).toThrow(
      store.CustomTimelineNameTakenError,
    );
    expect(store.renameCustomTimeline(chata.id, "Chalupa")?.name).toBe("Chalupa");
  });

  it("deleting a mode removes its custom events through the foreign key", () => {
    const timeline = store.createCustomTimeline(UNIT, "Dovolená");
    addEvent(timeline.id, 1, "08:00");
    addEvent(timeline.id, 2, "20:00");

    database.deleteTimelineMode(1);

    const remaining = store.getCustomTimelineEvents(timeline.id);
    expect(remaining.map((event) => event.modeId)).toEqual([2]);
  });

  it("deleting a timeline removes its events", () => {
    const timeline = store.createCustomTimeline(UNIT, "Dovolená");
    const other = store.createCustomTimeline(UNIT, "Chata");
    addEvent(timeline.id, 1);
    addEvent(other.id, 1);

    store.deleteCustomTimeline(timeline.id);

    expect(store.getCustomTimeline(timeline.id)).toBeNull();
    expect(eventCount()).toBe(1);
  });

  it("an update naming another timeline's event changes nothing", () => {
    const dovolena = store.createCustomTimeline(UNIT, "Dovolená");
    const chata = store.createCustomTimeline(UNIT, "Chata");
    const event = addEvent(dovolena.id, 1, "08:00");

    store.upsertCustomTimelineEvent({ ...event, customTimelineId: chata.id, startTime: "09:00" });
    store.deleteCustomTimelineEvent(chata.id, event.id!);

    expect(store.getCustomTimelineEvent(dovolena.id, event.id!)?.startTime).toBe("08:00");
  });

  it("replaces all events at once", () => {
    const timeline = store.createCustomTimeline(UNIT, "Dovolená");
    addEvent(timeline.id, 1, "08:00");
    addEvent(timeline.id, 2, "20:00");

    store.replaceCustomTimelineEvents(timeline.id, [
      { modeId: 2, dayOfWeek: null, startTime: "00:00", enabled: true, priority: 0 },
    ]);

    const events = store.getCustomTimelineEvents(timeline.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ modeId: 2, startTime: "00:00", dayOfWeek: null });
  });

  it("reports modes in use by enabled events only", () => {
    const timeline = store.createCustomTimeline(UNIT, "Dovolená");
    addEvent(timeline.id, 1, "08:00");
    addEvent(timeline.id, 2, "20:00", false);

    expect(store.getModeIdsUsedByCustomTimelines(UNIT)).toEqual([1]);
    expect(store.countEnabledCustomEvents(timeline.id)).toBe(1);
  });

  it("reports per-timeline mode usage and which timelines would be left empty", () => {
    const dovolena = store.createCustomTimeline(UNIT, "Dovolená");
    const chata = store.createCustomTimeline(UNIT, "Chata");
    addEvent(dovolena.id, 1, "08:00");
    addEvent(chata.id, 1, "08:00");
    addEvent(chata.id, 2, "20:00");

    expect(store.getCustomModeUsage(UNIT, 1)).toEqual([
      { customTimelineId: chata.id, name: "Chata", enabledEvents: 1, wouldBeLeftEmpty: false },
      { customTimelineId: dovolena.id, name: "Dovolená", enabledEvents: 1, wouldBeLeftEmpty: true },
    ]);
  });

  it("maps an event to the picker's shape with the mode referenced by id", () => {
    const timeline = store.createCustomTimeline(UNIT, "Dovolená");
    const event = addEvent(timeline.id, 2, "06:30");

    expect(store.toTimelineEvent(event, UNIT)).toMatchObject({
      id: event.id,
      startTime: "06:30",
      dayOfWeek: null,
      hruConfig: { mode: 2 },
      enabled: true,
      hruId: UNIT,
    });
  });
});
