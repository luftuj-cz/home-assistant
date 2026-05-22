/* eslint-disable quotes */
import DatabaseConstructor, { type Database as DatabaseType, type Statement } from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { getAppSetting } from "./db/settings.js";
import { migrateModesToTable } from "./db/timeline.js";
import { applyMigrations } from "./db/migrations.js";

export { getAllAppSettings, getAppSetting, setAppSetting } from "./db/settings.js";
export { storeValveSnapshots } from "./db/valves.js";
export {
  assignLegacyEventsToUnit,
  deleteTimelineEvent,
  deleteTimelineEventsByMode,
  deleteTimelineMode,
  getTimelineEvents,
  getTimelineMode,
  getTimelineModes,
  migrateLegacyEventsForUnit,
  type TimelineEvent,
  upsertTimelineEvent,
  upsertTimelineMode,
} from "./db/timeline.js";
export { checkpointDatabase, createDatabaseBackup, replaceDatabaseWithFile, resetDatabase } from "./db/maintenance.js";

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

export interface Migration {
  id: string;
  statements: string[];
}

export let db: DatabaseType | null = null;

export type StatementMap = {
  upsertController: Statement;
  upsertValveState: Statement;
  getSetting: Statement;
  getAllSettings: Statement;
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

export let moduleLogger: Logger | null = null;
export let statements: StatementMap | null = null;
export let isStopping = false;

export type ValveStateRecord = {
  entity_id: string;
  controller_id: string | null;
  name: string | null;
  value: number | null;
  state: string | null;
  timestamp: string;
  attributes: string;
};

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

function openDatabase(logger?: Logger): DatabaseType {
  const activeLogger = logger ?? moduleLogger;
  const logMsg = `Opening database at ${DATABASE_PATH}`;

  activeLogger?.info(logMsg);

  try {
    return new DatabaseConstructor(DATABASE_PATH);
  } catch (error) {
    activeLogger?.error({ error }, "Failed to open database");
    throw error;
  }
}

export function finalizeStatements(): void {
  // better-sqlite3 handles statement cleanup automatically
  statements = null;
}

export function setStopping(val: boolean): void {
  isStopping = val;
}

function prepareStatements(database: DatabaseType): StatementMap {
  return {
    upsertController: database.prepare(
      `INSERT INTO controllers (id, name, created_at, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET name       = excluded.name,
                                     updated_at = CURRENT_TIMESTAMP`,
    ),
    upsertValveState: database.prepare(
      `INSERT INTO valve_state (entity_id, controller_id, name, value, state, last_updated, attributes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET controller_id = excluded.controller_id,
                                            name          = excluded.name,
                                            value         = excluded.value,
                                            state         = excluded.state,
                                            last_updated  = excluded.last_updated,
                                            attributes    = excluded.attributes`,
    ),
    getSetting: database.prepare("SELECT value FROM app_settings WHERE key = ?"),
    getAllSettings: database.prepare("SELECT key, value FROM app_settings ORDER BY key"),
    upsertSetting: database.prepare(
      `INSERT INTO app_settings (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ),
    getTimelineEvents: database.prepare(
      `SELECT id,
              start_time,
              day_of_week,
              hru_config,
              luftator_config,
              enabled,
              priority,
              hru_id,
              created_at,
              updated_at
       FROM timeline_events
       WHERE hru_id = ?
          OR hru_id IS NULL
       ORDER BY day_of_week NULLS LAST, start_time, priority DESC`,
    ),
    upsertTimelineEvent: database.prepare(
      `INSERT INTO timeline_events (id, start_time, day_of_week, hru_config, luftator_config, enabled, priority, hru_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET start_time      = excluded.start_time,
                                     day_of_week     = excluded.day_of_week,
                                     hru_config      = excluded.hru_config,
                                     luftator_config = excluded.luftator_config,
                                     enabled         = excluded.enabled,
                                     priority        = excluded.priority,
                                     hru_id          = excluded.hru_id,
                                     updated_at      = datetime('now')`,
    ),
    deleteTimelineEvent: database.prepare(`DELETE
                                           FROM timeline_events
                                           WHERE id = ?`),
    assignLegacyEvents: database.prepare(
      `UPDATE timeline_events
       SET hru_id = ?
       WHERE hru_id IS NULL`,
    ),
    deleteEventsByMode: database.prepare(
      `DELETE
       FROM timeline_events
       WHERE CAST(json_extract(hru_config, '$.mode') AS INTEGER) = ?`,
    ),
    getTimelineModes: database.prepare(
      `SELECT *
       FROM timeline_modes
       WHERE hru_id = ?
          OR hru_id IS NULL
       ORDER BY name`,
    ),
    upsertTimelineMode: database.prepare(
      `INSERT INTO timeline_modes (id, name, color, power, temperature, luftator_config, is_boost, hru_id, native_mode,
                                   variables)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name            = excluded.name,
                                     color           = excluded.color,
                                     power           = excluded.power,
                                     temperature     = excluded.temperature,
                                     luftator_config = excluded.luftator_config,
                                     is_boost        = excluded.is_boost,
                                     hru_id          = excluded.hru_id,
                                     native_mode     = excluded.native_mode,
                                     variables       = excluded.variables,
                                     updated_at      = datetime('now')`,
    ),
    deleteTimelineMode: database.prepare(`DELETE
                                          FROM timeline_modes
                                          WHERE id = ?`),
    getTimelineMode: database.prepare(`SELECT *
                                       FROM timeline_modes
                                       WHERE id = ?`),
  };
}

export function setupDatabase(logger?: Logger): void {
  if (isStopping) {
    return;
  }
  moduleLogger = logger ?? moduleLogger;
  if (statements) {
    finalizeStatements();
  }
  if (db) {
    db.close();
    db = null;
  }

  db = openDatabase(moduleLogger ?? undefined);
  applyMigrations(db);
  statements = prepareStatements(db);

  migrateModesToTable(getAppSetting);
}


export function getDatabasePath(): string {
  return DATABASE_PATH;
}
