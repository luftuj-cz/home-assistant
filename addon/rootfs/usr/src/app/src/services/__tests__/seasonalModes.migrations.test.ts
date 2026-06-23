import DatabaseConstructor from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations } from "../db/migrations.js";

const MIGRATIONS_BEFORE_SEASONS_FIX = [
  "001_initial",
  "002_app_settings",
  "003_timeline_events",
  "004_remove_legacy_end_time",
  "005_add_hru_id_to_timeline",
  "006_extract_modes_table",
  "007_add_native_mode",
  "008_add_mode_variables",
  "009_drop_valve_history",
  "010_vacuum_after_history_drop",
  "011_timeline_seasons",
];

function createDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "luftator-migration-test-"));
  const dbPath = path.join(dir, "luftator.db");
  const db = new DatabaseConstructor(dbPath);
  return {
    db,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("seasonal modes migrations", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("creates a corrected seasonal table for a fresh database", () => {
    const testDb = createDb();
    cleanup = testDb.cleanup;

    applyMigrations(testDb.db);

    const columns = testDb.db.prepare("PRAGMA table_info(timeline_seasons)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    const hruId = columns.find((column) => column.name === "hru_id");

    expect(hruId?.notnull).toBe(1);
  });

  it("upgrades old nullable seasonal rows and preserves unrelated data", () => {
    const testDb = createDb();
    cleanup = testDb.cleanup;
    const { db } = testDb;

    db.exec(`
      CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE timeline_modes (
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
        native_mode INTEGER,
        variables TEXT,
        UNIQUE(name, hru_id)
      );
      CREATE TABLE timeline_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_time TEXT NOT NULL,
        day_of_week INTEGER,
        hru_config TEXT,
        luftator_config TEXT,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        hru_id TEXT
      );
      CREATE TABLE timeline_seasons (
        season TEXT NOT NULL CHECK (season IN ('spring','summer','autumn','winter')),
        hru_id TEXT,
        base_mode_id INTEGER NOT NULL,
        power REAL,
        temperature REAL,
        variables TEXT,
        luftator_config TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (season, hru_id),
        FOREIGN KEY (base_mode_id) REFERENCES timeline_modes(id) ON DELETE CASCADE
      );
    `);

    const insertMigration = db.prepare("INSERT INTO migrations (id) VALUES (?)");
    for (const id of MIGRATIONS_BEFORE_SEASONS_FIX) {
      insertMigration.run(id);
    }

    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("theme", "dark");
    db.prepare("INSERT INTO timeline_modes (id, name, hru_id, power) VALUES (?, ?, ?, ?)").run(
      1,
      "Global",
      null,
      10,
    );
    db.prepare(
      "INSERT INTO timeline_events (id, start_time, enabled, priority) VALUES (?, ?, ?, ?)",
    ).run(1, "08:00", 1, 0);
    db.prepare(
      `INSERT INTO timeline_seasons
       (season, hru_id, base_mode_id, power, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("summer", null, 1, 20, 1, "2026-01-01 00:00:00", "2026-01-01 00:00:00");
    db.prepare(
      `INSERT INTO timeline_seasons
       (season, hru_id, base_mode_id, power, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("summer", null, 1, 30, 1, "2026-01-02 00:00:00", "2026-01-02 00:00:00");

    applyMigrations(db);

    const rows = db.prepare("SELECT hru_id, power FROM timeline_seasons").all() as Array<{
      hru_id: string;
      power: number;
    }>;

    expect(rows).toEqual([{ hru_id: "__global__", power: 30 }]);
    expect(db.prepare("SELECT value FROM app_settings WHERE key = ?").get("theme")).toEqual({
      value: "dark",
    });
    expect(db.prepare("SELECT start_time FROM timeline_events WHERE id = ?").get(1)).toEqual({
      start_time: "08:00",
    });
  });
});
