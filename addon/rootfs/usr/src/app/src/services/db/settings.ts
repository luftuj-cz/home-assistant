import { getDatabase, getModuleLogger, getStatements, setupDatabase } from "../database.js";

/**
 * Retrieves all app settings
 * @returns Record of all app settings as key-value pairs
 */
export function getAllAppSettings(): Record<string, string> {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    getModuleLogger()?.error("Database not initialised in getAllAppSettings");
    throw new Error("Database not initialised");
  }

  const rows = statements.getAllSettings.all() as Array<{ key: string; value: string }>;
  return rows.reduce<Record<string, string>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

/**
 * Retrieves a specific app setting by key
 * @param key - Setting key
 * @returns Setting value or null if not found
 */
export function getAppSetting(key: string): string | null {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    getModuleLogger()?.error({ key }, "Database not initialised in getAppSetting");
    throw new Error("Database not initialised");
  }

  const row = statements.getSetting.get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Sets an app setting
 * @param key - Setting key
 * @param value - Setting value
 */
export function setAppSetting(key: string, value: string): void {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    getModuleLogger()?.error({ key }, "Database not initialised in setAppSetting");
    throw new Error("Database not initialised");
  }

  statements.upsertSetting.run(key, value);
  getModuleLogger()?.debug({ key }, "Updated app setting");
}
