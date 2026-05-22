import { copyFileSync, existsSync, promises as fsp } from "node:fs";
import type { Logger } from "pino";
import {
  db,
  finalizeStatements,
  getDatabasePath,
  moduleLogger,
  setStopping,
  setupDatabase,
  statements,
} from "../database.js";

export async function createDatabaseBackup(): Promise<string | null> {
  const sourcePath = getDatabasePath();
  if (!existsSync(sourcePath)) {
    return null;
  }

  const backupPath = `${sourcePath}.${Date.now()}.bak`;
  copyFileSync(sourcePath, backupPath);
  moduleLogger?.info({ backupPath }, "Created database backup");
  return backupPath;
}

export async function replaceDatabaseWithFile(buffer: Buffer, logger?: Logger): Promise<void> {
  if (statements) {
    finalizeStatements();
  }
  if (db) {
    db.close();
    // We can't easily nullify 'db' from here since it's a re-export of a let.
    // But setupDatabase will handle it.
  }

  const dbPath = getDatabasePath();

  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  try {
    if (existsSync(walPath)) await fsp.unlink(walPath);
    if (existsSync(shmPath)) await fsp.unlink(shmPath);
  } catch {
    logger?.warn("Failed to delete auxiliary database files during replacement");
  }

  const tempPath = `${dbPath}.tmp`;
  await fsp.writeFile(tempPath, buffer);
  await fsp.rename(tempPath, dbPath);

  setupDatabase(logger);
  logger?.info("Database replaced from backup file");
}

export async function resetDatabase(logger?: Logger): Promise<void> {
  setStopping(true);

  if (statements) {
    finalizeStatements();
  }
  if (db) {
    db.close();
  }

  const dbPath = getDatabasePath();
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;

  try {
    if (existsSync(dbPath)) await fsp.unlink(dbPath);
    if (existsSync(walPath)) await fsp.unlink(walPath);
    if (existsSync(shmPath)) await fsp.unlink(shmPath);
    logger?.info("Database files removed successfully");
  } catch (error) {
    logger?.error({ error }, "Failed to remove database files");
    setStopping(false);
    throw error;
  }

  logger?.info("Reset database completed");
  (globalThis as any).isRestarting = true;
}

export function checkpointDatabase(logger?: Logger): void {
  if (!db || !statements) {
    setupDatabase(logger);
  }
  if (!db) {
    logger?.error("Database not initialised");
    throw new Error("Database not initialised");
  }

  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  logger?.debug("Database WAL checkpoint completed");
}
