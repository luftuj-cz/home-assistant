import { copyFileSync, existsSync } from "node:fs";
import type { Database as DatabaseType } from "better-sqlite3";
import { getDatabasePath, getModuleLogger, type Migration } from "../database.js";

/**
 * Key under which the highest applied migration number is recorded, so a
 * database exported by a newer build can be refused on import instead of being
 * silently mis-read by an older one.
 */
export const SCHEMA_VERSION_SETTING_KEY = "db.schema_version";

/** Exported so tests can build a database at an arbitrary historical version. */
export const migrations: Migration[] = [
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
  {
    id: "011_valve_groups",
    statements: [
      `CREATE TABLE IF NOT EXISTS valve_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS valve_group_members (
        entity_id TEXT PRIMARY KEY,
        group_id INTEGER NOT NULL,
        FOREIGN KEY (group_id) REFERENCES valve_groups(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_valve_group_members_group_id ON valve_group_members(group_id)`,
    ],
  },
  {
    id: "012_add_mode_script_entity_ids",
    statements: [`ALTER TABLE timeline_modes ADD COLUMN script_entity_ids TEXT;`],
  },
  {
    id: "013_timelines",
    statements: [
      // Seasons. There is no name column: the four seasons are identified by a
      // fixed key and displayed through i18n, so they can never be renamed and
      // the MQTT sensor state stays stable.
      `CREATE TABLE IF NOT EXISTS timelines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        season_key TEXT NOT NULL,
        hru_id TEXT,
        span_start TEXT NOT NULL, -- MM-DD, no year: repeats annually
        span_end TEXT NOT NULL,   -- MM-DD, may wrap the year end
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(season_key, hru_id)
      )`,
      `ALTER TABLE timeline_events ADD COLUMN timeline_id INTEGER`,
      `CREATE INDEX IF NOT EXISTS idx_timeline_events_timeline_id ON timeline_events(timeline_id)`,

      // One whole-year season per unit that already owns events. Stored as
      // 'spring' because that is the key the enable flow grows from and the
      // disable flow collapses back into, so an enable/disable round trip
      // cannot move the user's schedule to a different season.
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       SELECT DISTINCT 'spring', hru_id, '01-01', '12-31', 1, 0
       FROM timeline_events
       WHERE hru_id IS NOT NULL`,

      // Unit-less events fold into the currently selected unit's season rather
      // than getting one of their own: assignLegacyEventsToUnit adopts those
      // rows on the next fetch, and a season belonging to no unit would leave
      // them pointing at a season pickActiveEvent never selects.
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       SELECT 'spring', json_extract(value, '$.unit'), '01-01', '12-31', 1, 0
       FROM app_settings
       WHERE key = 'hru.settings'
         AND json_extract(value, '$.unit') IS NOT NULL
         AND EXISTS (SELECT 1 FROM timeline_events WHERE hru_id IS NULL)
         AND NOT EXISTS (
           SELECT 1 FROM timelines WHERE hru_id = json_extract(app_settings.value, '$.unit')
         )`,

      // Last resort when unit-less events exist and no unit is configured at
      // all: a unit-less season, which is what getTimelineEvents(null) reads.
      // assignLegacyEventsToUnit adopts this row together with the events.
      `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
       SELECT 'spring', NULL, '01-01', '12-31', 1, 0
       WHERE EXISTS (SELECT 1 FROM timeline_events WHERE hru_id IS NULL)
         AND NOT EXISTS (SELECT 1 FROM timelines)`,

      `UPDATE timeline_events
       SET timeline_id = (SELECT t.id FROM timelines t WHERE t.hru_id = timeline_events.hru_id)
       WHERE hru_id IS NOT NULL`,

      `UPDATE timeline_events
       SET timeline_id = COALESCE(
         (SELECT t.id FROM timelines t
          WHERE t.hru_id = (
            SELECT json_extract(value, '$.unit') FROM app_settings WHERE key = 'hru.settings'
          )),
         (SELECT t.id FROM timelines t ORDER BY t.id LIMIT 1)
       )
       WHERE hru_id IS NULL`,
    ],
  },
  {
    id: "014_mode_values",
    statements: [
      // Per-season mode values. Identity (name, colour, is_boost) stays on
      // timeline_modes; everything the mode DOES lives here.
      `CREATE TABLE IF NOT EXISTS timeline_mode_values (
        mode_id INTEGER NOT NULL,
        timeline_id INTEGER NOT NULL,
        power REAL,
        temperature REAL,
        native_mode INTEGER,
        variables TEXT,
        luftator_config TEXT,
        script_entity_ids TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (mode_id, timeline_id),
        FOREIGN KEY (mode_id) REFERENCES timeline_modes(id) ON DELETE CASCADE,
        FOREIGN KEY (timeline_id) REFERENCES timelines(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_timeline_mode_values_timeline
        ON timeline_mode_values(timeline_id)`,

      // Copy today's values into the season that owns them. A unit-less mode is
      // readable from every unit today, so it gets a row in every season.
      // The legacy columns on timeline_modes are deliberately left populated:
      // they are what a downgraded build reads. Dropping them is left for a
      // later release, once this has soaked.
      `INSERT OR IGNORE INTO timeline_mode_values
         (mode_id, timeline_id, power, temperature, native_mode, variables,
          luftator_config, script_entity_ids)
       SELECT m.id, t.id, m.power, m.temperature, m.native_mode, m.variables,
              m.luftator_config, m.script_entity_ids
       FROM timeline_modes m
       JOIN timelines t ON (t.hru_id IS m.hru_id OR m.hru_id IS NULL)`,
    ],
  },
  {
    id: "015_timelines_unique_per_unit",
    statements: [
      // UNIQUE(season_key, hru_id) on the table does not constrain unit-less
      // rows: SQLite treats NULLs as distinct, so ('spring', NULL) can appear
      // twice. Two enabled seasons sharing a start day make validatePartition
      // reject every subsequent edit, locking the user out of season settings.
      // Fold NULL into '' so the constraint covers them too.
      //
      // Any duplicate already present would make the index creation fail, and a
      // failed migration crash-loops the container - so they are merged first.
      // Only a development database can have them; the feature is unreleased.
      `UPDATE timeline_events
       SET timeline_id = (
         SELECT MIN(keep.id) FROM timelines keep
         WHERE keep.season_key = (SELECT season_key FROM timelines WHERE id = timeline_events.timeline_id)
           AND keep.hru_id IS (SELECT hru_id FROM timelines WHERE id = timeline_events.timeline_id)
       )
       WHERE timeline_id IS NOT NULL`,
      `DELETE FROM timeline_mode_values
       WHERE timeline_id NOT IN (
         SELECT MIN(id) FROM timelines GROUP BY season_key, COALESCE(hru_id, '')
       )`,
      `DELETE FROM timelines
       WHERE id NOT IN (
         SELECT MIN(id) FROM timelines GROUP BY season_key, COALESCE(hru_id, '')
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_timelines_season_unit
        ON timelines(season_key, COALESCE(hru_id, ''))`,
    ],
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

  const pending = migrations.filter((migration) => !existing.has(migration.id));

  // A migration that throws is fatal: setupDatabase rethrows, start() calls
  // process.exit(1), and the Supervisor restarts straight back into the same
  // failure. The backup is the only thing standing between that and a lost
  // database, so take it before touching anything.
  const backupPath = pending.length > 0 ? backupBeforeMigrations(database, activeLogger) : null;

  for (const migration of pending) {
    applySingleMigration(database, migration, activeLogger, backupPath);
  }

  recordSchemaVersion(database, activeLogger);
}

/**
 * Highest migration number this build knows about, e.g. 14 for "014_mode_values".
 */
export function latestSchemaVersion(): number {
  return migrations.reduce((highest, migration) => {
    const parsed = Number.parseInt(migration.id.slice(0, 3), 10);
    return Number.isFinite(parsed) && parsed > highest ? parsed : highest;
  }, 0);
}

function recordSchemaVersion(
  database: DatabaseType,
  activeLogger: ReturnType<typeof getModuleLogger>,
): void {
  try {
    database
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(SCHEMA_VERSION_SETTING_KEY, String(latestSchemaVersion()));
  } catch (err) {
    // Never fatal: failing to stamp the version must not take down a database
    // that migrated correctly.
    activeLogger?.warn({ err }, "Failed to record schema version");
  }
}

/**
 * Highest migration number already applied to this database, e.g. 12 for a
 * database that stops at "012_add_mode_script_entity_ids".
 */
function appliedSchemaVersion(database: DatabaseType): number {
  try {
    const rows = database.prepare("SELECT id FROM migrations").all() as { id: string }[];
    return rows.reduce((highest, row) => {
      const parsed = Number.parseInt(row.id.slice(0, 3), 10);
      return Number.isFinite(parsed) && parsed > highest ? parsed : highest;
    }, 0);
  } catch {
    return 0;
  }
}

/**
 * Copies the database file aside before the first migration of this run.
 * Checkpoints WAL first so the copy is self-contained. Best effort: a failed
 * backup is logged loudly but does not block the migration, since refusing to
 * start would itself be an outage.
 *
 * The name carries the version the database is coming *from*, and an existing
 * file is never overwritten. Both matter under the failure this backup exists
 * for: a migration that throws restarts the container straight back into
 * `applyMigrations`. If 013 succeeded and 014 threw, the retry runs from a
 * different starting version - and even when it does not, refusing to
 * overwrite means the state the user actually had is still on disk instead of
 * being replaced by a half-migrated copy of it.
 */
function backupBeforeMigrations(
  database: DatabaseType,
  activeLogger: ReturnType<typeof getModuleLogger>,
): string | null {
  const sourcePath = getDatabasePath();
  if (!existsSync(sourcePath)) {
    return null;
  }

  const backupPath = `${sourcePath}.premigration.${appliedSchemaVersion(database)}-to-${latestSchemaVersion()}.bak`;
  if (existsSync(backupPath)) {
    activeLogger?.info(
      { backupPath },
      "Pre-migration backup from an earlier attempt already exists, keeping it",
    );
    return backupPath;
  }

  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch (err) {
    activeLogger?.warn({ err }, "WAL checkpoint before migration backup failed");
  }

  try {
    copyFileSync(sourcePath, backupPath);
    activeLogger?.info({ backupPath }, "Created pre-migration database backup");
    return backupPath;
  } catch (err) {
    activeLogger?.error(
      { err, sourcePath },
      "Failed to create pre-migration database backup; continuing without one",
    );
    return null;
  }
}

/**
 * True when `table` already has `column`. Used to make ADD COLUMN re-runnable:
 * SQLite throws "duplicate column name" otherwise, and this codebase has been
 * bitten by that before (see the 004 special case below).
 */
function columnExists(database: DatabaseType, table: string, column: string): boolean {
  try {
    const rows = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return rows.some((row) => row.name === column);
  } catch {
    return false;
  }
}

const ADD_COLUMN_PATTERN = /^\s*ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+ADD\s+COLUMN\s+["`]?(\w+)["`]?/i;

/**
 * Skips an ADD COLUMN whose column is already present, so re-running a
 * partially applied migration is a no-op instead of a crash loop.
 */
function shouldSkipStatement(database: DatabaseType, sql: string): boolean {
  const match = ADD_COLUMN_PATTERN.exec(sql);
  if (!match) return false;
  const [, table, column] = match;
  if (!table || !column) return false;
  return columnExists(database, table, column);
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
  backupPath: string | null = null,
): void {
  if (isVacuumMigration(migration)) {
    applyVacuumMigration(database, migration, activeLogger);
    return;
  }

  const insertMigration = database.prepare("INSERT INTO migrations (id) VALUES (?)");
  const runMigration = database.transaction(() => {
    for (const sql of migration.statements) {
      if (shouldSkipStatement(database, sql)) {
        activeLogger?.info(
          { migrationId: migration.id, sql },
          "Skipping already-applied statement",
        );
        continue;
      }
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
      // This throw crash-loops the container, so the log is the user's only
      // recovery handle: it must name the migration and where the backup is.
      activeLogger?.error(
        {
          error,
          migrationId: migration.id,
          backupPath,
          hint: backupPath
            ? `Database left unchanged by this migration. Pre-migration copy: ${backupPath}`
            : "No pre-migration backup was created; see earlier log lines.",
        },
        "Migration failed - add-on cannot start until this is resolved",
      );
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
