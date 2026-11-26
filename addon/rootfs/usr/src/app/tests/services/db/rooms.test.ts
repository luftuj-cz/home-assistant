import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDatabaseAt, makeTempDir, openApplicationDatabase } from "../../helpers/legacyDb.js";
import { setupTempDatabase } from "../../helpers/testDb.js";

type DatabaseModule = typeof import("../../../src/services/database.js");
type RoomsModule = typeof import("../../../src/services/db/rooms.js");

describe("migration 018_automatic_mode", () => {
  it("only creates tables and indexes", async () => {
    const { migrations } = await import("../../../src/services/db/migrations.js");
    const migration = migrations.find((candidate) => candidate.id === "018_automatic_mode");
    expect(migration).toBeDefined();
    for (const statement of migration!.statements) {
      const sql = statement.trim().toUpperCase();
      expect(sql).toMatch(/^CREATE (TABLE|INDEX) IF NOT EXISTS\b/);
    }
  });

  it("adds the tables to a database from the previous version and keeps its data", async () => {
    const temp = makeTempDir("luftator-automatic-");
    try {
      const legacy = buildDatabaseAt(temp.dbPath, "017_control_mode");
      legacy.prepare("INSERT INTO valve_groups (name) VALUES ('Přízemí')").run();
      legacy.close();

      const app = await openApplicationDatabase(temp.dbPath);
      try {
        const tables = app.db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => (row as { name: string }).name);
        expect(tables).toEqual(
          expect.arrayContaining(["rooms", "room_valves", "room_sensors", "automatic_journal"]),
        );
        expect(app.db.prepare("SELECT COUNT(*) AS n FROM valve_groups").get()).toEqual({ n: 1 });
      } finally {
        app.cleanup();
      }
    } finally {
      temp.remove();
    }
  });
});

describe("rooms store", () => {
  let cleanup: () => void;
  let database: DatabaseModule;
  let rooms: RoomsModule;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    database = temp.database as DatabaseModule;
    rooms = await import("../../../src/services/db/rooms.js");
  });

  afterEach(() => cleanup());

  function obyvak() {
    return rooms.createRoom({
      name: "Obývák",
      valves: ["number.luftator_obyvak_1", "number.luftator_obyvak_2"],
      sensors: [
        { entityId: "sensor.obyvak_co2", attribute: null },
        { entityId: "sensor.obyvak_vzduch", attribute: "co2" },
      ],
    });
  }

  it("creates a room with a state source and an attribute source", () => {
    const room = obyvak();
    expect(rooms.listRooms()).toEqual([
      {
        id: room.id,
        name: "Obývák",
        sortOrder: 0,
        valves: ["number.luftator_obyvak_1", "number.luftator_obyvak_2"],
        sensors: [
          { entityId: "sensor.obyvak_co2", attribute: null },
          { entityId: "sensor.obyvak_vzduch", attribute: "co2" },
        ],
        setUp: true,
      },
    ]);
  });

  it("rejects a duplicate name", () => {
    obyvak();
    expect(() => rooms.createRoom({ name: "Obývák", valves: [], sensors: [] })).toThrow(
      rooms.RoomConflictError,
    );
    expect(rooms.listRooms()).toHaveLength(1);
  });

  it("rejects a valve that belongs to another room and leaves that room unchanged", () => {
    obyvak();
    const loznice = rooms.createRoom({ name: "Ložnice", valves: [], sensors: [] });
    expect(() =>
      rooms.updateRoom(loznice.id, {
        name: "Ložnice",
        valves: ["number.luftator_obyvak_1"],
        sensors: [],
      }),
    ).toThrow(expect.objectContaining({ kind: "valve", value: "number.luftator_obyvak_1" }));
    expect(rooms.getRoom(loznice.id)?.valves).toEqual([]);
  });

  it("rejects the same sensor entity with another attribute in another room", () => {
    obyvak();
    expect(() =>
      rooms.createRoom({
        name: "Ložnice",
        valves: [],
        sensors: [{ entityId: "sensor.obyvak_vzduch", attribute: "co2_2" }],
      }),
    ).toThrow(expect.objectContaining({ kind: "sensor" }));
  });

  it("rejects one sensor entity twice in the same room", () => {
    expect(() =>
      rooms.createRoom({
        name: "Ložnice",
        valves: [],
        sensors: [
          { entityId: "sensor.x", attribute: null },
          { entityId: "sensor.x", attribute: "co2" },
        ],
      }),
    ).toThrow(expect.objectContaining({ kind: "sensor", value: "sensor.x" }));
  });

  it("lets a room keep its own valves and sensors when it is updated", () => {
    const room = obyvak();
    const updated = rooms.updateRoom(room.id, { ...room, name: "Obývací pokoj" });
    expect(updated?.name).toBe("Obývací pokoj");
    expect(updated?.valves).toEqual(room.valves);
  });

  it("is set up only with a sensor and a valve", () => {
    const noSensor = rooms.createRoom({ name: "Koupelna", valves: ["v1"], sensors: [] });
    const noValve = rooms.createRoom({
      name: "Pracovna",
      valves: [],
      sensors: [{ entityId: "sensor.p", attribute: null }],
    });
    expect(noSensor.setUp).toBe(false);
    expect(noValve.setUp).toBe(false);
  });

  it("adds a group's valves as a copy, skipping valves owned by another room", () => {
    const group = database.upsertValveGroup({ name: "Přízemí" });
    database.setGroupMembers(group.id, ["a", "b"]);
    rooms.createRoom({ name: "Ložnice", valves: ["b"], sensors: [] });
    const room = rooms.createRoom({ name: "Obývák", valves: [], sensors: [] });

    expect(rooms.addGroupToRoom(room.id, group.id)?.valves).toEqual(["a"]);

    database.setGroupMembers(group.id, ["a", "b", "c"]);
    expect(rooms.getRoom(room.id)?.valves).toEqual(["a"]);
  });

  it("frees the valves and sensors of a deleted room", () => {
    const room = obyvak();
    expect(rooms.deleteRoom(room.id)).toBe(true);
    const again = rooms.createRoom({
      name: "Jiná",
      valves: ["number.luftator_obyvak_1"],
      sensors: [{ entityId: "sensor.obyvak_co2", attribute: null }],
    });
    expect(again.setUp).toBe(true);
    expect(rooms.deleteRoom(room.id)).toBe(false);
  });
});
