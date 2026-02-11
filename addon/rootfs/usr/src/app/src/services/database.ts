/* eslint-disable quotes */
import { Database } from "bun:sqlite";
import type { Statement } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { promises as fsp } from "fs";
import path from "path";
import type { Logger } from "pino";
import { TIMELINE_MODES_KEY, type TimelineMode } from "../types";

const DEFAULT_DATA_DIR = "/data";
const IS_HA_ADDON = Boolean(process.env.SUPERVISOR_TOKEN);
const PROJECT_DATA_DIR = path.resolve(process.cwd(), "data");

const dataDir = (() => {
  if (process.env.LUFTATOR_DB_PATH) {
    return path.dirname(process.env.LUFTATOR_DB_PATH);
  }
  if (IS_HA_ADDON && existsSync(DEFAULT_DATA_DIR)) {
    return DEFAULT_DATA_DIR;
  }
  // Fallback to local project data directory for development
  return PROJECT_DATA_DIR;
})();

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const DATABASE_PATH = process.env.LUFTATOR_DB_PATH ?? path.join(dataDir, "luftator.db");

interface Migration {
  id: string;
  statements: string[];
}

const migrations: Migration[] = [
  {
    id: "001_initial",
    statements: [
      `CREATE TABLE IF NOT EXISTS controllers (
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS valve_state (
        entity_id TEXT PRIMARY KEY,
        controller_id TEXT,
        name TEXT,
        value REAL,
        state TEXT,
        last_updated TEXT NOT NULL,
        attributes TEXT,
        FOREIGN KEY (controller_id) REFERENCES controllers(id)
      )`,
      `CREATE TABLE IF NOT EXISTS valve_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id TEXT NOT NULL,
        controller_id TEXT,
        name TEXT,
        value REAL,
        state TEXT,
        recorded_at TEXT NOT NULL,
        attributes TEXT,
        FOREIGN KEY (controller_id) REFERENCES controllers(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_valve_history_entity_id_recorded_at
        ON valve_history(entity_id, recorded_at DESC)`,
    ],
  },
  {
    id: "002_app_settings",
    statements: [
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
  },
  {
    id: "003_timeline_events",
    statements: [
      `CREATE TABLE IF NOT EXISTS timeline_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_time TEXT NOT NULL, -- HH:MM format
        end_time TEXT, -- Legacy field, removed by 004
        day_of_week INTEGER, -- 0-6 (Sunday=0), NULL for all days
        hru_config TEXT, -- JSON: {mode, power, temperature}
        luftator_config TEXT, -- JSON: {entity_id: value}
        enabled BOOLEAN NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0, -- higher wins conflicts
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS idx_timeline_events_day_time ON timeline_events(day_of_week, start_time, enabled)`,
    ],
  },
  {
    id: "004_remove_legacy_end_time",
    statements: [`ALTER TABLE timeline_events DROP COLUMN end_time;`],
  },
  {
    id: "005_add_hru_id_to_timeline",
    statements: [
      `ALTER TABLE timeline_events ADD COLUMN hru_id TEXT;`,
      `CREATE INDEX IF NOT EXISTS idx_timeline_events_hru_id ON timeline_events(hru_id);`,
    ],
  },
  {
    id: "006_extract_modes_table",
    statements: [
      `CREATE TABLE IF NOT EXISTS timeline_modes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT,
        power REAL,
        temperature REAL,
        luftator_config TEXT,
        is_boost BOOLEAN DEFAULT 0,
        hru_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(name, hru_id)
      );`,
    ],
  },
  {
    id: "007_add_native_mode",
    statements: [`ALTER TABLE timeline_modes ADD COLUMN native_mode INTEGER;`],
  },
];

let db: Database | null = null;

type StatementMap = {
  upsertController: Statement;
  upsertValveState: Statement;
  insertValveHistory: Statement;
  getSetting: Statement;
  upsertSetting: Statement;
  getTimelineEvents: Statement;
  upsertTimelineEvent: Statement;
  deleteTimelineEvent: Statement;
  assignLegacyEvents: Statement;
  deleteEventsByMode: Statement;
  getTimelineModes: Statement;
  upsertTimelineMode: Statement;
  deleteTimelineMode: Statement;
  getTimelineMode: Statement;
};

let moduleLogger: Logger | null = null;
let statements: StatementMap | null = null;

type ValveStateRecord = {
  entity_id: string;
  controller_id: string | null;
  name: string | null;
  value: number | null;
  state: string | null;
  timestamp: string;
  attributes: string;
};

function openDatabase(logger?: Logger): Database {
  const activeLogger = logger || moduleLogger;
  const logMsg = `Opening database at ${DATABASE_PATH}`;

  activeLogger?.info(logMsg);

  try {
    return new Database(DATABASE_PATH, { create: true });
  } catch (error) {
    activeLogger?.error({ error }, "Failed to open database");
    throw error;
  }
}

function applyMigrations(database: Database, logger?: Logger): void {
  const activeLogger = logger || moduleLogger;
  try {
    database.run("PRAGMA journal_mode = WAL;");
  } catch (err) {
    activeLogger?.warn({ err }, "Failed to set WAL mode, falling back to DELETE mode");
    database.run("PRAGMA journal_mode = DELETE;");
  }
  database.run(
    `CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
  );

  const migrationRows = database.query("SELECT id FROM migrations").all() as { id: string }[];
  const existing = new Set(migrationRows.map((row) => row.id));

  const insertMigration = database.prepare("INSERT INTO migrations (id) VALUES (?)");

  for (const migration of migrations) {
    if (existing.has(migration.id)) {
      continue;
    }
    database.run("BEGIN");
    try {
      for (const sql of migration.statements) {
        try {
          database.run(sql);
        } catch (error) {
          if (
            migration.id === "004_remove_legacy_end_time" &&
            String(error).includes("no such column")
          ) {
            activeLogger?.info("Migration 004: end_time column already removed, skipping.");
            continue;
          }
          throw error;
        }
      }
      insertMigration.run(migration.id);
      database.run("COMMIT");
      activeLogger?.info({ migrationId: migration.id }, "Applied database migration");
    } catch (error) {
      database.run("ROLLBACK");
      activeLogger?.error({ error, migrationId: migration.id }, "Migration failed, rolled back");
      throw error;
    }
  }
}

function finalizeStatements(): void {
  if (!statements) {
    return;
  }
  statements.upsertController.finalize();
  statements.upsertValveState.finalize();
  statements.insertValveHistory.finalize();
  statements.getSetting.finalize();
  statements.upsertSetting.finalize();
  statements.getTimelineEvents.finalize();
  statements.upsertTimelineEvent.finalize();
  statements.deleteTimelineEvent.finalize();
  statements = null;
}

function prepareStatements(database: Database): StatementMap {
  return {
    upsertController: database.prepare(
      `INSERT INTO controllers (id, name, created_at, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP`,
    ),
    upsertValveState: database.prepare(
      `INSERT INTO valve_state (entity_id, controller_id, name, value, state, last_updated, attributes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET
         controller_id = excluded.controller_id,
         name = excluded.name,
         value = excluded.value,
         state = excluded.state,
         last_updated = excluded.last_updated,
         attributes = excluded.attributes`,
    ),
    insertValveHistory: database.prepare(
      `INSERT INTO valve_history (entity_id, controller_id, name, value, state, recorded_at, attributes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    getSetting: database.prepare("SELECT value FROM app_settings WHERE key = ?"),
    upsertSetting: database.prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ),
    getTimelineEvents: database.prepare(
      `SELECT id, start_time, day_of_week, hru_config, luftator_config, enabled, priority, hru_id, created_at, updated_at
       FROM timeline_events
       WHERE hru_id = ?
       ORDER BY day_of_week ASC NULLS LAST, start_time ASC, priority DESC`,
    ),
    upsertTimelineEvent: database.prepare(
      `INSERT INTO timeline_events (id, start_time, day_of_week, hru_config, luftator_config, enabled, priority, hru_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         start_time = excluded.start_time,
         day_of_week = excluded.day_of_week,
         hru_config = excluded.hru_config,
         luftator_config = excluded.luftator_config,
         enabled = excluded.enabled,
         priority = excluded.priority,
         hru_id = excluded.hru_id,
         updated_at = datetime("now")`,
    ),
    deleteTimelineEvent: database.prepare(`DELETE FROM timeline_events WHERE id = ?`),
    assignLegacyEvents: database.prepare(
      `UPDATE timeline_events SET hru_id = ? WHERE hru_id IS NULL`,
    ),
    deleteEventsByMode: database.prepare(
      `DELETE FROM timeline_events WHERE CAST(json_extract(hru_config, '$.mode') AS INTEGER) = ?`,
    ),
    getTimelineModes: database.prepare(
      `SELECT * FROM timeline_modes WHERE hru_id = ? OR hru_id IS NULL ORDER BY name ASC`,
    ),
    upsertTimelineMode: database.prepare(
      `INSERT INTO timeline_modes (id, name, color, power, temperature, luftator_config, is_boost, hru_id, native_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         color = excluded.color,
         power = excluded.power,
         temperature = excluded.temperature,
         luftator_config = excluded.luftator_config,
         is_boost = excluded.is_boost,
         hru_id = excluded.hru_id,
         native_mode = excluded.native_mode,
         updated_at = datetime("now")`,
    ),
    deleteTimelineMode: database.prepare(`DELETE FROM timeline_modes WHERE id = ?`),
    getTimelineMode: database.prepare(`SELECT * FROM timeline_modes WHERE id = ?`),
  };
}

export function setupDatabase(logger?: Logger): void {
  moduleLogger = logger || moduleLogger;
  if (statements) {
    finalizeStatements();
  }
  if (db) {
    db.close();
    db = null;
  }

  db = openDatabase(moduleLogger || undefined);
  applyMigrations(db, moduleLogger || undefined);
  statements = prepareStatements(db);

  migrateModesToTable();
}

function migrateModesToTable(): void {
  if (!db || !statements) return;

  const raw = getAppSetting(TIMELINE_MODES_KEY);
  if (!raw) return;

  try {
    const oldModes = JSON.parse(raw) as TimelineMode[];
    if (Array.isArray(oldModes) && oldModes.length > 0) {
      moduleLogger?.info(
        { count: oldModes.length },
        "Migrating modes from JSON settings to SQL table",
      );

      db.transaction(() => {
        for (const mode of oldModes) {
          try {
            statements!.upsertTimelineMode.run(
              mode.id,
              mode.name,
              mode.color ?? null,
              mode.power ?? null,
              mode.temperature ?? null,
              mode.luftatorConfig ? JSON.stringify(mode.luftatorConfig) : null,
              mode.isBoost ? 1 : 0,
              mode.hruId ?? null,
            );
          } catch (err) {
            moduleLogger?.warn(
              { name: mode.name, err },
              "Skipping duplicate mode during migration",
            );
          }
        }
        statements!.upsertSetting.run(TIMELINE_MODES_KEY, "");
      })();
    }
  } catch (err) {
    moduleLogger?.error({ err }, "Failed to migrate modes to table");
  }
}

export interface ValveSnapshotRecord {
  entityId: string;
  controllerId: string | null;
  controllerName?: string | null;
  name: string | null;
  value: number | null;
  state: string | null;
  attributes: Record<string, unknown> | null;
  timestamp?: string;
}

function normaliseRecord(record: ValveSnapshotRecord): ValveStateRecord {
  return {
    entity_id: record.entityId,
    controller_id: record.controllerId,
    name: record.name ?? null,
    value: record.value ?? null,
    state: record.state ?? null,
    attributes: JSON.stringify(record.attributes ?? {}),
    timestamp: record.timestamp ?? new Date().toISOString(),
  };
}

export function storeValveSnapshots(records: ValveSnapshotRecord[]): void {
  if (records.length === 0) {
    return;
  }

  if (!db || !statements) {
    setupDatabase();
  }
  if (!db || !statements) {
    moduleLogger?.error("Database initialisation failed in storeValveSnapshots");
    throw new Error("Database init failed");
  }

  const prepared = statements;

  const transaction = db.transaction((items: ValveSnapshotRecord[]) => {
    for (const item of items) {
      const record = normaliseRecord(item);
      if (record.controller_id) {
        prepared.upsertController.run(record.controller_id, item.controllerName ?? null);
      }
      prepared.upsertValveState.run(
        record.entity_id,
        record.controller_id,
        record.name,
        record.value,
        record.state,
        record.timestamp,
        record.attributes,
      );
      prepared.insertValveHistory.run(
        record.entity_id,
        record.controller_id,
        record.name,
        record.value,
        record.state,
        record.timestamp,
        record.attributes,
      );
    }
  });

  transaction(records);
  moduleLogger?.debug({ count: records.length }, "Stored valve snapshots");
}

export function getDatabasePath(): string {
  return DATABASE_PATH;
}

export function getAppSetting(key: string): string | null {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    moduleLogger?.error({ key }, "Database not initialised in getAppSetting");
    throw new Error("Database not initialised");
  }

  const row = statements.getSetting.get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAppSetting(key: string, value: string): void {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    moduleLogger?.error({ key }, "Database not initialised in setAppSetting");
    throw new Error("Database not initialised");
  }

  statements.upsertSetting.run(key, value);
  moduleLogger?.debug({ key }, "Updated app setting");
}

export interface TimelineEvent {
  id?: number;
  startTime: string; // HH:MM
  dayOfWeek?: number | null; // 0-6 (Sunday=0), null for all days
  hruConfig?: {
    mode?: string | number;
    power?: number;
    temperature?: number;
  } | null;
  luftatorConfig?: Record<string, number> | null;
  enabled: boolean;
  priority: number;
  hruId?: string | null;
}

export interface TimelineEventRecord {
  id: number;
  start_time: string;
  day_of_week: number | null;
  hru_config: string | null;
  luftator_config: string | null;
  enabled: boolean;
  priority: number;
  hru_id: string | null;
  created_at: string;
  updated_at: string;
}

function normaliseTimelineEvent(
  event: TimelineEvent,
): Omit<TimelineEventRecord, "id" | "created_at" | "updated_at"> {
  return {
    start_time: event.startTime,
    day_of_week: event.dayOfWeek ?? null,
    hru_config: event.hruConfig ? JSON.stringify(event.hruConfig) : null,
    luftator_config: event.luftatorConfig ? JSON.stringify(event.luftatorConfig) : null,
    enabled: event.enabled,
    priority: event.priority,
    hru_id: event.hruId ?? null,
  };
}

function denormaliseTimelineEvent(record: TimelineEventRecord): TimelineEvent {
  return {
    id: record.id,
    startTime: record.start_time,
    dayOfWeek: record.day_of_week,
    hruConfig: record.hru_config ? JSON.parse(record.hru_config) : null,
    luftatorConfig: record.luftator_config ? JSON.parse(record.luftator_config) : null,
    enabled: Boolean(record.enabled),
    priority: record.priority,
    hruId: record.hru_id,
  };
}

export function getTimelineEvents(hruId?: string | null): TimelineEvent[] {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    moduleLogger?.error("Database not initialised in getTimelineEvents");
    throw new Error("Database not initialised");
  }

  const targetHruId = hruId ?? "";

  const records = statements.getTimelineEvents.all(targetHruId) as TimelineEventRecord[];
  return records.map(denormaliseTimelineEvent);
}

export interface TimelineModeRecord {
  id: number;
  name: string;
  color: string | null;
  power: number | null;
  temperature: number | null;
  luftator_config: string | null;
  is_boost: number;
  hru_id: string | null;
  native_mode: number | null;
}

export function getTimelineModes(hruId?: string): TimelineMode[] {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    return [];
  }

  const records = statements.getTimelineModes.all(hruId ?? null) as TimelineModeRecord[];

  return records
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color ?? undefined,
      power: r.power ?? undefined,
      temperature: r.temperature ?? undefined,
      luftatorConfig: r.luftator_config ? JSON.parse(r.luftator_config) : undefined,
      isBoost: Boolean(r.is_boost),
      hruId: r.hru_id ?? undefined,
      nativeMode: r.native_mode ?? undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getTimelineMode(id: number): TimelineMode | null {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    return null;
  }

  const record = statements.getTimelineMode.get(id) as TimelineModeRecord | undefined;
  if (!record) return null;

  return {
    id: record.id,
    name: record.name,
    color: record.color ?? undefined,
    power: record.power ?? undefined,
    temperature: record.temperature ?? undefined,
    luftatorConfig: record.luftator_config ? JSON.parse(record.luftator_config) : undefined,
    isBoost: Boolean(record.is_boost),
    hruId: record.hru_id ?? undefined,
    nativeMode: record.native_mode ?? undefined,
  };
}

