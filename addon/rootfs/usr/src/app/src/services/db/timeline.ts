import { TIMELINE_MODES_KEY, type TimelineMode } from "../../types/index.js";
import { getDatabase, getModuleLogger, getStatements, setupDatabase } from "../database.js";
import { cachedStatement } from "./statementCache.js";

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
  /** Season this event belongs to. Null only on databases predating seasons. */
  timelineId?: number | null;
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
  timeline_id?: number | null;
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
    timeline_id: event.timelineId ?? null,
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
    timelineId: record.timeline_id ?? null,
  };
}

/**
 * Retrieves all timeline events for a specific HRU unit
 * @param hruId - Optional HRU unit ID (null/undefined for global events)
 * @returns Array of timeline events
 */
export function getTimelineEvents(hruId?: string | null, timelineId?: number): TimelineEvent[] {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    getModuleLogger()?.error("Database not initialised in getTimelineEvents");
    throw new Error("Database not initialised");
  }

  // Scoping by season is what stops several seasons' schedules being merged
  // into one. Without a season the unit-wide read is used, which is the
  // pre-seasons behaviour and correct while only one season exists.
  if (timelineId !== undefined) {
    const scoped = statements.getTimelineEventsBySeason.all(timelineId) as TimelineEventRecord[];
    return scoped.map(denormaliseTimelineEvent);
  }

  const records = statements.getTimelineEvents.all(hruId ?? "") as TimelineEventRecord[];
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
  script_entity_ids: string | null;
}

/** Per-season values for a mode, as stored by migration 014. */
interface TimelineModeValueRecord {
  mode_id: number;
  power: number | null;
  temperature: number | null;
  native_mode: number | null;
  variables: string | null;
  luftator_config: string | null;
  script_entity_ids: string | null;
}

function parseJsonColumn<T>(raw: string | null, modeId: number, column: string): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    getModuleLogger()?.error({ err, modeId }, `Failed to parse ${column} JSON`);
    return undefined;
  }
}

/**
 * A mode counts as configured for a season when it would actually do something
 * there: at least one HRU write value, at least one valve position, or at least
 * one activation script. A script-only mode is legitimate - "in summer, open
 * the window instead of running the unit" - so scripts alone are enough, and so
 * is a valve-only mode: it moves hardware without touching the unit, and has
 * been a supported configuration since before seasons existed.
 */
export function hasEffectiveValues(mode: TimelineMode): boolean {
  if (mode.power !== undefined || mode.temperature !== undefined) return true;
  if (mode.nativeMode !== undefined) return true;
  if (mode.variables && Object.keys(mode.variables).length > 0) return true;
  if (mode.luftatorConfig && Object.keys(mode.luftatorConfig).length > 0) return true;
  if (mode.scriptEntityIds && mode.scriptEntityIds.length > 0) return true;
  return false;
}

function readSeasonValues(timelineId: number): Map<number, TimelineModeValueRecord> {
  const db = getDatabase();
  if (!db) return new Map();
  const rows = cachedStatement(
    db,
    `SELECT mode_id, power, temperature, native_mode, variables, luftator_config,
            script_entity_ids
     FROM timeline_mode_values
     WHERE timeline_id = ?`,
  ).all(timelineId) as TimelineModeValueRecord[];
  return new Map(rows.map((row) => [row.mode_id, row]));
}

/**
 * Retrieves all timeline modes for a specific HRU unit.
 *
 * Modes are never filtered: identity is shared across seasons, so the same list
 * comes back whichever season is asked for - only the values and the
 * `configured` flag differ. When `timelineId` is omitted the legacy columns on
 * `timeline_modes` are used, which is exactly the pre-seasons behaviour.
 *
 * @param hruId - Optional HRU unit ID (null/undefined for global modes)
 * @param timelineId - Optional season to resolve values against
 * @returns Array of timeline modes sorted by name
 */
