import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import DatabaseConstructor, { type Database as DatabaseType } from "better-sqlite3";
import { vi } from "vitest";
import { migrations } from "../../src/services/db/migrations.js";

/** The last migration a 1.0.9 database has applied. */
export const PRE_SEASONS_MIGRATION = "012_add_mode_script_entity_ids";

/**
 * Builds a database frozen at a historical migration by running every migration
 * up to and including `throughId`, leaving the rest pending - the on-disk state
 * an add-on update finds.
 */
export function buildDatabaseAt(dbPath: string, throughId: string): DatabaseType {
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

/**
 * Opens the application's database layer on an existing file, exactly as the
 * add-on does on start: pending migrations run, then the modules are ready.
 */
export async function openApplicationDatabase(dbPath: string) {
  vi.resetModules();
  process.env.LUFTATOR_DB_PATH = dbPath;
  const database = await import("../../src/services/database.js");
  database.setupDatabase();
  return {
    database,
    db: database.getDatabase()!,
    cleanup() {
      database.closeDatabase();
      delete process.env.LUFTATOR_DB_PATH;
      vi.resetModules();
    },
  };
}

export function makeTempDir(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  return {
    dir,
    dbPath: path.join(dir, "luftator.db"),
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
