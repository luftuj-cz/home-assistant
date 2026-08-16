import { copyFileSync, existsSync, promises as fsp } from "node:fs";
import DatabaseConstructor from "better-sqlite3";
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
import { latestSchemaVersion, SCHEMA_VERSION_SETTING_KEY } from "./migrations.js";

/**
 * Reads the schema version recorded in a database file without opening it as
 * the live database. Returns 0 for a file written before versions were stamped,
 * which is always safe to import - migrations only run forward.
 */
function readSchemaVersion(filePath: string, logger?: Logger): number {
  let probe: InstanceType<typeof DatabaseConstructor> | null = null;
  try {
    probe = new DatabaseConstructor(filePath, { readonly: true, fileMustExist: true });
    const row = probe
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(SCHEMA_VERSION_SETTING_KEY) as { value?: string } | undefined;
    const parsed = Number.parseInt(row?.value ?? "0", 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch (err) {
    // A pre-versioning database has no such row, and a genuinely unreadable
    // file fails later on its own terms. Neither is a reason to block here.
    logger?.debug({ err }, "Could not read schema version from incoming database");
    return 0;
  } finally {
    probe?.close();
  }
}

/**
 * Rejects a database written by a newer build before it can replace the live
 * one. An older build has no season filter in its event queries, so importing a
 * multi-season database would silently merge every season's events into one
 * schedule and drive the hardware from the union.
 */
export function assertImportableSchemaVersion(filePath: string, logger?: Logger): void {
  const incoming = readSchemaVersion(filePath, logger);
  const supported = latestSchemaVersion();
  if (incoming > supported) {
    throw new Error(
      `This backup was created by a newer version of the add-on ` +
        `(database schema ${incoming}, this build supports ${supported}). ` +
        `Update the add-on before importing it.`,
    );
  }
}

/**
 * Creates a backup of the current database.
 *
 * The database runs in WAL mode, so the main file on its own can be missing
 * everything committed since the last checkpoint - in the worst case including
 * the schema, leaving a copy that cannot be opened at all. The write-ahead log
 * is therefore folded in first, and if that fails the `-wal`/`-shm` sidecars are
 * copied alongside so SQLite can still recover them.
 *
 * Synchronous on purpose: callers take this backup immediately before something
 * destructive, and the copy has to be on disk before that runs.
 *
 * @param logger - Optional logger instance
 * @returns Path to the backup file, or null when there was nothing to copy or
 *          the copy failed. A caller about to destroy data should treat null as
 *          a reason to stop.
 */
export function createDatabaseBackupSync(logger?: Logger): string | null {
  const activeLogger = logger ?? getModuleLogger();
  const sourcePath = getDatabasePath();
  if (!existsSync(sourcePath)) {
    return null;
  }

  let checkpointed = true;
  try {
    checkpointDatabase(logger);
  } catch (err) {
    checkpointed = false;
    activeLogger?.warn({ err }, "WAL checkpoint before backup failed, copying the log alongside");
  }

  const backupPath = `${sourcePath}.${Date.now()}.bak`;
  try {
    copyFileSync(sourcePath, backupPath);
    if (!checkpointed) {
      for (const suffix of ["-wal", "-shm"]) {
        if (existsSync(`${sourcePath}${suffix}`)) {
          copyFileSync(`${sourcePath}${suffix}`, `${backupPath}${suffix}`);
        }
      }
    }
  } catch (err) {
    activeLogger?.error({ err, sourcePath }, "Failed to create database backup");
    return null;
  }

  activeLogger?.info({ backupPath, checkpointed }, "Created database backup");
  return backupPath;
}

/**
 * Async wrapper, kept for the route handlers that already await it.
 * @returns Path to the backup file or null if it could not be created
 */
export async function createDatabaseBackup(logger?: Logger): Promise<string | null> {
  return createDatabaseBackupSync(logger);
}

/**
 * Replaces the current database with a provided buffer
 * @param buffer - Database file content as buffer
 * @param logger - Optional logger instance
 */
export async function replaceDatabaseWithFile(buffer: Buffer, logger?: Logger): Promise<void> {
  const dbPath = getDatabasePath();
  const tempPath = `${dbPath}.tmp`;

  // Validate the incoming file BEFORE touching the live database, so a rejected
  // import leaves the running installation exactly as it was.
  await fsp.writeFile(tempPath, buffer);
  try {
    assertImportableSchemaVersion(tempPath, logger);
  } catch (err) {
    await fsp.unlink(tempPath).catch(() => undefined);
    throw err;
  }

  // Guard the swap with isStopping so a concurrent lazy setupDatabase() (from a
  // background tick) can't reopen the OLD db in the close→rename window and leave
  // readers pinned to pre-import data. Only our own reopen below wins.
  setStopping(true);
  try {
    closeDatabase();

    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    try {
      if (existsSync(walPath)) await fsp.unlink(walPath);
      if (existsSync(shmPath)) await fsp.unlink(shmPath);
    } catch {
      logger?.warn("Failed to delete auxiliary database files during replacement");
    }

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
