import { getDatabase, getModuleLogger, getStatements, setupDatabase } from "../database.js";

export interface ValveGroup {
  id: number;
  name: string;
  sortOrder: number;
  entityIds: string[];
}

export interface ValveGroupRecord {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function denormaliseValveGroup(record: ValveGroupRecord, entityIds: string[]): ValveGroup {
  return {
    id: record.id,
    name: record.name,
    sortOrder: record.sort_order,
    entityIds,
  };
}

/**
 * Retrieves all valve groups with their assigned valve entity ids, sorted by sort_order
 */
export function getValveGroups(): ValveGroup[] {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    getModuleLogger()?.error("Database not initialised in getValveGroups");
    throw new Error("Database not initialised");
  }

  const groupRecords = statements.getValveGroups.all() as ValveGroupRecord[];
  const memberRows = statements.getAllValveGroupMembers.all() as {
    entity_id: string;
    group_id: number;
  }[];

  const membersByGroup = new Map<number, string[]>();
  for (const row of memberRows) {
    const list = membersByGroup.get(row.group_id) ?? [];
    list.push(row.entity_id);
    membersByGroup.set(row.group_id, list);
  }

  return groupRecords.map((record) =>
    denormaliseValveGroup(record, membersByGroup.get(record.id) ?? []),
  );
}

/**
 * Retrieves a single valve group by id, or null if not found
 */
export function getValveGroup(id: number): ValveGroup | null {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    return null;
  }

  const record = statements.getValveGroup.get(id) as ValveGroupRecord | undefined;
  if (!record) return null;

  const memberRows = statements.getValveGroupMembers.all(id) as { entity_id: string }[];
  return denormaliseValveGroup(
    record,
    memberRows.map((row) => row.entity_id),
  );
}

/**
 * Creates or updates a valve group (name/sortOrder)
 */
export function upsertValveGroup(group: {
  id?: number;
  name: string;
  sortOrder?: number;
}): ValveGroup {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    throw new Error("Database not initialised");
  }

  const result = statements.upsertValveGroup.run(
    group.id ?? null,
    group.name,
    group.sortOrder ?? 0,
  ) as { lastInsertRowid: number | bigint };

  const id = group.id ?? Number(result.lastInsertRowid);
  getModuleLogger()?.debug({ id, name: group.name }, "Upserted valve group");

  return getValveGroup(id) as ValveGroup;
}

/**
 * Deletes a valve group and its memberships
 */
export function deleteValveGroup(id: number): void {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  const database = getDatabase();
  if (!statements || !database) {
    throw new Error("Database not initialised");
  }

  const runDelete = database.transaction(() => {
    statements.deleteValveGroupMembersByGroup.run(id);
    statements.deleteValveGroup.run(id);
  });
  runDelete();
  getModuleLogger()?.debug({ id }, "Deleted valve group");
}

/**
 * Replaces the membership set for a group. Each entityId is removed from any
 * other group first, since a valve can only belong to one group at a time.
 */
export function setGroupMembers(groupId: number, entityIds: string[]): void {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  const database = getDatabase();
  if (!statements || !database) {
    throw new Error("Database not initialised");
  }

  // entity_id is the members table's primary key - a duplicate in entityIds
  // would otherwise violate it mid-transaction and roll back the whole update.
  const uniqueEntityIds = Array.from(new Set(entityIds));

  const runAssign = database.transaction(() => {
    statements.deleteValveGroupMembersByGroup.run(groupId);
    for (const entityId of uniqueEntityIds) {
      statements.deleteValveGroupMemberByEntity.run(entityId);
      statements.insertValveGroupMember.run(entityId, groupId);
    }
  });
  runAssign();
  getModuleLogger()?.debug({ groupId, count: entityIds.length }, "Set valve group members");
}

/**
 * Removes a single valve from whichever group it belongs to
 */
export function removeValveFromGroup(entityId: string): void {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    throw new Error("Database not initialised");
  }
  statements.deleteValveGroupMemberByEntity.run(entityId);
  getModuleLogger()?.debug({ entityId }, "Removed valve from group");
}
