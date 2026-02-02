/* eslint-disable quotes */
import { Database } from "bun:sqlite";
import type { Statement } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { promises as fsp } from "fs";
import path from "path";
import type { Logger } from "pino";

const DEFAULT_DATA_DIR = "/data";
const FALLBACK_DATA_DIR = path.resolve(process.cwd(), "../../data");

const dataDir = (() => {
  if (process.env.LUFTATOR_DB_PATH) {
    return path.dirname(process.env.LUFTATOR_DB_PATH);
  }
  if (existsSync(DEFAULT_DATA_DIR)) {
    return DEFAULT_DATA_DIR;
  }
  return FALLBACK_DATA_DIR;
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
        end_time TEXT NOT NULL, -- HH:MM format
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
};

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
  const logMsg = `Opening database at ${DATABASE_PATH}`;
  if (logger) {
    logger.info(logMsg);
  } else {
    console.log(logMsg);
  }
  try {
    return new Database(DATABASE_PATH, { create: true });
  } catch (error) {
    const errMsg = "Failed to open database";
    if (logger) {
      logger.error({ error }, errMsg);
    } else {
      console.error(errMsg, error);
    }
    throw error;
  }
}

function applyMigrations(database: Database, logger?: Logger): void {
  try {
    database.run("PRAGMA journal_mode = WAL;");
  } catch (err) {
    // Fallback for environments that don't support WAL (e.g. WSL mounts)
    const warnMsg = "Failed to set WAL mode, falling back to DELETE mode";
    if (logger) {
      logger.warn({ err }, warnMsg);
    } else {
      console.warn(warnMsg, err);
    }
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
        database.run(sql);
      }
      insertMigration.run(migration.id);
      database.run("COMMIT");
    } catch (error) {
      database.run("ROLLBACK");
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
      `SELECT id, start_time, end_time, day_of_week, hru_config, luftator_config, enabled, priority, created_at, updated_at
       FROM timeline_events ORDER BY day_of_week ASC NULLS LAST, start_time ASC, priority DESC`,
    ),
    upsertTimelineEvent: database.prepare(
      `INSERT INTO timeline_events (id, start_time, end_time, day_of_week, hru_config, luftator_config, enabled, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         day_of_week = excluded.day_of_week,
         hru_config = excluded.hru_config,
         luftator_config = excluded.luftator_config,
         enabled = excluded.enabled,
         priority = excluded.priority,
         updated_at = datetime("now")`,
    ),
    deleteTimelineEvent: database.prepare(`DELETE FROM timeline_events WHERE id = ?`),
  };
}

export function setupDatabase(logger?: Logger): void {
  if (statements) {
    finalizeStatements();
  }
  if (db) {
    db.close();
    db = null;
  }

  db = openDatabase(logger);
  applyMigrations(db, logger);
  statements = prepareStatements(db);
}

// Remove automatic initialization to allow lazy loading/mocking
// setupDatabase();

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
    // If not initialized, try to initialize (lazy load for prod)
    // Or throw error if you prefer strict explicit init
    setupDatabase();
  }
  if (!db || !statements) throw new Error("Database init failed");

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
}

export function getDatabasePath(): string {
  return DATABASE_PATH;
}

export function getAppSetting(key: string): string | null {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) throw new Error("Database not initialised");

  const row = statements.getSetting.get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAppSetting(key: string, value: string): void {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) throw new Error("Database not initialised");

  statements.upsertSetting.run(key, value);
}

export interface TimelineEvent {
  id?: number;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  dayOfWeek?: number | null; // 0-6 (Sunday=0), null for all days
  hruConfig?: {
    mode?: string;
    power?: number;
    temperature?: number;
  } | null;
  luftatorConfig?: Record<string, number> | null;
  enabled: boolean;
  priority: number;
}

export interface TimelineEventRecord {
  id: number;
  start_time: string;
  end_time: string;
  day_of_week: number | null;
  hru_config: string | null;
  luftator_config: string | null;
  enabled: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

function normaliseTimelineEvent(
  event: TimelineEvent,
): Omit<TimelineEventRecord, "id" | "created_at" | "updated_at"> {
  return {
    start_time: event.startTime,
    end_time: event.endTime,
    day_of_week: event.dayOfWeek ?? null,
    hru_config: event.hruConfig ? JSON.stringify(event.hruConfig) : null,
    luftator_config: event.luftatorConfig ? JSON.stringify(event.luftatorConfig) : null,
    enabled: event.enabled,
    priority: event.priority,
  };
}

function denormaliseTimelineEvent(record: TimelineEventRecord): TimelineEvent {
  return {
    id: record.id,
    startTime: record.start_time,
    endTime: record.end_time,
    dayOfWeek: record.day_of_week,
    hruConfig: record.hru_config ? JSON.parse(record.hru_config) : null,
    luftatorConfig: record.luftator_config ? JSON.parse(record.luftator_config) : null,
    enabled: Boolean(record.enabled),
    priority: record.priority,
  };
}

export function getTimelineEvents(): TimelineEvent[] {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) throw new Error("Database not initialised");

  const records = statements.getTimelineEvents.all() as TimelineEventRecord[];
  return records.map(denormaliseTimelineEvent);
}

export function upsertTimelineEvent(event: TimelineEvent): TimelineEvent {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) throw new Error("Database not initialised");

  const normalised = normaliseTimelineEvent(event);

  // Use single upsert statement for both insert and update
  const result = statements.upsertTimelineEvent.run(
    event.id ?? null, // id can be null for new records
    normalised.start_time,
    normalised.end_time,
    normalised.day_of_week,
    normalised.hru_config,
    normalised.luftator_config,
    normalised.enabled,
    normalised.priority,
  ) as { lastInsertRowid: number | bigint; changes: number };

  // Return the event with proper ID
  const persistedId = event.id ?? Number(result.lastInsertRowid);
  return {
    ...event,
    id: persistedId,
  };
}

export function deleteTimelineEvent(id: number): void {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) throw new Error("Database not initialised");

  statements.deleteTimelineEvent.run(id);
}

export async function createDatabaseBackup(): Promise<string | null> {
  const sourcePath = getDatabasePath();
  if (!existsSync(sourcePath)) {
    return null;
  }

  const backupPath = `${sourcePath}.${Date.now()}.bak`;
  copyFileSync(sourcePath, backupPath);
  return backupPath;
}

export async function replaceDatabaseWithFile(buffer: Buffer): Promise<void> {
  if (statements) {
    finalizeStatements();
  }
  if (db) {
    db.close();
    db = null;
  }

  const dbPath = getDatabasePath();
  const tempPath = `${dbPath}.tmp`;
  await fsp.writeFile(tempPath, buffer);
  await fsp.rename(tempPath, dbPath);

  setupDatabase();
}

export function checkpointDatabase(): void {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!db) throw new Error("Database not initialised");

  // Force a checkpoint to move pages from WAL to the main DB file
  // TRUNCATE resets the WAL file generated length to zero
  db.run("PRAGMA wal_checkpoint(TRUNCATE);");
}
