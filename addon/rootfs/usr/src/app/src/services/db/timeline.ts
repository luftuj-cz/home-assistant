import { TIMELINE_MODES_KEY, type TimelineMode } from "../../types/index.js";
import { getDatabase, getModuleLogger, getStatements, setupDatabase } from "../database.js";

export interface TimelineEvent {
  id?: number;
  startTime: string; // HH:MM
  dayOfWeek?: number | null; // 0-6 (Sunday=0), null for all days
  hruConfig?: {
    mode?: string | number;
    power?: number;
    temperature?: number;
    variables?: Record<string, number | string | boolean>;
  } | null;
  luftatorConfig?: Record<string, number> | null;
  enabled: boolean;
  priority: number;
  hruId?: string | null;
}

export interface TimelineEventRecord {
  id: number;
  start_time: string;
  day_of_week: number | null;
  hru_config: string | null;
  luftator_config: string | null;
  enabled: number;
  priority: number;
  hru_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Normalizes a timeline event for database storage
 * @param event - Timeline event to normalize
 * @returns Database record format (without id, created_at, updated_at)
 */
export function normaliseTimelineEvent(
  event: TimelineEvent,
): Omit<TimelineEventRecord, "id" | "created_at" | "updated_at"> {
  const enabled = event.enabled ?? true;
  const priority = Number.isFinite(event.priority) ? event.priority : 0;

  let hruConfig: string | null = null;
  let luftatorConfig: string | null = null;

  try {
    hruConfig = event.hruConfig ? JSON.stringify(event.hruConfig) : null;
  } catch (err) {
    getModuleLogger()?.error(err as Error, "Failed to serialise hruConfig for timeline event");
  }

  try {
    luftatorConfig = event.luftatorConfig ? JSON.stringify(event.luftatorConfig) : null;
  } catch (err) {
    getModuleLogger()?.error(err as Error, "Failed to serialise luftatorConfig for timeline event");
  }

  return {
    start_time: event.startTime,
    day_of_week: event.dayOfWeek ?? null,
    hru_config: hruConfig,
    luftator_config: luftatorConfig,
    enabled: enabled ? 1 : 0,
    priority,
    hru_id: event.hruId ?? null,
  };
}

/**
 * Denormalizes a database record to a timeline event
 * @param record - Database record
 * @returns Timeline event object
 */
export function denormaliseTimelineEvent(record: TimelineEventRecord): TimelineEvent {
  let hruConfig = null;
  if (record.hru_config) {
    try {
      hruConfig = JSON.parse(record.hru_config);
    } catch (err) {
      getModuleLogger()?.error({ err, recordId: record.id }, "Failed to parse hru_config JSON");
    }
  }

  let luftatorConfig = null;
  if (record.luftator_config) {
    try {
      luftatorConfig = JSON.parse(record.luftator_config);
    } catch (err) {
      getModuleLogger()?.error(
        { err, recordId: record.id },
        "Failed to parse luftator_config JSON",
      );
    }
  }

  return {
    id: record.id,
    startTime: record.start_time,
    dayOfWeek: record.day_of_week,
    hruConfig,
    luftatorConfig,
    enabled: Boolean(record.enabled),
    priority: record.priority,
    hruId: record.hru_id,
  };
}

/**
 * Retrieves all timeline events for a specific HRU unit
 * @param hruId - Optional HRU unit ID (null/undefined for global events)
 * @returns Array of timeline events
 */
export function getTimelineEvents(hruId?: string | null): TimelineEvent[] {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    getModuleLogger()?.error("Database not initialised in getTimelineEvents");
    throw new Error("Database not initialised");
  }

  const targetHruId = hruId ?? "";

  const records = statements.getTimelineEvents.all(targetHruId) as TimelineEventRecord[];
  return records.map(denormaliseTimelineEvent);
}

export interface TimelineModeRecord {
  id: number;
  name: string;
  color: string | null;
  power: number | null;
  temperature: number | null;
  luftator_config: string | null;
  is_boost: number;
  hru_id: string | null;
  native_mode: number | null;
  variables: string | null;
}

/**
 * Retrieves all timeline modes for a specific HRU unit
 * @param hruId - Optional HRU unit ID (null/undefined for global modes)
 * @returns Array of timeline modes sorted by name
 */
