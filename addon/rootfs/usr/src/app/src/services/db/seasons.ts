import { getDatabase, getModuleLogger, setupDatabase } from "../database.js";
import { cachedStatement } from "./statementCache.js";

/**
 * The four seasons are a fixed set. They cannot be created, deleted or renamed
 * - only enabled, disabled and re-bounded - so their keys are stable
 * identifiers that Home Assistant automations can compare against and that no
 * user action can change. Display names come from i18n.
 */
export const SEASON_KEYS = ["spring", "summer", "autumn", "winter"] as const;

export type SeasonKey = (typeof SEASON_KEYS)[number];

/**
 * Meteorological boundaries: round dates, matching Czech convention. Only the
 * starting point - the user drags them afterwards.
 */
const DEFAULT_SPAN_STARTS: Record<SeasonKey, string> = {
  spring: "03-01",
  summer: "06-01",
  autumn: "09-01",
  winter: "12-01",
};

/** MM-DD, no year. Shared by every path that accepts a boundary. */
const MONTH_DAY_PATTERN = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface Season {
  id: number;
  seasonKey: SeasonKey;
  hruId: string | null;
  /** MM-DD. Authoritative: the day this season begins. */
  spanStart: string;
  /** MM-DD. Derived from the next enabled season's start, minus one day. */
  spanEnd: string;
  enabled: boolean;
  sortOrder: number;
}

