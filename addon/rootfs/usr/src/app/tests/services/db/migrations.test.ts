import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import DatabaseConstructor, { type Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyMigrations,
  latestSchemaVersion,
  migrations,
} from "../../../src/services/db/migrations.js";

/**
 * Builds a database frozen at a historical migration by running every migration
 * up to and including `throughId`, leaving the rest pending.
 */
function buildDatabaseAt(dbPath: string, throughId: string): DatabaseType {
  const db = new DatabaseConstructor(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
  );
  const record = db.prepare("INSERT OR IGNORE INTO migrations (id) VALUES (?)");

  for (const migration of migrations) {
    for (const sql of migration.statements) {
      try {
        db.exec(sql);
      } catch (err) {
        // 004 drops a column that may not exist; mirrors the production guard.
        if (!String(err).includes("no such column")) throw err;
      }
    }
    record.run(migration.id);
    if (migration.id === throughId) break;
  }
  return db;
}

const PRE_SEASONS = "012_add_mode_script_entity_ids";

/** A realistic install: two modes, unit-scoped and unit-less events. */
function seedRealisticInstall(db: DatabaseType, options: { withUnitSetting?: boolean } = {}): void {
  const insertMode = db.prepare(
    `INSERT INTO timeline_modes (id, name, color, power, temperature, luftator_config, is_boost,
                                 hru_id, native_mode, variables, script_entity_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertMode.run(1, "Komfort", "#1971c2", 60, 21.5, null, 0, "atrea-am", 2, null, null);
  insertMode.run(2, "Utlum", "#868e96", 20, 19, null, 0, "atrea-am", 2, null, null);

  const insertEvent = db.prepare(
    `INSERT INTO timeline_events (start_time, day_of_week, hru_config, luftator_config, enabled,
                                  priority, hru_id)
     VALUES (?, ?, ?, ?, 1, 0, ?)`,
  );
  for (let day = 0; day < 7; day++) {
    insertEvent.run("06:00", day, JSON.stringify({ mode: "1" }), null, "atrea-am");
    insertEvent.run("22:00", day, JSON.stringify({ mode: "2" }), null, "atrea-am");
  }
  // Unit-less legacy event, readable from every unit today.
  insertEvent.run("12:00", null, JSON.stringify({ mode: "1" }), null, null);

  if (options.withUnitSetting !== false) {
    db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`).run(
      "hru.settings",
      JSON.stringify({ unit: "atrea-am" }),
    );
  }
}

