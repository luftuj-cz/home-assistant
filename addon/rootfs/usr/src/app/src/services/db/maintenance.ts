import { copyFileSync, existsSync, promises as fsp } from "node:fs";
import type { Logger } from "pino";
import {
  closeDatabase,
  getDatabase,
  getDatabasePath,
  getModuleLogger,
  getStatements,
  setStopping,
  setupDatabase,
} from "../database.js";

/**
 * Creates a backup of the current database
 * @returns Path to the backup file or null if database doesn't exist
 */
export async function createDatabaseBackup(): Promise<string | null> {
  const sourcePath = getDatabasePath();
  if (!existsSync(sourcePath)) {
    return null;
  }

  const backupPath = `${sourcePath}.${Date.now()}.bak`;
  copyFileSync(sourcePath, backupPath);
  getModuleLogger()?.info({ backupPath }, "Created database backup");
  return backupPath;
}

/**
 * Replaces the current database with a provided buffer
 * @param buffer - Database file content as buffer
 * @param logger - Optional logger instance
 */
export async function replaceDatabaseWithFile(buffer: Buffer, logger?: Logger): Promise<void> {
  // Guard the swap with isStopping so a concurrent lazy setupDatabase() (from a
  // background tick) can't reopen the OLD db in the close→rename window and leave
  // readers pinned to pre-import data. Only our own reopen below wins.
  setStopping(true);
  try {
    closeDatabase();

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
  } finally {
    setStopping(false);
  }

  // isStopping is false again; this opens the freshly imported file.
  setupDatabase(logger);
  logger?.info("Database replaced from backup file");
}

/**
 * Resets the database by deleting all database files
 * @param logger - Optional logger instance
 */
export async function resetDatabase(logger?: Logger): Promise<void> {
  setStopping(true);
  closeDatabase();

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

/**
 * Performs a WAL checkpoint to flush changes to the main database file
 * @param logger - Optional logger instance
 */
export function checkpointDatabase(logger?: Logger): void {
  if (!getDatabase() || !getStatements()) {
    setupDatabase(logger);
  }
  if (!getDatabase()) {
    logger?.error("Database not initialised");
    throw new Error("Database not initialised");
  }

  getDatabase()!.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  logger?.debug("Database WAL checkpoint completed");
}