export function getTimelineModes(hruId?: string, timelineId?: number): TimelineMode[] {
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    getModuleLogger()?.error("Database not initialised in getTimelineModes");
    throw new Error("Database not initialised");
  }

  const records = statements.getTimelineModes.all(hruId ?? null) as TimelineModeRecord[];
  const seasonValues = timelineId === undefined ? null : readSeasonValues(timelineId);

  return records
    .map((r) => {
      const identity = {
        id: r.id,
        name: r.name,
        color: r.color ?? undefined,
        isBoost: Boolean(r.is_boost),
        hruId: r.hru_id ?? undefined,
      };

      const values = seasonValues?.get(r.id);
      if (seasonValues && !values) {
        // Exists in this season, but nothing configured for it yet.
        return { ...identity, scriptEntityIds: [], configured: false };
      }

      const source = values ?? r;
      const mode: TimelineMode = {
        ...identity,
        power: source.power ?? undefined,
        temperature: source.temperature ?? undefined,
        nativeMode: source.native_mode ?? undefined,
        variables: parseJsonColumn(source.variables, r.id, "variables"),
        luftatorConfig: parseJsonColumn(source.luftator_config, r.id, "luftator_config"),
        scriptEntityIds: parseScriptEntityIds(source.script_entity_ids, r.id),
      };

      return seasonValues ? { ...mode, configured: hasEffectiveValues(mode) } : mode;
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
    scriptEntityIds: parseScriptEntityIds(record.script_entity_ids, record.id),
  };
}

/**
 * Parses the stored JSON array of script entity ids into a string[].
 * Returns an empty array on missing/invalid data (backward compatible with old rows).
 */
function parseScriptEntityIds(raw: string | null, modeId: number): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === "string");
    }
  } catch (err) {
    getModuleLogger()?.error({ err, modeId }, "Failed to parse script_entity_ids JSON");
  }
  return [];
}

/**
 * Raised when a save would leave a mode with nothing to do in a season: no HRU
 * write value and no activation script. Typed so the route can answer with a
 * validation error instead of a 500.
 */
export class ModeValuesEmptyError extends Error {
  constructor() {
    super("A mode must set at least one value or one activation script for this season");
    this.name = "ModeValuesEmptyError";
  }
}

/**
 * Raised when a season's values cannot be removed because enabled events there
 * still reference the mode.
 */
export class ModeValuesInUseError extends Error {
  constructor(public readonly enabledEvents: number) {
    super(
      `Cannot remove values: ${enabledEvents} enabled event(s) in this season still use this mode`,
    );
    this.name = "ModeValuesInUseError";
  }
}

/**
 * True when this season is the one whose values the legacy columns represent.
 *
 * A one-season install is always spring, and spring is what migration 014
 * copied the legacy columns into, so spring is the season a build from before
 * this change would be reading when it looks at `timeline_modes`.
 */
function isDefaultSeason(timelineId: number): boolean {
  const db = getDatabase();
  if (!db) return false;
  const row = db.prepare(`SELECT season_key FROM timelines WHERE id = ?`).get(timelineId) as
    | { season_key?: string }
    | undefined;
  return row?.season_key === "spring";
}

/**
 * Writes a mode's values for one season.
 *
 * The legacy columns on `timeline_modes` are mirrored separately, by the caller,
 * and only for the default season - see `upsertTimelineMode`.
 */
function writeSeasonValues(modeId: number, timelineId: number, mode: TimelineMode): void {
  const db = getDatabase();
  if (!db) throw new Error("Database not initialised");

  db.prepare(
    `INSERT INTO timeline_mode_values
       (mode_id, timeline_id, power, temperature, native_mode, variables, luftator_config,
        script_entity_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mode_id, timeline_id) DO UPDATE SET
       power             = excluded.power,
       temperature       = excluded.temperature,
       native_mode       = excluded.native_mode,
       variables         = excluded.variables,
       luftator_config   = excluded.luftator_config,
       script_entity_ids = excluded.script_entity_ids,
       updated_at        = datetime('now')`,
  ).run(
    modeId,
    timelineId,
    mode.power ?? null,
    mode.temperature ?? null,
    mode.nativeMode ?? null,
    mode.variables ? JSON.stringify(mode.variables) : null,
    mode.luftatorConfig ? JSON.stringify(mode.luftatorConfig) : null,
    mode.scriptEntityIds && mode.scriptEntityIds.length > 0
      ? JSON.stringify(mode.scriptEntityIds)
      : null,
  );
}