export function getTimelineModes(hruId?: string): TimelineMode[] {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    getModuleLogger()?.error("Database not initialised in getTimelineModes");
    throw new Error("Database not initialised");
  }

  const records = statements.getTimelineModes.all(hruId ?? null) as TimelineModeRecord[];

  return records
    .map((r) => {
      let luftatorConfig = undefined;
      if (r.luftator_config) {
        try {
          luftatorConfig = JSON.parse(r.luftator_config);
        } catch (err) {
          getModuleLogger()?.error({ err, modeId: r.id }, "Failed to parse luftator_config JSON");
        }
      }

      let variables = undefined;
      if (r.variables) {
        try {
          variables = JSON.parse(r.variables);
        } catch (err) {
          getModuleLogger()?.error({ err, modeId: r.id }, "Failed to parse variables JSON");
        }
      }

      return {
        id: r.id,
        name: r.name,
        color: r.color ?? undefined,
        power: r.power ?? undefined,
        temperature: r.temperature ?? undefined,
        luftatorConfig,
        isBoost: Boolean(r.is_boost),
        hruId: r.hru_id ?? undefined,
        nativeMode: r.native_mode ?? undefined,
        variables,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Retrieves a single timeline mode by ID
 * @param id - Timeline mode ID
 * @returns Timeline mode or null if not found
 */
export function getTimelineMode(id: number): TimelineMode | null {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    return null;
  }

  const record = statements.getTimelineMode.get(id) as TimelineModeRecord | undefined;
  if (!record) return null;

  let luftatorConfig = undefined;
  if (record.luftator_config) {
    try {
      luftatorConfig = JSON.parse(record.luftator_config);
    } catch (err) {
      getModuleLogger()?.error({ err, modeId: record.id }, "Failed to parse luftator_config JSON");
    }
  }

  let variables = undefined;
  if (record.variables) {
    try {
      variables = JSON.parse(record.variables);
    } catch (err) {
      getModuleLogger()?.error({ err, modeId: record.id }, "Failed to parse variables JSON");
    }
  }

  return {
    id: record.id,
    name: record.name,
    color: record.color ?? undefined,
    power: record.power ?? undefined,
    temperature: record.temperature ?? undefined,
    luftatorConfig,
    isBoost: Boolean(record.is_boost),
    hruId: record.hru_id ?? undefined,
    nativeMode: record.native_mode ?? undefined,
    variables,
  };
}

/**
 * Creates or updates a timeline mode
 * @param mode - Timeline mode to upsert
 * @returns Timeline mode with assigned ID
 */
export function upsertTimelineMode(mode: TimelineMode): TimelineMode {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    throw new Error("Database not initialised");
  }

  const result = statements.upsertTimelineMode.run(
    mode.id ?? null, // Auto-increment if null
    mode.name,
    mode.color ?? null,
    mode.power ?? null,
    mode.temperature ?? null,
    mode.luftatorConfig ? JSON.stringify(mode.luftatorConfig) : null,
    mode.isBoost ? 1 : 0,
    mode.hruId ?? null,
    mode.nativeMode ?? null,
    mode.variables ? JSON.stringify(mode.variables) : null,
  ) as { lastInsertRowid: number | bigint };

  const id = mode.id ?? Number(result.lastInsertRowid);
  getModuleLogger()?.debug({ id, name: mode.name }, "Upserted timeline mode");

  return {
    ...mode,
    id,
  };
}

/**
 * Deletes a timeline mode by ID
 * @param id - Timeline mode ID
 */
export function deleteTimelineMode(id: number): void {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    throw new Error("Database not initialised");
  }
  statements.deleteTimelineMode.run(id);
  getModuleLogger()?.debug({ id }, "Deleted timeline mode");
}

/**
 * Assigns legacy (unit-less) events to a specific HRU unit
 * @param hruId - HRU unit ID to assign events to
 */
export function assignLegacyEventsToUnit(hruId: string): void {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    getModuleLogger()?.error("Database not initialised in assignLegacyEventsToUnit");
    throw new Error("Database not initialised");
  }

  statements.assignLegacyEvents.run(hruId);
  getModuleLogger()?.debug({ hruId }, "Assigned legacy events to unit");
}

/**
 * Migrates legacy events that use mode names instead of mode IDs
 * @param hruId - HRU unit ID to migrate events for
 */
