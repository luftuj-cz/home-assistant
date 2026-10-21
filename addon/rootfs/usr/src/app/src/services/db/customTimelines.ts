import { getDatabase, setupDatabase } from "../database.js";
import { cachedStatement } from "./statementCache.js";
import type { TimelineEvent } from "./timeline.js";

/**
 * User-created weekly timelines that can override the season schedule.
 *
 * A custom timeline says only *when* modes run. It holds no mode values: the
 * modes it references apply the values of the season active by the calendar,
 * so one "Dovolená" behaves correctly in January and in July. Stored apart from
 * `timelines` and `timeline_events` so that no season code path can pick one up.
 */
export interface CustomTimeline {
  id: number;
  hruId: string;
  name: string;
}

export interface CustomTimelineSummary extends CustomTimeline {
  enabledEvents: number;
  totalEvents: number;
}

export interface CustomTimelineEvent {
  id?: number;
  customTimelineId: number;
  modeId: number;
  /** 0-6 (Monday = 0), or null for every day. */
  dayOfWeek: number | null;
  startTime: string;
  enabled: boolean;
  priority: number;
}

interface CustomTimelineRecord {
  id: number;
  hru_id: string;
  name: string;
}

interface CustomTimelineEventRecord {
  id: number;
  custom_timeline_id: number;
  mode_id: number;
  day_of_week: number | null;
  start_time: string;
  enabled: number;
  priority: number;
}

/** Raised when a name is already used by another custom timeline of the unit. */
export class CustomTimelineNameTakenError extends Error {
  constructor(public readonly timelineName: string) {
    super(`A custom timeline named "${timelineName}" already exists for this unit`);
    this.name = "CustomTimelineNameTakenError";
  }
}

/**
 * The form names are compared in: trimmed, NFC-normalised and lower-cased.
 * Stored alongside the name so the unique index is correct for non-ASCII
 * letters, which SQLite's NOCASE does not fold.
 */