/**
 * How many enabled events in a season reference a mode. Used both to block
 * un-configuring a mode that is in use and to tell the user, before a deletion,
 * what it would cost in seasons they cannot currently see.
 */
export function countEnabledEventsUsingMode(modeId: number, timelineId?: number): number {
  const db = getDatabase();
  if (!db) return 0;

  // Events may reference a mode by id or by name - findTimelineModeByReference
  // resolves both, and legacy events use the name. Matching on the id alone
  // reported "no events use this mode" for a name-referenced event and let its
  // season's values be cleared out from under it.
  const name = (
    db.prepare(`SELECT name FROM timeline_modes WHERE id = ?`).get(modeId) as
      | { name: string }
      | undefined
  )?.name;

  const matches = `(
    CAST(json_extract(hru_config, '$.mode') AS INTEGER) = @modeId
    OR json_extract(hru_config, '$.mode') = @modeIdText
    OR (@name IS NOT NULL AND json_extract(hru_config, '$.mode') = @name)
  )`;
  const scope = timelineId === undefined ? "" : "AND timeline_id = @timelineId";

  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM timeline_events WHERE enabled = 1 ${scope} AND ${matches}`)
    .get({
      modeId,
      modeIdText: String(modeId),
      name: name ?? null,
      ...(timelineId === undefined ? {} : { timelineId }),
    }) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * Per-season impact of deleting a mode. Because identity is shared, a deletion
 * started while viewing one season removes events from every other season too -
 * off-screen, where the user cannot see what they are losing.
 */
export interface ModeUsage {
  timelineId: number;
  seasonKey: string;
  enabledEvents: number;
  /** True when removing this mode would leave the season with no enabled events. */
  wouldBeLeftEmpty: boolean;
}

export function getModeUsage(modeId: number, hruId?: string | null): ModeUsage[] {
  const db = getDatabase();
  if (!db) return [];
  const seasons = db
    .prepare(
      hruId === undefined || hruId === null
        ? `SELECT id, season_key FROM timelines WHERE hru_id IS NULL`
        : `SELECT id, season_key FROM timelines WHERE hru_id = ?`,
    )
    .all(...(hruId === undefined || hruId === null ? [] : [hruId])) as {
    id: number;
    season_key: string;
  }[];

  return seasons.map((season) => {
    const usingMode = countEnabledEventsUsingMode(modeId, season.id);
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM timeline_events WHERE enabled = 1 AND timeline_id = ?`)
        .get(season.id) as { n: number }
    ).n;
    return {
      timelineId: season.id,
      seasonKey: season.season_key,
      enabledEvents: usingMode,
      wouldBeLeftEmpty: usingMode > 0 && usingMode === total,
    };
  });
}

/**
 * Removes a mode's values for one season, making it unconfigured there again.
 * Refused while an enabled event in that season still references the mode -
 * otherwise the invariant would be broken from the other direction.
 */
export function deleteTimelineModeValues(modeId: number, timelineId: number): void {
  const db = getDatabase();
  if (!db) throw new Error("Database not initialised");

  const inUse = countEnabledEventsUsingMode(modeId, timelineId);
  if (inUse > 0) {
    throw new ModeValuesInUseError(inUse);
  }

  db.prepare(`DELETE FROM timeline_mode_values WHERE mode_id = ? AND timeline_id = ?`).run(
    modeId,
    timelineId,
  );
}