export function upsertTimelineMode(mode: TimelineMode): TimelineMode {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    throw new Error("Database not initialised");
  }

  const result = statements.upsertTimelineMode.run(
    mode.id ?? null, // Auto-increment if null
    mode.name,
    mode.color ?? null,
    mode.power ?? null,
    mode.temperature ?? null,
    mode.luftatorConfig ? JSON.stringify(mode.luftatorConfig) : null,
    mode.isBoost ? 1 : 0,
    mode.hruId ?? null,
    mode.nativeMode ?? null,
  ) as { lastInsertRowid: number | bigint };

  const id = mode.id ?? Number(result.lastInsertRowid);
  moduleLogger?.debug({ id, name: mode.name }, "Upserted timeline mode");

  return {
    ...mode,
    id,
  };
}

export function deleteTimelineMode(id: number): void {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    throw new Error("Database not initialised");
  }
  statements.deleteTimelineMode.run(id);
  moduleLogger?.debug({ id }, "Deleted timeline mode");
}

export function assignLegacyEventsToUnit(hruId: string): void {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    moduleLogger?.error("Database not initialised in assignLegacyEventsToUnit");
    throw new Error("Database not initialised");
  }

  statements.assignLegacyEvents.run(hruId);
  moduleLogger?.debug({ hruId }, "Assigned legacy events to unit");
}