export function nameKey(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

function requireDatabase() {
  if (!getDatabase()) {
    setupDatabase();
  }
  const db = getDatabase();
  if (!db) {
    throw new Error("Database not initialised");
  }
  return db;
}

function denormalise(record: CustomTimelineRecord): CustomTimeline {
  return { id: record.id, hruId: record.hru_id, name: record.name };
}

function denormaliseEvent(record: CustomTimelineEventRecord): CustomTimelineEvent {
  return {
    id: record.id,
    customTimelineId: record.custom_timeline_id,
    modeId: record.mode_id,
    dayOfWeek: record.day_of_week,
    startTime: record.start_time,
    enabled: record.enabled === 1,
    priority: record.priority,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

export function getCustomTimelines(hruId: string): CustomTimelineSummary[] {
  const db = requireDatabase();
  const records = cachedStatement(
    db,
    `SELECT t.id, t.hru_id, t.name,
            COUNT(e.id) AS total_events,
            COALESCE(SUM(e.enabled), 0) AS enabled_events
     FROM custom_timelines t
     LEFT JOIN custom_timeline_events e ON e.custom_timeline_id = t.id
     WHERE t.hru_id = ?
     GROUP BY t.id
     ORDER BY t.name_key`,
  ).all(hruId) as (CustomTimelineRecord & { total_events: number; enabled_events: number })[];

  return records.map((record) => ({
    ...denormalise(record),
    enabledEvents: record.enabled_events,
    totalEvents: record.total_events,
  }));
}

export function getCustomTimeline(id: number): CustomTimeline | null {
  const db = requireDatabase();
  const record = cachedStatement(
    db,
    `SELECT id, hru_id, name FROM custom_timelines WHERE id = ?`,
  ).get(id) as CustomTimelineRecord | undefined;
  return record ? denormalise(record) : null;
}

export function createCustomTimeline(hruId: string, name: string): CustomTimeline {
  const db = requireDatabase();
  try {
    const result = cachedStatement(
      db,
      `INSERT INTO custom_timelines (hru_id, name, name_key) VALUES (?, ?, ?)`,
    ).run(hruId, name, nameKey(name));
    return { id: Number(result.lastInsertRowid), hruId, name };
  } catch (err) {
    if (isUniqueViolation(err)) throw new CustomTimelineNameTakenError(name);
    throw err;
  }
}

export function renameCustomTimeline(id: number, name: string): CustomTimeline | null {
  const db = requireDatabase();
  try {
    cachedStatement(
      db,
      `UPDATE custom_timelines
       SET name = ?, name_key = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(name, nameKey(name), id);
  } catch (err) {
    if (isUniqueViolation(err)) throw new CustomTimelineNameTakenError(name);
    throw err;
  }
  return getCustomTimeline(id);
}

/** Removes the timeline; its events go with it through ON DELETE CASCADE. */
export function deleteCustomTimeline(id: number): void {
  const db = requireDatabase();
  cachedStatement(db, `DELETE FROM custom_timelines WHERE id = ?`).run(id);
}

export function getCustomTimelineEvents(customTimelineId: number): CustomTimelineEvent[] {
  const db = requireDatabase();
  const records = cachedStatement(
    db,
    `SELECT id, custom_timeline_id, mode_id, day_of_week, start_time, enabled, priority
     FROM custom_timeline_events
     WHERE custom_timeline_id = ?
     ORDER BY day_of_week NULLS LAST, start_time, priority DESC`,
  ).all(customTimelineId) as CustomTimelineEventRecord[];
  return records.map(denormaliseEvent);
}

export function getCustomTimelineEvent(
  customTimelineId: number,
  eventId: number,
): CustomTimelineEvent | null {
  const db = requireDatabase();
  const record = cachedStatement(
    db,
    `SELECT id, custom_timeline_id, mode_id, day_of_week, start_time, enabled, priority
     FROM custom_timeline_events
     WHERE custom_timeline_id = ? AND id = ?`,
  ).get(customTimelineId, eventId) as CustomTimelineEventRecord | undefined;
  return record ? denormaliseEvent(record) : null;
}

export function upsertCustomTimelineEvent(event: CustomTimelineEvent): CustomTimelineEvent {
  const db = requireDatabase();
  const values = [
    event.modeId,
    event.dayOfWeek,
    event.startTime,
    event.enabled ? 1 : 0,
    Number.isFinite(event.priority) ? event.priority : 0,
  ];

  if (event.id === undefined) {
    const result = cachedStatement(
      db,
      `INSERT INTO custom_timeline_events
         (custom_timeline_id, mode_id, day_of_week, start_time, enabled, priority)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(event.customTimelineId, ...values);
    return { ...event, id: Number(result.lastInsertRowid) };
  }

  // Scoped by timeline as well as id: event ids are only unique per table, and
  // a request naming another timeline's event must not move or rewrite it.
  cachedStatement(
    db,
    `UPDATE custom_timeline_events
     SET mode_id = ?, day_of_week = ?, start_time = ?, enabled = ?, priority = ?,
         updated_at = datetime('now')
     WHERE id = ? AND custom_timeline_id = ?`,
  ).run(...values, event.id, event.customTimelineId);
  return event;
}

export function deleteCustomTimelineEvent(customTimelineId: number, eventId: number): void {
  const db = requireDatabase();
  cachedStatement(
    db,
    `DELETE FROM custom_timeline_events WHERE id = ? AND custom_timeline_id = ?`,
  ).run(eventId, customTimelineId);
}

/** Replaces every event of the timeline in one transaction. */
export function replaceCustomTimelineEvents(
  customTimelineId: number,
  events: Omit<CustomTimelineEvent, "id" | "customTimelineId">[],
): CustomTimelineEvent[] {
  const db = requireDatabase();
  const replace = db.transaction(() => {
    cachedStatement(db, `DELETE FROM custom_timeline_events WHERE custom_timeline_id = ?`).run(
      customTimelineId,
    );
    return events.map((event) => upsertCustomTimelineEvent({ ...event, customTimelineId }));
  });
  return replace();
}

export function countEnabledCustomEvents(customTimelineId: number): number {
  const db = requireDatabase();
  const row = cachedStatement(
    db,
    `SELECT COUNT(*) AS n FROM custom_timeline_events WHERE custom_timeline_id = ? AND enabled = 1`,
  ).get(customTimelineId) as { n: number };
  return row.n;
}

/** Ids of the modes that enabled events of the unit's custom timelines reference. */
export function getModeIdsUsedByCustomTimelines(hruId: string): number[] {
  const db = requireDatabase();
  const rows = cachedStatement(
    db,
    `SELECT DISTINCT e.mode_id
     FROM custom_timeline_events e
     JOIN custom_timelines t ON t.id = e.custom_timeline_id
     WHERE t.hru_id = ? AND e.enabled = 1
     ORDER BY e.mode_id`,
  ).all(hruId) as { mode_id: number }[];
  return rows.map((row) => row.mode_id);
}

export interface CustomTimelineModeUsage {
  customTimelineId: number;
  name: string;
  /** Enabled events of this timeline that reference the mode. */
  enabledEvents: number;
  /** True when removing the mode would leave the timeline with no enabled event. */
  wouldBeLeftEmpty: boolean;
}

/** Per custom timeline of the unit, how many enabled events reference the mode. */
export function getCustomModeUsage(hruId: string, modeId: number): CustomTimelineModeUsage[] {
  const db = requireDatabase();
  const rows = cachedStatement(
    db,
    `SELECT t.id, t.name,
            COALESCE(SUM(CASE WHEN e.enabled = 1 AND e.mode_id = ? THEN 1 ELSE 0 END), 0) AS using_mode,
            COALESCE(SUM(e.enabled), 0) AS enabled_total
     FROM custom_timelines t
     LEFT JOIN custom_timeline_events e ON e.custom_timeline_id = t.id
     WHERE t.hru_id = ?
     GROUP BY t.id
     ORDER BY t.name_key`,
  ).all(modeId, hruId) as { id: number; name: string; using_mode: number; enabled_total: number }[];

  return rows
    .filter((row) => row.using_mode > 0)
    .map((row) => ({
      customTimelineId: row.id,
      name: row.name,
      enabledEvents: row.using_mode,
      wouldBeLeftEmpty: row.using_mode === row.enabled_total,
    }));
}

/**
 * The event in the shape the picker and the week editor already use, with the
 * mode referenced by id - the only kind of reference a custom event can hold.
 */
export function toTimelineEvent(event: CustomTimelineEvent, hruId: string): TimelineEvent {
  return {
    id: event.id,
    startTime: event.startTime,
    dayOfWeek: event.dayOfWeek,
    hruConfig: { mode: event.modeId },
    luftatorConfig: null,
    enabled: event.enabled,
    priority: event.priority,
    hruId,
    timelineId: null,
  };
}