describe("season migrations (013, 014)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "luftator-migration-test-"));
    dbPath = path.join(dir, "luftator.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("assigns every existing event to a season without losing any", () => {
    const db = buildDatabaseAt(dbPath, PRE_SEASONS);
    seedRealisticInstall(db);
    const before = db.prepare("SELECT id FROM timeline_events ORDER BY id").all();

    applyMigrations(db);

    const after = db.prepare("SELECT id, timeline_id FROM timeline_events ORDER BY id").all() as {
      id: number;
      timeline_id: number | null;
    }[];

    expect(after).toHaveLength(before.length);
    expect(after.every((row) => row.timeline_id !== null)).toBe(true);
    db.close();
  });

  it("creates one spring season per unit and none belonging to no unit", () => {
    const db = buildDatabaseAt(dbPath, PRE_SEASONS);
    seedRealisticInstall(db);

    applyMigrations(db);

    const seasons = db
      .prepare("SELECT season_key, hru_id, span_start, span_end, enabled FROM timelines")
      .all() as { season_key: string; hru_id: string | null }[];

    expect(seasons).toHaveLength(1);
    expect(seasons[0]?.season_key).toBe("spring");
    expect(seasons[0]?.hru_id).toBe("atrea-am");
    db.close();
  });

  it("folds unit-less events into the current unit's season", () => {
    const db = buildDatabaseAt(dbPath, PRE_SEASONS);
    seedRealisticInstall(db);

    applyMigrations(db);

    const unitless = db
      .prepare("SELECT timeline_id FROM timeline_events WHERE hru_id IS NULL")
      .all() as { timeline_id: number }[];
    const unitSeason = db.prepare("SELECT id FROM timelines WHERE hru_id = ?").get("atrea-am") as {
      id: number;
    };

    expect(unitless).not.toHaveLength(0);
    for (const row of unitless) {
      expect(row.timeline_id).toBe(unitSeason.id);
    }
    db.close();
  });

  it("copies mode values into the season and leaves the legacy columns populated", () => {
    const db = buildDatabaseAt(dbPath, PRE_SEASONS);
    seedRealisticInstall(db);

    applyMigrations(db);

    const values = db
      .prepare(
        "SELECT mode_id, timeline_id, power, temperature, native_mode FROM timeline_mode_values ORDER BY mode_id",
      )
      .all() as { mode_id: number; power: number; temperature: number }[];
    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({ mode_id: 1, power: 60, temperature: 21.5 });

    // Legacy columns must survive: they are what a downgraded build reads.
    const legacy = db.prepare("SELECT power, temperature FROM timeline_modes WHERE id = 1").get();
    expect(legacy).toMatchObject({ power: 60, temperature: 21.5 });
    db.close();
  });

  it("records the schema version", () => {
    const db = buildDatabaseAt(dbPath, PRE_SEASONS);
    seedRealisticInstall(db);

    applyMigrations(db);

    const row = db
      .prepare("SELECT value FROM app_settings WHERE key = 'db.schema_version'")
      .get() as { value: string };
    expect(Number.parseInt(row.value, 10)).toBe(latestSchemaVersion());
    db.close();
  });

  it("is idempotent - re-running applyMigrations changes nothing and does not throw", () => {
    const db = buildDatabaseAt(dbPath, PRE_SEASONS);
    seedRealisticInstall(db);

    applyMigrations(db);
    const firstSeasons = db.prepare("SELECT * FROM timelines ORDER BY id").all();
    const firstValues = db.prepare("SELECT * FROM timeline_mode_values ORDER BY mode_id").all();

    expect(() => applyMigrations(db)).not.toThrow();

    expect(db.prepare("SELECT * FROM timelines ORDER BY id").all()).toEqual(firstSeasons);
    expect(db.prepare("SELECT * FROM timeline_mode_values ORDER BY mode_id").all()).toEqual(
      firstValues,
    );
    db.close();
  });

  it("survives a database where 013 ran but 014 did not", () => {
    const db = buildDatabaseAt(dbPath, "013_timelines");

    expect(() => applyMigrations(db)).not.toThrow();
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='timeline_mode_values'",
        )
        .get(),
    ).toBeTruthy();
    db.close();
  });

  it("re-running a migration whose column already exists does not throw", () => {
    const db = buildDatabaseAt(dbPath, PRE_SEASONS);
    seedRealisticInstall(db);
    // Simulate a half-applied 013: the column is there, the marker is not.
    db.exec("ALTER TABLE timeline_events ADD COLUMN timeline_id INTEGER");

    expect(() => applyMigrations(db)).not.toThrow();
    db.close();
  });

  describe("state matrix - every reachable database must migrate cleanly", () => {
    const cases: Array<[string, (db: DatabaseType) => void]> = [
      ["empty database", () => undefined],
      [
        "all events unit-scoped",
        (db) => {
          db.exec(
            `INSERT INTO timeline_events (start_time, day_of_week, hru_config, enabled, priority, hru_id)
             VALUES ('06:00', 0, '{"mode":"1"}', 1, 0, 'atrea-am')`,
          );
        },
      ],
      [
        "all events unit-less, no unit configured",
        (db) => {
          db.exec(
            `INSERT INTO timeline_events (start_time, day_of_week, hru_config, enabled, priority, hru_id)
             VALUES ('06:00', 0, '{"mode":"1"}', 1, 0, NULL)`,
          );
        },
      ],
      ["mixed scoped and unscoped", (db) => seedRealisticInstall(db)],
      [
        "modes with all-NULL value columns",
        (db) => {
          db.exec(
            `INSERT INTO timeline_modes (id, name, hru_id) VALUES (9, 'Prazdny', 'atrea-am')`,
          );
          db.exec(
            `INSERT INTO timeline_events (start_time, day_of_week, hru_config, enabled, priority, hru_id)
             VALUES ('06:00', 0, '{"mode":"9"}', 1, 0, 'atrea-am')`,
          );
        },
      ],
      [
        "modes referenced by no event",
        (db) => {
          db.exec(
            `INSERT INTO timeline_modes (id, name, power, hru_id) VALUES (7, 'Osirely', 30, 'atrea-am')`,
          );
        },
      ],
    ];

    for (const [name, seed] of cases) {
      it(name, () => {
        const db = buildDatabaseAt(dbPath, PRE_SEASONS);
        seed(db);

        expect(() => applyMigrations(db)).not.toThrow();

        // Whatever the shape, no event may be left without a season.
        const orphans = db
          .prepare("SELECT COUNT(*) AS n FROM timeline_events WHERE timeline_id IS NULL")
          .get() as { n: number };
        expect(orphans.n).toBe(0);
        db.close();
      });
    }
  });
});