export function migrateLegacyEventsForUnit(hruId: string): void {
  const modes = getTimelineModes();
  const events = getTimelineEvents(hruId);
  let migratedCount = 0;

  for (const event of events) {
    const rawMode = event.hruConfig?.mode;
    if (rawMode && !/^\d+$/.test(String(rawMode))) {
      // It's a name (e.g. "Vypnuto")
      const foundMode = modes.find((m) => m.name === rawMode);
      if (foundMode) {
        // Update to ID
        const updatedEvent = {
          ...event,
          hruConfig: {
            ...event.hruConfig,
            mode: foundMode.id.toString(),
          },
        };
        upsertTimelineEvent(updatedEvent);
        migratedCount++;
        moduleLogger?.info(
          { eventId: event.id, oldMode: rawMode, newModeId: foundMode.id },
          "Migrated legacy event mode name to ID",
        );
      }
    }
  }

  if (migratedCount > 0) {
    moduleLogger?.info({ count: migratedCount }, "Finished migrating legacy events for unit");
  }
}

export function upsertTimelineEvent(event: TimelineEvent): TimelineEvent {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    moduleLogger?.error({ eventId: event.id }, "Database not initialised in upsertTimelineEvent");
    throw new Error("Database not initialised");
  }

  const normalised = normaliseTimelineEvent(event);

  const result = statements.upsertTimelineEvent.run(
    event.id ?? null,
    normalised.start_time,
    normalised.day_of_week,
    normalised.hru_config,
    normalised.luftator_config,
    normalised.enabled,
    normalised.priority,
    normalised.hru_id,
  ) as { lastInsertRowid: number | bigint; changes: number };

  const persistedId = event.id ?? Number(result.lastInsertRowid);
  moduleLogger?.debug({ id: persistedId }, "Upserted timeline event");

  return {
    ...event,
    id: persistedId,
  };
}

