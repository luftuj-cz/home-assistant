import type { Database as DatabaseType } from "better-sqlite3";
import { getModuleLogger, type Migration } from "../database.js";

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
  {
    id: "008_add_mode_variables",
    statements: [`ALTER TABLE timeline_modes ADD COLUMN variables TEXT;`],
  },
  {
    id: "009_drop_valve_history",
    statements: [
      `DROP INDEX IF EXISTS idx_valve_history_entity_id_recorded_at;`,
      `DROP TABLE IF EXISTS valve_history;`,
    ],
  },
  {
    id: "010_vacuum_after_history_drop",
    statements: [`VACUUM;`],
  },
];

export function applyMigrations(database: DatabaseType): void {
  const activeLogger = getModuleLogger();
  try {
    database.exec("PRAGMA journal_mode = WAL;");
  } catch (err) {
    activeLogger?.warn({ err }, "Failed to set WAL mode, falling back to DELETE mode");
    database.exec("PRAGMA journal_mode = DELETE;");
  }
  database.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
  );

  const migrationRows = database.prepare("SELECT id FROM migrations").all() as { id: string }[];
  const existing = new Set(migrationRows.map((row) => row.id));

  for (const migration of migrations) {
    if (!existing.has(migration.id)) {
      applySingleMigration(database, migration, activeLogger);
    }
  }
}

function isVacuumMigration(migration: Migration): boolean {
  return (
    migration.statements.length === 1 && migration.statements[0]?.trim().toUpperCase() === "VACUUM;"
  );
}

function applySingleMigration(
  database: DatabaseType,
  migration: Migration,
  activeLogger: ReturnType<typeof getModuleLogger>,
): void {
  if (isVacuumMigration(migration)) {
    applyVacuumMigration(database, migration, activeLogger);
    return;
  }

  const insertMigration = database.prepare("INSERT INTO migrations (id) VALUES (?)");
  const runMigration = database.transaction(() => {
    for (const sql of migration.statements) {
      database.exec(sql);
    }
    insertMigration.run(migration.id);
  });

  try {
    runMigration();
    activeLogger?.info({ migrationId: migration.id }, "Applied database migration");
  } catch (error) {
    if (migration.id === "004_remove_legacy_end_time" && String(error).includes("no such column")) {
      activeLogger?.info("Migration 004: end_time column already removed, skipping.");
    } else {
      activeLogger?.error({ error, migrationId: migration.id }, "Migration failed");
      throw error;
    }
  }
}

function applyVacuumMigration(
  database: DatabaseType,
  migration: Migration,
  activeLogger: ReturnType<typeof getModuleLogger>,
): void {
  const insertMigration = database.prepare("INSERT INTO migrations (id) VALUES (?)");
  try {
    database.exec("VACUUM;");
    insertMigration.run(migration.id);
    activeLogger?.info({ migrationId: migration.id }, "Applied database migration");
  } catch (error) {
    activeLogger?.error({ error, migrationId: migration.id }, "Migration failed");
    throw error;
  }
}