/**
 * Creates or updates a timeline mode.
 *
 * Identity (name, colour, boost) is shared across every season. Values are
 * written to `timelineId` when one is given; without it only the legacy columns
 * are touched, which is the pre-seasons behaviour.
 *
 * The legacy value columns are mirrored **only** when the target season is the
 * default one. They are what a build from before this change reads, so writing
 * autumn's numbers into them would make a downgrade run autumn all year round -
 * and the spec only promises that edits to the default season stay visible to
 * an older build.
 *
 * @param mode - Timeline mode to upsert
 * @param timelineId - Season whose values are being written
 * @returns Timeline mode with assigned ID
 */
export function upsertTimelineMode(mode: TimelineMode, timelineId?: number): TimelineMode {
  if (timelineId !== undefined && !hasEffectiveValues(mode)) {
    // A mode saved with nothing to write would look configured while doing
    // nothing at all - a silent no-op on real hardware.
    throw new ModeValuesEmptyError();
  }
  if (!getDatabase() || !getStatements()) {
    setupDatabase();
  }
  const statements = getStatements();
  if (!statements) {
    throw new Error("Database not initialised");
  }

  const mirrorsLegacyColumns = timelineId === undefined || isDefaultSeason(timelineId);

  const result = (
    mirrorsLegacyColumns
      ? statements.upsertTimelineMode.run(
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
          mode.scriptEntityIds && mode.scriptEntityIds.length > 0
            ? JSON.stringify(mode.scriptEntityIds)
            : null,
        )
      : statements.upsertTimelineModeIdentity.run(
          mode.id ?? null,
          mode.name,
          mode.color ?? null,
          mode.isBoost ? 1 : 0,
          mode.hruId ?? null,
        )
  ) as { lastInsertRowid: number | bigint };

  const id = mode.id ?? Number(result.lastInsertRowid);

  if (timelineId !== undefined) {
    writeSeasonValues(id, timelineId, mode);
  }

  getModuleLogger()?.debug(
    { id, name: mode.name, timelineId, mirrorsLegacyColumns },
    "Upserted timeline mode",
  );

  return {
    ...mode,
    id,
  };
}

/**
 * Deletes a timeline mode by ID.
 *
 * Its per-season values go with it: `timeline_mode_values` declares
 * `ON DELETE CASCADE` and better-sqlite3 opens every connection with
 * `PRAGMA foreign_keys = ON`, so SQLite removes them.
 *
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

  // Adopt the unit-less season along with the events. Without this the events
  // move to the unit while their season does not, leaving them pointing at a
  // season that belongs to no unit - invisible to every season-scoped read for
  // the unit, so the whole schedule disappears from the UI and the scheduler.
  try {
    const db = getDatabase();
    if (db) {
      const unitless = db.prepare(`SELECT id FROM timelines WHERE hru_id IS NULL`).all() as {
        id: number;
      }[];

      for (const season of unitless) {
        // The unit may already own seasons - ensureSeasons runs on a Settings
        // visit, and ensureActiveSeasonId on the first write. Claiming the row
        // outright would then collide with UNIQUE(season_key, hru_id), so the
        // events are repointed at the unit's own season instead.
        const target = db
          .prepare(`SELECT id FROM timelines WHERE hru_id = ? ORDER BY enabled DESC, id LIMIT 1`)
          .get(hruId) as { id: number } | undefined;

        if (target) {
          db.prepare(
            `UPDATE timeline_events SET timeline_id = ?, updated_at = datetime('now')
             WHERE timeline_id = ?`,
          ).run(target.id, season.id);
          db.prepare(`DELETE FROM timeline_mode_values WHERE timeline_id = ?`).run(season.id);
          db.prepare(`DELETE FROM timelines WHERE id = ?`).run(season.id);
        } else {
          db.prepare(
            `UPDATE timelines SET hru_id = ?, updated_at = datetime('now') WHERE id = ?`,
          ).run(hruId, season.id);
        }
      }
    }
  } catch (err) {
    getModuleLogger()?.warn({ err, hruId }, "Failed to adopt unit-less season");
  }

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
      normalised.timeline_id,
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
              mode.scriptEntityIds && mode.scriptEntityIds.length > 0
                ? JSON.stringify(mode.scriptEntityIds)
                : null,
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
