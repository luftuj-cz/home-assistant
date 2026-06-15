import {
  getDatabase,
  getModuleLogger,
  getStatements,
  setupDatabase,
  type ValveSnapshotRecord,
  type ValveStateRecord,
} from "../database.js";

function normaliseRecord(record: ValveSnapshotRecord): ValveStateRecord {
  return {
    entity_id: record.entityId,
    controller_id: record.controllerId,
    name: record.name ?? null,
    value: record.value ?? null,
    state: record.state ?? null,
    attributes: JSON.stringify(record.attributes ?? {}),
    timestamp: record.timestamp ?? new Date().toISOString(),
  };
}

/**
 * Stores valve snapshots in the database
 * @param records - Array of valve snapshot records to store
 */
export function storeValveSnapshots(records: ValveSnapshotRecord[]): void {
  if (records.length === 0) {
    return;
  }

  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!getDatabase() || !statements) {
    getModuleLogger()?.error("Database initialisation failed in storeValveSnapshots");
    throw new Error("Database init failed");
  }

  const prepared = statements;

  const transaction = getDatabase()!.transaction((items: ValveSnapshotRecord[]) => {
    for (const item of items) {
      const record = normaliseRecord(item);
      if (record.controller_id) {
        prepared.upsertController.run(record.controller_id, item.controllerName ?? null);
      }
      prepared.upsertValveState.run(
        record.entity_id,
        record.controller_id,
        record.name,
        record.value,
        record.state,
        record.timestamp,
        record.attributes,
      );
    }
  });

  transaction(records);
  getModuleLogger()?.debug({ count: records.length }, "Stored valve snapshots");
}
