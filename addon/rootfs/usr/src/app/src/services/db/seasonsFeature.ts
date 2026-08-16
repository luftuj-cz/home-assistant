import { SEASONS_ENABLED_KEY } from "../../types/index.js";
import { getDatabase, getModuleLogger, setupDatabase } from "../database.js";
import { getAppSetting, setAppSetting } from "./settings.js";
import {
  ensureSeasons,
  getSeasons,
  persistDerivedSpanEnds,
  type Season,
  type SeasonKey,
} from "./seasons.js";

/** Meteorological boundaries: round dates, Czech convention, draggable afterwards. */
const SEED_SPAN_STARTS: Record<SeasonKey, string> = {
  spring: "03-01",
  summer: "06-01",
  autumn: "09-01",
  winter: "12-01",
};

function requireDatabase() {
  if (!getDatabase()) setupDatabase();
  const db = getDatabase();
  if (!db) throw new Error("Database not initialised");
  return db;
}

export function isSeasonsFeatureEnabled(): boolean {
  return getAppSetting(SEASONS_ENABLED_KEY) === "true";
}

/**
 * Turning the feature on must not change what the unit is doing. It seeds the
 * four meteorological seasons and, unless told otherwise, copies the existing
 * schedule and mode values into all of them - so every season starts as an
 * exact copy of the single schedule that was running before.
 */
export function enableSeasonsFeature(hruId: string | null, cloneCurrent = true): Season[] {
  const db = requireDatabase();

  const run = db.transaction(() => {
    ensureSeasons(hruId);

    const seasons = getSeasons(hruId);
    const source = seasons.find((season) => season.enabled) ?? seasons[0];
    if (!source) throw new Error("No season to seed from");

    // Before anything is scoped to a season, make sure the schedule that exists
    // today actually belongs to one.
    adoptSeasonlessContent(hruId, source.id);

    const setBoundary = db.prepare(
      `UPDATE timelines SET span_start = ?, enabled = 1, updated_at = datetime('now') WHERE id = ?`,
    );
    for (const season of seasons) {
      setBoundary.run(SEED_SPAN_STARTS[season.seasonKey], season.id);
    }

    if (cloneCurrent) {
      for (const season of seasons) {
        if (season.id === source.id) continue;
        cloneSeasonContent(source.id, season.id);
      }
    }

    setAppSetting(SEASONS_ENABLED_KEY, "true");
  });

  run();
  persistDerivedSpanEnds(hruId);
  getModuleLogger()?.info({ hruId, cloneCurrent }, "Seasons feature enabled");
  return getSeasons(hruId);
}