export function deleteTimelineEvent(id: number): void {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    moduleLogger?.error({ id }, "Database not initialised in deleteTimelineEvent");
    throw new Error("Database not initialised");
  }

  statements.deleteTimelineEvent.run(id);
  moduleLogger?.debug({ id }, "Deleted timeline event");
}

export function deleteTimelineEventsByMode(modeId: number): void {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    moduleLogger?.error({ modeId }, "Database not initialised in deleteTimelineEventsByMode");
    throw new Error("Database not initialised");
  }
  statements.deleteEventsByMode.run(modeId);
  moduleLogger?.debug({ modeId }, "Deleted timeline events by mode");
}

export async function createDatabaseBackup(): Promise<string | null> {
  const sourcePath = getDatabasePath();
  if (!existsSync(sourcePath)) {
    return null;
  }

  const backupPath = `${sourcePath}.${Date.now()}.bak`;
  copyFileSync(sourcePath, backupPath);
  moduleLogger?.info({ backupPath }, "Created database backup");
  return backupPath;
}

export async function replaceDatabaseWithFile(buffer: Buffer, logger?: Logger): Promise<void> {
  if (statements) {
    finalizeStatements();
  }
  if (db) {
    db.close();
    db = null;
  }

  const dbPath = getDatabasePath();

  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  try {
    if (existsSync(walPath)) await fsp.unlink(walPath);
    if (existsSync(shmPath)) await fsp.unlink(shmPath);
  } catch {
    logger?.warn("Failed to delete auxiliary database files during replacement");
  }

  const tempPath = `${dbPath}.tmp`;
  await fsp.writeFile(tempPath, buffer);
  await fsp.rename(tempPath, dbPath);

  setupDatabase(logger);
  logger?.info("Database replaced from backup file");
}

export function checkpointDatabase(logger?: Logger): void {
  if (!db || !statements) {
    setupDatabase(logger);
  }
  if (!db) {
    logger?.error("Database not initialised");
    throw new Error("Database not initialised");
  }

  db.run("PRAGMA wal_checkpoint(TRUNCATE);");
  logger?.debug("Database WAL checkpoint completed");
}