describe("schema version gate on import", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "luftator-import-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeDatabaseWithVersion(name: string, version: string | null): string {
    const filePath = path.join(dir, name);
    const db = new DatabaseConstructor(filePath);
    db.exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    if (version !== null) {
      db.prepare(`INSERT INTO app_settings (key, value) VALUES ('db.schema_version', ?)`).run(
        version,
      );
    }
    db.close();
    return filePath;
  }

  it("refuses a database written by a newer build", async () => {
    const { assertImportableSchemaVersion } =
      await import("../../../src/services/db/maintenance.js");
    const filePath = writeDatabaseWithVersion("newer.db", String(latestSchemaVersion() + 1));

    expect(() => assertImportableSchemaVersion(filePath)).toThrow(/newer version/i);
  });

  it("accepts a database at the current version", async () => {
    const { assertImportableSchemaVersion } =
      await import("../../../src/services/db/maintenance.js");
    const filePath = writeDatabaseWithVersion("current.db", String(latestSchemaVersion()));

    expect(() => assertImportableSchemaVersion(filePath)).not.toThrow();
  });

  it("accepts an older database, including one from before versions were stamped", async () => {
    const { assertImportableSchemaVersion } =
      await import("../../../src/services/db/maintenance.js");

    expect(() =>
      assertImportableSchemaVersion(writeDatabaseWithVersion("old.db", "9")),
    ).not.toThrow();
    expect(() =>
      assertImportableSchemaVersion(writeDatabaseWithVersion("unstamped.db", null)),
    ).not.toThrow();
  });
});

/**
 * A failed migration restarts the container straight back into applyMigrations,
 * so the backup has to survive being taken again. It is the only recovery
 * handle the failure log can point at.
 */
describe("pre-migration backup", () => {
  let dir: string;
  let dbPath: string;
  let previousDbPath: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "luftator-backup-test-"));
    dbPath = path.join(dir, "luftator.db");
    // getDatabasePath() is captured when services/database.ts is first
    // imported, so the module has to be loaded after the path is set.
    previousDbPath = process.env.LUFTATOR_DB_PATH;
    process.env.LUFTATOR_DB_PATH = dbPath;
    vi.resetModules();
  });

  afterEach(() => {
    if (previousDbPath === undefined) {
      delete process.env.LUFTATOR_DB_PATH;
    } else {
      process.env.LUFTATOR_DB_PATH = previousDbPath;
    }
    vi.resetModules();
    rmSync(dir, { recursive: true, force: true });
  });

  function loadMigrations() {
    return import("../../../src/services/db/migrations.js");
  }

  it("names the copy after the version the database starts from", async () => {
    const module = await loadMigrations();
    const db = buildDatabaseAt(dbPath, PRE_SEASONS);
    seedRealisticInstall(db);

    module.applyMigrations(db);
    db.close();

    expect(existsSync(`${dbPath}.premigration.12-to-${module.latestSchemaVersion()}.bak`)).toBe(
      true,
    );
  });

  it("keeps a copy left behind by an earlier attempt", async () => {
    const module = await loadMigrations();
    const db = buildDatabaseAt(dbPath, PRE_SEASONS);
    seedRealisticInstall(db);

    const backupPath = `${dbPath}.premigration.12-to-${module.latestSchemaVersion()}.bak`;
    writeFileSync(backupPath, "the copy taken before the first attempt");

    module.applyMigrations(db);
    db.close();

    expect(readFileSync(backupPath, "utf8")).toBe("the copy taken before the first attempt");
  });

  it("takes a separate copy when the retry starts from a later version", async () => {
    const module = await loadMigrations();
    const db = buildDatabaseAt(dbPath, PRE_SEASONS);
    seedRealisticInstall(db);

    module.applyMigrations(db);
    const original = `${dbPath}.premigration.12-to-${module.latestSchemaVersion()}.bak`;
    const contentBefore = readFileSync(original);

    // What a crash loop leaves behind when everything up to 013 committed and
    // the migration after it threw.
    for (const migration of migrations.slice(13)) {
      db.prepare("DELETE FROM migrations WHERE id = ?").run(migration.id);
    }
    module.applyMigrations(db);
    db.close();

    expect(existsSync(`${dbPath}.premigration.13-to-${module.latestSchemaVersion()}.bak`)).toBe(
      true,
    );
    expect(readFileSync(original)).toEqual(contentBefore);
  });
});
