import { readdirSync } from "node:fs";
import path from "node:path";
import DatabaseConstructor from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupTempDatabase } from "../../helpers/testDb.js";

type DatabaseModule = typeof import("../../../src/services/database.js");
type MaintenanceModule = typeof import("../../../src/services/db/maintenance.js");
type FeatureModule = typeof import("../../../src/services/db/seasonsFeature.js");

const UNIT = "atrea-am";

/**
 * Backups made by createDatabaseBackup, which are stamped with a timestamp.
 * Excludes the pre-migration copy applyMigrations takes on first open.
 */
function backupsBesideDatabase(): string[] {
  const dbPath = process.env.LUFTATOR_DB_PATH!;
  return readdirSync(path.dirname(dbPath)).filter((name) => /\.\d+\.bak$/.test(name));
}

/**
 * The backup is the last thing standing between a destructive action and lost
 * data, so it has to be a copy that can actually be opened. Copying the main
 * file alone leaves everything still in the write-ahead log behind - in the
 * worst case the schema itself.
 */
describe("database backup", () => {
  let cleanup: () => void;
  let database: DatabaseModule;
  let maintenance: MaintenanceModule;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    database = temp.database as DatabaseModule;
    maintenance = await import("../../../src/services/db/maintenance.js");
  });

  afterEach(() => {
    cleanup();
  });

  it("captures data still sitting in the write-ahead log", () => {
    const db = database.getDatabase()!;
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");

    // Committed, but not necessarily checkpointed into the main file yet.
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('probe', 'committed')`).run();

    const backupPath = maintenance.createDatabaseBackupSync();
    expect(backupPath).toBeTruthy();

    // Open the copy the way someone restoring it would: on its own.
    const restored = new DatabaseConstructor(backupPath!, { readonly: true });
    try {
      const row = restored.prepare(`SELECT value FROM app_settings WHERE key = 'probe'`).get() as
        | { value: string }
        | undefined;
      expect(row?.value).toBe("committed");
    } finally {
      restored.close();
    }
  });

  it("copies the schema, which a main-file-only copy could miss entirely", () => {
    const backupPath = maintenance.createDatabaseBackupSync();
    const restored = new DatabaseConstructor(backupPath!, { readonly: true });
    try {
      const tables = (
        restored.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
          name: string;
        }[]
      ).map((table) => table.name);
      expect(tables).toContain("timelines");
      expect(tables).toContain("timeline_events");
    } finally {
      restored.close();
    }
  });
});

describe("disabling the seasons feature", () => {
  let cleanup: () => void;
  let database: DatabaseModule;
  let feature: FeatureModule;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    database = temp.database as DatabaseModule;
    feature = await import("../../../src/services/db/seasonsFeature.js");
    feature.enableSeasonsFeature(UNIT, false);
  });

  afterEach(() => {
    cleanup();
  });

  it("needs no backup, because it deletes nothing", () => {
    expect(backupsBesideDatabase()).toHaveLength(0);

    feature.disableSeasonsFeature(UNIT, "spring");

    // Disabling used to collapse destructively and took a copy first. It parks
    // the other seasons now, so there is nothing to protect against.
    expect(backupsBesideDatabase()).toHaveLength(0);
    expect(database.getSeasons(UNIT)).toHaveLength(4);
    expect(database.getEnabledSeasons(UNIT)).toHaveLength(1);
  });
});
