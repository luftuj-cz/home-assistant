import { getDatabase, getValveGroup, setupDatabase } from "../database.js";
import { cachedStatement } from "./statementCache.js";

/**
 * Rooms for automatic control (LUFTaTOR Algo CO2): supply valves and CO2 sources.
 *
 * A room is its own structure, not a valve group: groups are a planning aid and may be edited for a plan at
 * any time. A valve and a sensor entity each belong to at most one room. A room needs at least one source and
 * one valve to be set up; only set-up rooms reach the engine.
 */
export interface RoomSensor {
  entityId: string;
  /** The attribute holding the CO2 value, or null for the entity's state. */
  attribute: string | null;
}

export interface Room {
  id: number;
  name: string;
  sortOrder: number;
  valves: string[];
  sensors: RoomSensor[];
  setUp: boolean;
}

export interface RoomInput {
  name: string;
  sortOrder?: number;
  valves: string[];
  sensors: RoomSensor[];
}

export type RoomConflictKind = "name" | "valve" | "sensor";

/** A name, valve or sensor entity already used elsewhere. `value` names it. */
export class RoomConflictError extends Error {
  constructor(
    public readonly kind: RoomConflictKind,
    public readonly value: string,
  ) {
    super(`Room ${kind} "${value}" is already in use`);
    this.name = "RoomConflictError";
  }
}

interface RoomRecord {
  id: number;
  name: string;
  sort_order: number;
}

function db() {
  if (!getDatabase()) setupDatabase();
  const database = getDatabase();
  if (!database) throw new Error("Database not initialised");
  return database;
}

function readRooms(where: string, ...params: unknown[]): Room[] {
  const database = db();
  const records = cachedStatement(
    database,
    `SELECT id, name, sort_order FROM rooms ${where} ORDER BY sort_order, id`,
  ).all(...params) as RoomRecord[];
  if (records.length === 0) return [];

  const valveRows = cachedStatement(
    database,
    "SELECT entity_id, room_id FROM room_valves ORDER BY entity_id",
  ).all() as { entity_id: string; room_id: number }[];
  const sensorRows = cachedStatement(
    database,
    "SELECT entity_id, attribute, room_id FROM room_sensors ORDER BY id",
  ).all() as { entity_id: string; attribute: string | null; room_id: number }[];

  return records.map((record) => {
    const valves = valveRows.filter((row) => row.room_id === record.id).map((row) => row.entity_id);
    const sensors = sensorRows
      .filter((row) => row.room_id === record.id)
      .map((row) => ({ entityId: row.entity_id, attribute: row.attribute }));
    return {
      id: record.id,
      name: record.name,
      sortOrder: record.sort_order,
      valves,
      sensors,
      setUp: valves.length > 0 && sensors.length > 0,
    };
  });
}

export function listRooms(): Room[] {
  return readRooms("");
}

export function getRoom(id: number): Room | null {
  return readRooms("WHERE id = ?", id)[0] ?? null;
}

/** Valve and sensor entities owned by rooms other than `roomId`. */
function ownedElsewhere(roomId: number | null) {
  const database = db();
  const valves = cachedStatement(
    database,
    "SELECT entity_id FROM room_valves WHERE room_id IS NOT ?",
  ).all(roomId) as { entity_id: string }[];
  const sensors = cachedStatement(
    database,
    "SELECT entity_id FROM room_sensors WHERE room_id IS NOT ?",
  ).all(roomId) as { entity_id: string }[];
  return {
    valves: new Set(valves.map((row) => row.entity_id)),
    sensors: new Set(sensors.map((row) => row.entity_id)),
  };
}

function assertFree(roomId: number | null, input: RoomInput): void {
  const database = db();
  const sameName = cachedStatement(database, "SELECT id FROM rooms WHERE name = ?").get(
    input.name,
  ) as { id: number } | undefined;
  if (sameName && sameName.id !== roomId) throw new RoomConflictError("name", input.name);

  const owned = ownedElsewhere(roomId);
  for (const valve of input.valves) {
    if (owned.valves.has(valve)) throw new RoomConflictError("valve", valve);
  }
  const seen = new Set<string>();
  for (const sensor of input.sensors) {
    if (owned.sensors.has(sensor.entityId) || seen.has(sensor.entityId)) {
      throw new RoomConflictError("sensor", sensor.entityId);
    }
    seen.add(sensor.entityId);
  }
}

function writeMembers(roomId: number, input: RoomInput): void {
  const database = db();
  cachedStatement(database, "DELETE FROM room_valves WHERE room_id = ?").run(roomId);
  cachedStatement(database, "DELETE FROM room_sensors WHERE room_id = ?").run(roomId);
  const insertValve = cachedStatement(
    database,
    "INSERT INTO room_valves (entity_id, room_id) VALUES (?, ?)",
  );
  for (const valve of new Set(input.valves)) insertValve.run(valve, roomId);
  const insertSensor = cachedStatement(
    database,
    "INSERT INTO room_sensors (room_id, entity_id, attribute) VALUES (?, ?, ?)",
  );
  for (const sensor of input.sensors) {
    insertSensor.run(roomId, sensor.entityId, sensor.attribute || null);
  }
}

export function createRoom(input: RoomInput): Room {
  const database = db();
  const id = database.transaction(() => {
    assertFree(null, input);
    const result = cachedStatement(
      database,
      "INSERT INTO rooms (name, sort_order) VALUES (?, ?)",
    ).run(input.name, input.sortOrder ?? 0);
    const roomId = Number(result.lastInsertRowid);
    writeMembers(roomId, input);
    return roomId;
  })();
  return getRoom(id) as Room;
}

/** Replaces the room's name, order, valves and sensors. Null when the room does not exist. */
export function updateRoom(id: number, input: RoomInput): Room | null {
  const database = db();
  const found = database.transaction(() => {
    if (!cachedStatement(database, "SELECT id FROM rooms WHERE id = ?").get(id)) return false;
    assertFree(id, input);
    cachedStatement(database, "UPDATE rooms SET name = ?, sort_order = ? WHERE id = ?").run(
      input.name,
      input.sortOrder ?? 0,
      id,
    );
    writeMembers(id, input);
    return true;
  })();
  return found ? getRoom(id) : null;
}

/** Deletes the room; its valves and sensor entities are free again. False when it did not exist. */
export function deleteRoom(id: number): boolean {
  const result = cachedStatement(db(), "DELETE FROM rooms WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Adds a valve group's valves to the room, once: valves in another room are skipped, and the room is not
 * linked to the group afterwards. Null when the room or the group does not exist.
 */
export function addGroupToRoom(roomId: number, groupId: number): Room | null {
  const room = getRoom(roomId);
  const group = getValveGroup(groupId);
  if (!room || !group) return null;
  const owned = ownedElsewhere(roomId).valves;
  const added = group.entityIds.filter((valve) => !owned.has(valve));
  return updateRoom(roomId, { ...room, valves: [...room.valves, ...added] });
}
