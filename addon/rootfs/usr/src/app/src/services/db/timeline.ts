import { TIMELINE_MODES_KEY, type TimelineMode } from "../../types/index.js";
import { db, moduleLogger, setupDatabase, statements } from "../database.js";

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

export function normaliseTimelineEvent(
  event: TimelineEvent,
): Omit<TimelineEventRecord, "id" | "created_at" | "updated_at"> {
  const enabled = event.enabled ?? true;
  const priority = Number.isFinite(event.priority) ? (event.priority) : 0;

  let hruConfig: string | null = null;
  let luftatorConfig: string | null = null;

  try {
    hruConfig = event.hruConfig ? JSON.stringify(event.hruConfig) : null;
  } catch (err) {
    moduleLogger?.error(err as Error, "Failed to serialise hruConfig for timeline event");
  }

  try {
    luftatorConfig = event.luftatorConfig ? JSON.stringify(event.luftatorConfig) : null;
  } catch (err) {
    moduleLogger?.error(err as Error, "Failed to serialise luftatorConfig for timeline event");
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

export function denormaliseTimelineEvent(record: TimelineEventRecord): TimelineEvent {
  return {
    id: record.id,
    startTime: record.start_time,
    dayOfWeek: record.day_of_week,
    hruConfig: record.hru_config ? JSON.parse(record.hru_config) : null,
    luftatorConfig: record.luftator_config ? JSON.parse(record.luftator_config) : null,
    enabled: Boolean(record.enabled),
    priority: record.priority,
    hruId: record.hru_id,
  };
}

export function getTimelineEvents(hruId?: string | null): TimelineEvent[] {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    moduleLogger?.error("Database not initialised in getTimelineEvents");
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

export function getTimelineModes(hruId?: string): TimelineMode[] {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    return [];
  }

  const records = statements.getTimelineModes.all(hruId ?? null) as TimelineModeRecord[];

  return records
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color ?? undefined,
      power: r.power ?? undefined,
      temperature: r.temperature ?? undefined,
      luftatorConfig: r.luftator_config ? JSON.parse(r.luftator_config) : undefined,
      isBoost: Boolean(r.is_boost),
      hruId: r.hru_id ?? undefined,
      nativeMode: r.native_mode ?? undefined,
      variables: r.variables ? JSON.parse(r.variables) : undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getTimelineMode(id: number): TimelineMode | null {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    return null;
  }

  const record = statements.getTimelineMode.get(id) as TimelineModeRecord | undefined;
  if (!record) return null;

  return {
    id: record.id,
    name: record.name,
    color: record.color ?? undefined,
    power: record.power ?? undefined,
    temperature: record.temperature ?? undefined,
    luftatorConfig: record.luftator_config ? JSON.parse(record.luftator_config) : undefined,
    isBoost: Boolean(record.is_boost),
    hruId: record.hru_id ?? undefined,
    nativeMode: record.native_mode ?? undefined,
    variables: record.variables ? JSON.parse(record.variables) : undefined,
  };
}

export function upsertTimelineMode(mode: TimelineMode): TimelineMode {
  if (!db || !statements) {
    setupDatabase();
  }
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
  moduleLogger?.debug({ id, name: mode.name }, "Upserted timeline mode");

  return {
    ...mode,
    id,
  };
}

export function deleteTimelineMode(id: number): void {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    throw new Error("Database not initialised");
  }
  statements.deleteTimelineMode.run(id);
  moduleLogger?.debug({ id }, "Deleted timeline mode");
}

export function assignLegacyEventsToUnit(hruId: string): void {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    moduleLogger?.error("Database not initialised in assignLegacyEventsToUnit");
    throw new Error("Database not initialised");
  }

  statements.assignLegacyEvents.run(hruId);
  moduleLogger?.debug({ hruId }, "Assigned legacy events to unit");
}

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
        moduleLogger?.info(
          { eventId: event.id, oldMode: rawMode, newModeId: foundMode.id },
          "Migrated legacy event mode name to ID",
        );
      }
    }
  }

  if (migratedCount > 0) {
    moduleLogger?.info({ count: migratedCount }, "Finished migrating legacy events for unit");
  }
}

export function upsertTimelineEvent(event: TimelineEvent): TimelineEvent {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    moduleLogger?.error({ eventId: event.id }, "Database not initialised in upsertTimelineEvent");
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
    ) as { lastInsertRowid: number | bigint; changes: number };
  } catch (err) {
    moduleLogger?.error(err as Error, "Failed to upsert timeline event");
    throw err;
  }

  const persistedId = event.id ?? Number(result.lastInsertRowid);
  moduleLogger?.debug({ id: persistedId }, "Upserted timeline event");

  return {
    ...event,
    id: persistedId,
  };
}

export function deleteTimelineEvent(id: number): void {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    moduleLogger?.error({ id }, "Database not initialised in deleteTimelineEvent");
    throw new Error("Database not initialised");
  }

  statements.deleteTimelineEvent.run(id);
  moduleLogger?.debug({ id }, "Deleted timeline event");
}

export function deleteTimelineEventsByMode(modeId: number): void {
  if (!db || !statements) {
    setupDatabase();
  }
  if (!statements) {
    moduleLogger?.error({ modeId }, "Database not initialised in deleteTimelineEventsByMode");
    throw new Error("Database not initialised");
  }
  statements.deleteEventsByMode.run(modeId);
  moduleLogger?.debug({ modeId }, "Deleted timeline events by mode");
}

export function migrateModesToTable(getAppSetting: (key: string) => string | null): void {
  if (!db || !statements) return;

  const raw = getAppSetting(TIMELINE_MODES_KEY);
  if (!raw) return;

  try {
    const oldModes = JSON.parse(raw) as TimelineMode[];
    if (Array.isArray(oldModes) && oldModes.length > 0) {
      moduleLogger?.info(
        { count: oldModes.length },
        "Migrating modes from JSON settings to SQL table",
      );

      db.transaction(() => {
        for (const mode of oldModes) {
          try {
            statements!.upsertTimelineMode.run(
              mode.id,
              mode.name,
              mode.color ?? null,
              mode.power ?? null,
              mode.temperature ?? null,
              mode.luftatorConfig ? JSON.stringify(mode.luftatorConfig) : null,
              mode.isBoost ? 1 : 0,
              mode.hruId ?? null,
            );
          } catch (err) {
            moduleLogger?.warn(
              { name: mode.name, err },
              "Skipping duplicate mode during migration",
            );
          }
        }
        statements!.upsertSetting.run(TIMELINE_MODES_KEY, "");
      })();
    }
  } catch (err) {
    moduleLogger?.error({ err }, "Failed to migrate modes to table");
  }
}
