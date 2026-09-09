import { SEASONS_ENABLED_KEY } from "../../types/index.js";
import { getDatabase, getModuleLogger, setupDatabase } from "../database.js";
import { getAppSetting, setAppSetting } from "./settings.js";
import {
  adoptSeasonlessContent,
  ensureSeasons,
  getSeasons,
  persistDerivedSpanEnds,
  SEASON_KEYS,
  type Season,
  type SeasonKey,
  validatePartition,
} from "./seasons.js";

export { adoptSeasonlessContent };

/** Meteorological boundaries: round dates, Czech convention, draggable afterwards. */
const SEED_SPAN_STARTS: Record<SeasonKey, string> = {
  spring: "03-01",
  summer: "06-01",
  autumn: "09-01",
  winter: "12-01",
};

/**
 * Where `disableSeasonsFeature` parks the partition it collapses. Keyed per
 * unit (`""` for unit-less rows) so switching units in between cannot restore
 * one unit's boundaries onto another.
 */
export const SEASONS_PARKED_PARTITION_KEY = "timeline.seasons_parked_partition";

type ParkedSeason = { spanStart: string; enabled: boolean };
type ParkedPartition = Partial<Record<SeasonKey, ParkedSeason>>;

function partitionStorageKey(hruId: string | null): string {
  return hruId ?? "";
}

function readParkedPartitions(): Record<string, ParkedPartition> {
  const raw = getAppSetting(SEASONS_PARKED_PARTITION_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ParkedPartition>) : {};
  } catch (err) {
    getModuleLogger()?.warn({ err }, "Ignoring unreadable parked season partition");
    return {};
  }
}

function writeParkedPartitions(partitions: Record<string, ParkedPartition>): void {
  setAppSetting(SEASONS_PARKED_PARTITION_KEY, JSON.stringify(partitions));
}

function isSeasonKey(value: string): value is SeasonKey {
  return (SEASON_KEYS as readonly string[]).includes(value);
}

/**
 * The partition to bring back on enable, or null when there is nothing parked
 * for this unit or what is parked would not be a valid partition any more.
 */
function takeParkedPartition(hruId: string | null, seasons: Season[]): ParkedPartition | null {
  const all = readParkedPartitions();
  const key = partitionStorageKey(hruId);
  const parked = all[key];
  if (!parked) return null;

  delete all[key];
  writeParkedPartitions(all);

  const candidate = seasons.map((season) => {
    const saved = parked[season.seasonKey];
    return saved
      ? { ...season, spanStart: saved.spanStart, enabled: saved.enabled }
      : { ...season, spanStart: SEED_SPAN_STARTS[season.seasonKey], enabled: false };
  });
  if (validatePartition(candidate).length > 0) {
    getModuleLogger()?.warn({ hruId, parked }, "Parked season partition is invalid, reseeding");
    return null;
  }
  return parked;
}

function requireDatabase() {
  if (!getDatabase()) setupDatabase();
  const db = getDatabase();
  if (!db) throw new Error("Database not initialised");
  return db;
}

/**
 * The one definition of "seasons are in play". The scheduler, the routes and
 * the feature flows all ask this, so that an install cannot be half-on: gated
 * writes refused while the safe state fires, or vice versa.
 */
export function isSeasonsFeatureEnabled(): boolean {
  return getAppSetting(SEASONS_ENABLED_KEY) === "true";
}

/**
 * Turning the feature on must not change what the unit is doing. The first
 * time, it seeds the four meteorological seasons and, unless told otherwise,
 * copies the existing schedule and mode values into all of them - so every
 * season starts as an exact copy of the single schedule that was running
 * before.
 *
 * Turning it back on after a disable restores the partition that was parked:
 * the boundaries the user had moved and the seasons they had switched off. The
 * disable dialog promises that off/on brings back exactly what was there, and
 * events and mode values already survive the round trip - reseeding the
 * boundaries on top of them broke that promise for the partition itself.
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

    const parked = takeParkedPartition(hruId, seasons);
    const setBoundary = db.prepare(
      `UPDATE timelines SET span_start = ?, enabled = ?, updated_at = datetime('now') WHERE id = ?`,
    );
    for (const season of seasons) {
      const restored = parked?.[season.seasonKey];
      if (restored) {
        setBoundary.run(restored.spanStart, restored.enabled ? 1 : 0, season.id);
      } else {
        setBoundary.run(SEED_SPAN_STARTS[season.seasonKey], 1, season.id);
      }
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
 * instead of needing a fixed key to grow back from. The partition itself -
 * every season's boundary and enabled flag - is parked in `app_settings`, since
 * the rows are about to be overwritten with the whole-year collapse and the
 * enable flow reads them back from there.
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
    const partition: ParkedPartition = {};
    for (const season of seasons) {
      if (!isSeasonKey(season.seasonKey)) continue;
      partition[season.seasonKey] = { spanStart: season.spanStart, enabled: season.enabled };
    }
    const all = readParkedPartitions();
    all[partitionStorageKey(hruId)] = partition;
    writeParkedPartitions(all);

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