interface SeasonRecord {
  id: number;
  season_key: string;
  hru_id: string | null;
  span_start: string;
  span_end: string;
  enabled: number;
  sort_order: number;
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

function seasonOrder(key: SeasonKey): number {
  return SEASON_KEYS.indexOf(key);
}

function denormalise(record: SeasonRecord): Season {
  return {
    id: record.id,
    seasonKey: record.season_key as SeasonKey,
    hruId: record.hru_id,
    spanStart: record.span_start,
    spanEnd: record.span_end,
    enabled: Boolean(record.enabled),
    sortOrder: record.sort_order,
  };
}

/**
 * Formats a Date as MM-DD from its **local** components. Season boundaries are
 * evaluated at local midnight in the add-on's timezone (which Home Assistant
 * sets), never in UTC - otherwise a boundary would flip at the wrong hour and,
 * near midnight, on the wrong day.
 */
export function toMonthDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

/**
 * Wrap-aware containment. A season may span the year end (winter running
 * 12-01 -> 02-28), in which case the range is the union of two intervals.
 * Both boundary days are inclusive.
 */
export function inRange(monthDay: string, from: string, to: string): boolean {
  if (from <= to) {
    return monthDay >= from && monthDay <= to;
  }
  return monthDay >= from || monthDay <= to;
}

/** Day before the given MM-DD, wrapping 01-01 to 12-31. Leap-safe: 03-01 -> 02-29. */
export function previousMonthDay(monthDay: string): string {
  const parts = monthDay.split("-");
  const month = Number.parseInt(parts[0] ?? "", 10);
  const day = Number.parseInt(parts[1] ?? "", 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return monthDay;
  // 2024 is a leap year, so 02-29 is representable and 03-01 steps back onto it.
  const date = new Date(2024, month - 1, day);
  date.setDate(date.getDate() - 1);
  return toMonthDay(date);
}

function readSeasonRecords(hruId: string | null): SeasonRecord[] {
  const db = requireDatabase();
  if (hruId === null) {
    return cachedStatement(
      db,
      `SELECT * FROM timelines WHERE hru_id IS NULL`,
    ).all() as SeasonRecord[];
  }
  return cachedStatement(db, `SELECT * FROM timelines WHERE hru_id = ?`).all(
    hruId,
  ) as SeasonRecord[];
}

/**
 * All four seasons for a unit, in calendar order, with `spanEnd` derived from
 * the next **enabled** season. Deriving rather than storing is what makes gaps
 * and overlaps structurally impossible: the enabled seasons are a ring of start
 * points, so every day belongs to exactly one of them by construction.
 */
export function getSeasons(hruId: string | null): Season[] {
  const seasons = readSeasonRecords(hruId)
    .map(denormalise)
    .sort((a, b) => seasonOrder(a.seasonKey) - seasonOrder(b.seasonKey));

  const enabled = seasons.filter((season) => season.enabled);
  if (enabled.length === 0) {
    return seasons;
  }
  if (enabled.length === 1) {
    const only = enabled[0]!;
    only.spanEnd = previousMonthDay(only.spanStart);
    return seasons;
  }

  const byStart = [...enabled].sort((a, b) => a.spanStart.localeCompare(b.spanStart));
  for (let index = 0; index < byStart.length; index++) {
    const current = byStart[index]!;
    const next = byStart[(index + 1) % byStart.length]!;
    current.spanEnd = previousMonthDay(next.spanStart);
  }
  return seasons;
}

export function getEnabledSeasons(hruId: string | null): Season[] {
  return getSeasons(hruId).filter((season) => season.enabled);
}

/**
 * Creates any missing season rows for a unit, leaving existing ones untouched.
 * New rows start disabled: enabling the feature is what turns them on, and a
 * silently enabled season would change the partition under a running install.
 * Rows are never deleted when the active unit changes, so returning to a unit
 * restores its configuration exactly.
 */
export function ensureSeasons(hruId: string | null): Season[] {
  const db = requireDatabase();
  const present = new Set(readSeasonRecords(hruId).map((row) => row.season_key));

  const insert = db.prepare(
    `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const key of SEASON_KEYS) {
    if (present.has(key)) continue;
    insert.run(key, hruId, DEFAULT_SPAN_STARTS[key], DEFAULT_SPAN_STARTS[key], 0, seasonOrder(key));
  }
  return getSeasons(hruId);
}

/**
 * The season whose derived span contains `now`. Returns null only when no
 * season is enabled at all, which callers must treat as an error rather than as
 * "nothing scheduled".
 */
export function resolveActiveSeason(hruId: string | null, now: Date = new Date()): Season | null {
  const enabled = getEnabledSeasons(hruId);
  if (enabled.length === 0) return null;
  if (enabled.length === 1) return enabled[0]!;

  const today = toMonthDay(now);
  return enabled.find((season) => inRange(today, season.spanStart, season.spanEnd)) ?? null;
}

/**
 * Id of the season that applies right now, or undefined when the unit has no
 * seasons at all (a database that predates them, or one that has never had a
 * unit configured). Callers pass the result straight into `getTimelineModes`,
 * where undefined falls back to the legacy columns - so there is one code path
 * whether or not seasons are in play.
 */
export function getActiveSeasonId(
  hruId: string | null,
  now: Date = new Date(),
): number | undefined {
  try {
    return resolveActiveSeason(hruId, now)?.id;
  } catch (err) {
    getModuleLogger()?.warn({ err, hruId }, "Failed to resolve active season");
    return undefined;
  }
}

/**
 * Pulls everything that predates the unit's seasons into the given season.
 *
 * There are two kinds of season-less content. Events written while the unit had
 * no season row at all carry `timeline_id IS NULL` - migration 013 only
 * back-fills units that already owned events, so every install created after
 * this release starts that way. Modes from the same period have no row in
 * `timeline_mode_values`; their values live only in the legacy columns.
 *
 * Left alone, the first season-scoped read would find a schedule that belongs
 * to no season and modes with no values: the timeline would come up empty,
 * every mode would read as unconfigured, and the safe state would drive the
 * unit to minimum. That is why every path that brings a season into existence
 * - enabling the feature, or the first write on an install with none - runs
 * this immediately afterwards.
 *
 * Unit-less events are folded in as well, matching migration 013 and the
 * adoption in `assignLegacyEventsToUnit`: a season of their own would be
 * orphaned the moment the unit adopts them.
 */
export function adoptSeasonlessContent(hruId: string | null, timelineId: number): void {
  const db = requireDatabase();

  db.prepare(
    `UPDATE timeline_events
     SET timeline_id = ?, updated_at = datetime('now')
     WHERE timeline_id IS NULL
       AND (hru_id IS ? OR hru_id IS NULL)`,
  ).run(timelineId, hruId);

  // Same back-fill migration 014 performs: for a mode never saved per season,
  // the legacy columns are still the truth.
  db.prepare(
    `INSERT OR IGNORE INTO timeline_mode_values
       (mode_id, timeline_id, power, temperature, native_mode, variables, luftator_config,
        script_entity_ids)
     SELECT m.id, ?, m.power, m.temperature, m.native_mode, m.variables, m.luftator_config,
            m.script_entity_ids
     FROM timeline_modes m
     WHERE m.hru_id IS ? OR m.hru_id IS NULL`,
  ).run(timelineId, hruId);
}

/**
 * The season an event or mode value written *now* belongs to, creating the
 * unit's whole-year season if it has none yet.
 *
 * Migration 013 back-fills a season only for units that already owned events,
 * so a database created after this release starts with no `timelines` row at
 * all - and so does an upgraded install whose users only ever used boost
 * modes. Writes resolved through `getActiveSeasonId` would then be stored with
 * no season - invisible to every season-scoped read the moment the feature is
 * switched on, which silently empties the whole schedule. Write paths use this
 * instead, so an event always lands in a season that exists.
 *
 * The season created here matches what 013 would have produced: `spring`,
 * covering the whole year, enabled. Creating it also makes every read from
 * then on season-scoped, so the modes and events that existed before it are
 * adopted into it in the same step (`adoptSeasonlessContent`) - otherwise the
 * install's existing modes would all read as unconfigured from the first save
 * onwards. Read paths keep using `getActiveSeasonId`, which never writes.
 */
export function ensureActiveSeasonId(hruId: string | null): number | undefined {
  try {
    const seasons = getSeasons(hruId);
    const enabled = seasons.filter((season) => season.enabled);

    // Normal case, and the only one once the feature is on: the partition is
    // complete, so exactly one season contains today.
    if (enabled.length > 0) {
      return resolveActiveSeason(hruId)?.id;
    }

    const db = requireDatabase();
    const spring = seasons.find((season) => season.seasonKey === "spring");

    const create = db.transaction((): number => {
      // Rows exist but none is enabled - the Settings page created the four
      // placeholders on an install that never turned the feature on. A
      // one-season install is always spring covering the whole year.
      if (spring) {
        db.prepare(
          `UPDATE timelines
           SET enabled = 1, span_start = '01-01', span_end = '12-31',
               updated_at = datetime('now')
           WHERE id = ?`,
        ).run(spring.id);
        adoptSeasonlessContent(hruId, spring.id);
        getModuleLogger()?.info({ hruId }, "Enabled the default whole-year season for writes");
        return spring.id;
      }

      const inserted = db
        .prepare(
          `INSERT INTO timelines (season_key, hru_id, span_start, span_end, enabled, sort_order)
           VALUES ('spring', ?, '01-01', '12-31', 1, 0)`,
        )
        .run(hruId);
      const id = Number(inserted.lastInsertRowid);
      adoptSeasonlessContent(hruId, id);
      getModuleLogger()?.info({ hruId }, "Created the default whole-year season for writes");
      return id;
    });

    return create();
  } catch (err) {
    // A write must not fail because the season could not be resolved: without
    // an id the row is still stored, exactly as it was before seasons existed.
    getModuleLogger()?.warn({ err, hruId }, "Failed to ensure the default season");
    return undefined;
  }
}

export interface PartitionProblem {
  kind: "no-enabled-seasons" | "duplicate-start";
  detail: string;
}

/**
 * Validates what the derived model cannot rule out on its own: that at least
 * one season stays enabled, and that no two enabled seasons start on the same
 * day, which would make the ring ambiguous and leave one of them with an empty
 * span.
 */
export function validatePartition(seasons: Season[]): PartitionProblem[] {
  const problems: PartitionProblem[] = [];
  const enabled = seasons.filter((season) => season.enabled);

  if (enabled.length === 0) {
    problems.push({
      kind: "no-enabled-seasons",
      detail: "At least one season must stay enabled, otherwise no schedule applies on any day.",
    });
    return problems;
  }

  const starts = new Map<string, SeasonKey[]>();
  for (const season of enabled) {
    starts.set(season.spanStart, [...(starts.get(season.spanStart) ?? []), season.seasonKey]);
  }
  for (const [start, keys] of starts) {
    if (keys.length > 1) {
      problems.push({
        kind: "duplicate-start",
        detail: `Seasons ${keys.join(", ")} all start on ${start}; each needs its own boundary.`,
      });
    }
  }
  return problems;
}

function assertValidPartition(candidate: Season[]): void {
  const problems = validatePartition(candidate);
  if (problems.length > 0) {
    throw new Error(problems.map((problem) => problem.detail).join(" "));
  }
}

/**
 * Applies a boundary move and/or an enable/disable, validating the combined
 * result before either is written. This is the only mutation of a single
 * season: enabling and disabling are non-destructive in both directions (the
 * row, its events and its mode values survive a disable, and the surrounding
 * spans are derived rather than rewritten, so re-enabling reclaims exactly the
 * span it had), and disabling the last enabled season is rejected.
 *
 * Doing the two parts as separate calls committed the boundary first, so a
 * change whose *combination* broke the partition returned an error with half of
 * it already persisted - the UI rolled back, the database did not.
 */
export function updateSeason(
  hruId: string | null,
  key: SeasonKey,
  patch: { spanStart?: string; enabled?: boolean },
): Season[] {
  if (patch.spanStart !== undefined && !MONTH_DAY_PATTERN.test(patch.spanStart)) {
    throw new Error(`Invalid season boundary "${patch.spanStart}", expected MM-DD`);
  }

  const db = requireDatabase();
  const current = getSeasons(hruId);
  const target = current.find((season) => season.seasonKey === key);
  if (!target) {
    throw new Error(`Season ${key} does not exist for this unit`);
  }

  assertValidPartition(
    current.map((season) =>
      season.seasonKey === key
        ? {
            ...season,
            spanStart: patch.spanStart ?? season.spanStart,
            enabled: patch.enabled ?? season.enabled,
          }
        : season,
    ),
  );

  db.transaction(() => {
    if (patch.spanStart !== undefined) {
      db.prepare(
        `UPDATE timelines SET span_start = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(patch.spanStart, target.id);
    }
    if (patch.enabled !== undefined) {
      db.prepare(`UPDATE timelines SET enabled = ?, updated_at = datetime('now') WHERE id = ?`).run(
        patch.enabled ? 1 : 0,
        target.id,
      );
    }
  })();

  persistDerivedSpanEnds(hruId);
  return getSeasons(hruId);
}

/**
 * Writes the derived `span_end` values back to the rows. Nothing reads them for
 * logic - they exist so an operator inspecting the database, or a support
 * bundle, sees spans that make sense.
 */
export function persistDerivedSpanEnds(hruId: string | null): void {
  const db = requireDatabase();
  const update = db.prepare(
    `UPDATE timelines SET span_end = ?, updated_at = datetime('now') WHERE id = ?`,
  );
  for (const season of getSeasons(hruId)) {
    update.run(season.spanEnd, season.id);
  }
}
