import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";

export async function setupTempDatabase() {
  const dir = mkdtempSync(path.join(tmpdir(), "luftator-db-test-"));
  const dbPath = path.join(dir, "luftator.db");
  vi.resetModules();
  process.env.LUFTATOR_DB_PATH = dbPath;
  const database = await import("../database.js");
  database.setupDatabase();

  return {
    database,
    db: database.getDatabase()!,
    cleanup() {
      database.closeDatabase();
      delete process.env.LUFTATOR_DB_PATH;
      vi.resetModules();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
