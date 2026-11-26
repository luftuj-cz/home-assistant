import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDatabaseAt, openApplicationDatabase } from "../../helpers/legacyDb.js";

/**
 * 017_control_mode: installations from before the Řízení step could only run the weekly plan, so an update stores
 * that explicitly instead of leaving the setting missing.
 */
describe("migration 017_control_mode", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "luftator-control-mode-"));
    dbPath = path.join(dir, "luftator.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function readControlMode(db: { prepare: (sql: string) => { get: (key: string) => unknown } }) {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get("control.mode") as
      | { value: string }
      | undefined;
    return row?.value;
  }

  it("sets the weekly plan for an installation updated from before the choice existed", async () => {
    const legacy = buildDatabaseAt(dbPath, "016_custom_timelines");
    legacy
      .prepare("INSERT INTO app_settings (key, value) VALUES ('onboarding.done', 'true')")
      .run();
    legacy.close();

    const app = await openApplicationDatabase(dbPath);
    try {
      expect(readControlMode(app.db)).toBe("schedule");
    } finally {
      app.cleanup();
    }
  });

  it("gives a new installation the weekly plan until the wizard stores the choice", async () => {
    const app = await openApplicationDatabase(dbPath);
    try {
      expect(readControlMode(app.db)).toBe("schedule");
    } finally {
      app.cleanup();
    }
  });

  it("only inserts the setting, never overwrites one", async () => {
    const { migrations } = await import("../../../src/services/db/migrations.js");
    const migration = migrations.find((candidate) => candidate.id === "017_control_mode");
    expect(migration).toBeDefined();
    for (const statement of migration!.statements) {
      const sql = statement.replace(/--.*$/gm, "").trim().toUpperCase();
      expect(sql).toMatch(/^INSERT OR IGNORE INTO APP_SETTINGS\b/);
    }
  });
});