export function migrateLegacyEventsForUnit(hruId: string): void {
  const modes = getTimelineModes();
  const events = getTimelineEvents(hruId);
  let migratedCount = 0;

  for (const event of events) {
    const rawMode = event.hruConfig?.mode;
    if (rawMode && !/^\d+$/.test(String(rawMode))) {
      // It's a name (e.g. "Vypnuto")
      const foundMode = modes.find((m) => m.name === rawMode);
      if (foundMode) {
        // Update to ID
        const updatedEvent = {
          ...event,
          hruConfig: {
            ...event.hruConfig,
            mode: foundMode.id.toString(),
          },
        };
        upsertTimelineEvent(updatedEvent);
        migratedCount++;
        getModuleLogger()?.info(
          { eventId: event.id, oldMode: rawMode, newModeId: foundMode.id },
          "Migrated legacy event mode name to ID",
        );
      }
    }
  }

  if (migratedCount > 0) {
    getModuleLogger()?.info({ count: migratedCount }, "Finished migrating legacy events for unit");
  }
}

/**
 * Creates or updates a timeline event
 * @param event - Timeline event to upsert
 * @returns Timeline event with assigned ID
 */
export function upsertTimelineEvent(event: TimelineEvent): TimelineEvent {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    getModuleLogger()?.error(
      { eventId: event.id },
      "Database not initialised in upsertTimelineEvent",
    );
    throw new Error("Database not initialised");
  }

  const normalised = normaliseTimelineEvent(event);

  let result: { lastInsertRowid: number | bigint; changes: number };
  try {
    result = statements.upsertTimelineEvent.run(
      event.id ?? null,
      normalised.start_time,
      normalised.day_of_week,
      normalised.hru_config,
      normalised.luftator_config,
      normalised.enabled,
      normalised.priority,
      normalised.hru_id,
    );
  } catch (err) {
    getModuleLogger()?.error(err as Error, "Failed to upsert timeline event");
    throw err;
  }

  const persistedId = event.id ?? Number(result.lastInsertRowid);
  getModuleLogger()?.debug({ id: persistedId }, "Upserted timeline event");

  return {
    ...event,
    id: persistedId,
  };
}

/**
 * Deletes a timeline event by ID
 * @param id - Timeline event ID
 */
export function deleteTimelineEvent(id: number): void {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    getModuleLogger()?.error({ id }, "Database not initialised in deleteTimelineEvent");
    throw new Error("Database not initialised");
  }

  statements.deleteTimelineEvent.run(id);
  getModuleLogger()?.debug({ id }, "Deleted timeline event");
}

/**
 * Deletes all timeline events associated with a specific mode
 * @param modeId - Timeline mode ID
 * @param modeName - Optional timeline mode name reference
 */
export function deleteTimelineEventsByMode(modeId: number, modeName?: string): void {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    getModuleLogger()?.error({ modeId }, "Database not initialised in deleteTimelineEventsByMode");
    throw new Error("Database not initialised");
  }
  if (modeName) {
    statements.deleteEventsByMode.run(modeId, modeName);
  } else {
    statements.deleteEventsByModeIdOnly.run(modeId);
  }
  getModuleLogger()?.debug({ modeId, modeName }, "Deleted timeline events by mode");
}

/**
 * Migrates timeline modes from JSON settings to SQL table
 * @param getAppSetting - Function to retrieve app settings
 */
export function migrateModesToTable(getAppSetting: (key: string) => string | null): void {
  if (!getDatabase() || !getStatements()) return;

  const raw = getAppSetting(TIMELINE_MODES_KEY);
  if (!raw) return;

  try {
    const oldModes = JSON.parse(raw) as TimelineMode[];
    if (Array.isArray(oldModes) && oldModes.length > 0) {
      getModuleLogger()?.info(
        { count: oldModes.length },
        "Migrating modes from JSON settings to SQL table",
      );

      const stmt = getStatements()!;
      getDatabase()!.transaction(() => {
        for (const mode of oldModes) {
          try {
            stmt.upsertTimelineMode.run(
              mode.id ?? null,
              mode.name,
              mode.color ?? null,
              mode.power ?? null,
              mode.temperature ?? null,
              mode.luftatorConfig ? JSON.stringify(mode.luftatorConfig) : null,
              mode.isBoost ? 1 : 0,
              mode.hruId ?? null,
              mode.nativeMode ?? null,
              mode.variables ? JSON.stringify(mode.variables) : null,
            );
          } catch (err) {
            if (String(err).includes("UNIQUE constraint failed")) {
              getModuleLogger()?.warn(
                { name: mode.name, err },
                "Skipping duplicate mode during migration",
              );
              continue;
            }
            throw err;
          }
        }
        stmt.upsertSetting.run(TIMELINE_MODES_KEY, "");
      })();
    }
  } catch (err) {
    getModuleLogger()?.error({ err }, "Failed to migrate modes to table");
  }
}