/**
 * Pulls everything that predates the unit's seasons into the season the feature
 * grows from.
 *
 * There are two kinds of season-less content. Events written while the unit had
 * no season row at all carry `timeline_id IS NULL` - migration 013 only
 * back-fills units that already owned events, so every install created after
 * this release starts that way. Modes from the same period have no row in
 * `timeline_mode_values`; their values live only in the legacy columns.
 *
 * Left alone, enabling the feature would scope the schedule to a season none of
 * it belongs to: the timeline would come up empty, every mode would read as
 * unconfigured, and the safe state would drive the unit to minimum.
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

/** True when a season already holds a schedule or mode values of its own. */
function seasonHasContent(timelineId: number): boolean {
  const db = requireDatabase();
  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM timeline_events WHERE timeline_id = ?)
            + (SELECT COUNT(*) FROM timeline_mode_values WHERE timeline_id = ?) AS n`,
    )
    .get(timelineId, timelineId) as { n: number };
  return counts.n > 0;
}

/**
 * Copies one season's events and mode values into another.
 *
 * Refuses to overwrite a season that already has content. Disabling the feature
 * parks the other seasons rather than deleting them, and the dialog promises
 * they come back - but enabling defaults to cloning, so without this guard an
 * off/on round trip would quietly delete three seasons of hand-tuned schedule
 * behind a checkbox that is ticked by default. Cloning still does its real job:
 * filling seasons that are empty.
 */
export function cloneSeasonContent(fromTimelineId: number, toTimelineId: number): void {
  const db = requireDatabase();

  if (seasonHasContent(toTimelineId)) {
    getModuleLogger()?.info(
      { fromTimelineId, toTimelineId },
      "Skipping clone: the target season already has content of its own",
    );
    return;
  }

  db.prepare(`DELETE FROM timeline_events WHERE timeline_id = ?`).run(toTimelineId);
  db.prepare(
    `INSERT INTO timeline_events
       (start_time, day_of_week, hru_config, luftator_config, enabled, priority, hru_id, timeline_id)
     SELECT start_time, day_of_week, hru_config, luftator_config, enabled, priority, hru_id, ?
     FROM timeline_events WHERE timeline_id = ?`,
  ).run(toTimelineId, fromTimelineId);

  db.prepare(`DELETE FROM timeline_mode_values WHERE timeline_id = ?`).run(toTimelineId);
  db.prepare(
    `INSERT INTO timeline_mode_values
       (mode_id, timeline_id, power, temperature, native_mode, variables, luftator_config,
        script_entity_ids)
     SELECT mode_id, ?, power, temperature, native_mode, variables, luftator_config,
            script_entity_ids
     FROM timeline_mode_values WHERE timeline_id = ?`,
  ).run(toTimelineId, fromTimelineId);
}

export interface DisableImpact {
  seasonKey: SeasonKey;
  timelineId: number;
  enabledEvents: number;
  /** True for the season that becomes the whole-year schedule. */
  wouldBeKept: boolean;
}

/**
 * What turning the feature off changes, per season. Nothing is destroyed - the
 * point of showing this is that the events of the seasons being parked stop
 * being applied until the feature is switched back on.
 */
export function getDisableImpact(hruId: string | null, keepSeasonKey: SeasonKey): DisableImpact[] {
  const db = requireDatabase();
  return getSeasons(hruId).map((season) => {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM timeline_events WHERE enabled = 1 AND timeline_id = ?`)
      .get(season.id) as { n: number };
    return {
      seasonKey: season.seasonKey,
      timelineId: season.id,
      enabledEvents: row.n,
      wouldBeKept: season.seasonKey === keepSeasonKey,
    };
  });
}

/**
 * Turning the feature off leaves one season applying all year, and parks the
 * rest.
 *
 * Nothing is deleted. This used to collapse destructively, on the reasoning
 * that an older build has no season filter and would merge every season's
 * events into one schedule - but a downgrade is not a path this add-on takes,
 * and the scheduler only ever resolves through *enabled* seasons. Disabling the
 * others is therefore enough to make behaviour identical to a one-season
 * install, while their events and mode values sit there waiting to come back.
 *
 * The kept season keeps its own key rather than being rewritten to spring: the
 * rows survive now, so an off/on round trip restores exactly what was there
 * instead of needing a fixed key to grow back from.
 */
export function disableSeasonsFeature(
  hruId: string | null,
  keepSeasonKey: SeasonKey = "spring",
): void {
  const db = requireDatabase();
  const seasons = getSeasons(hruId);

  const keeper =
    seasons.find((season) => season.seasonKey === keepSeasonKey) ??
    seasons.find((season) => season.enabled) ??
    seasons[0];
  if (!keeper) {
    setAppSetting(SEASONS_ENABLED_KEY, "false");
    return;
  }

  const run = db.transaction(() => {
    const park = db.prepare(
      `UPDATE timelines SET enabled = 0, updated_at = datetime('now') WHERE id = ?`,
    );
    for (const season of seasons) {
      if (season.id !== keeper.id) park.run(season.id);
    }

    // One enabled season covering the whole year: what the scheduler sees is
    // then indistinguishable from an install that never had the feature on.
    db.prepare(
      `UPDATE timelines
       SET span_start = '01-01', span_end = '12-31', enabled = 1, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(keeper.id);

    setAppSetting(SEASONS_ENABLED_KEY, "false");
  });

  run();
  getModuleLogger()?.info(
    { hruId, kept: keeper.seasonKey, parked: seasons.length - 1 },
    "Seasons feature disabled, one season now applies all year",
  );
}
