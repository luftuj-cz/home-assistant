import { LANGUAGE_SETTING_KEY } from "../../types/index.js";
import { getAppSetting, getEnabledSeasons, getSeasons, getTimelineModes } from "../database.js";
import {
  getCustomTimelines,
  getModeIdsUsedByCustomTimelines,
  nameKey,
} from "../db/customTimelines.js";
import { seasonDisplayName, type SeasonKey } from "../db/seasons.js";
import { copyTimelineModeValues, hasEffectiveValues } from "../db/timeline.js";

/**
 * The rules that tie custom timelines to the seasons.
 *
 * A custom timeline borrows its mode values from whichever season is active, and
 * an override can run in any season - indefinitely, so the seasons it will
 * cross are unknowable. Every mode an enabled custom event references therefore
 * has to be configured in every enabled season. Like the seasons' own rule this
 * is checked on every write that could break it, never on read.
 */

export interface SeasonRef {
  /** Null when the unit has no season rows yet and the legacy values apply. */
  id: number | null;
  seasonKey: SeasonKey | null;
  /** The user's own name for the season, when they gave it one. Shown as-is by the UI. */
  name?: string | null;
}

export interface MissingModeConfiguration {
  modeId: number;
  /** Null when no mode with this id exists for the unit. */
  modeName: string | null;
  /** Seasons in which the mode has no values. */
  seasons: SeasonRef[];
}

export function currentLanguage(): string {
  return getAppSetting(LANGUAGE_SETTING_KEY) || "en";
}

/**
 * Modes among `modeIds` that have no values in at least one of `seasons`, or
 * that do not exist for the unit at all.
 */
export function findModesMissingInSeasons(
  hruId: string,
  modeIds: Iterable<number>,
  seasons: SeasonRef[],
): MissingModeConfiguration[] {
  const wanted = [...new Set(modeIds)];
  if (wanted.length === 0) return [];

  const identities = new Map(getTimelineModes(hruId).map((mode) => [mode.id, mode.name]));
  const missing = new Map<number, MissingModeConfiguration>();
  for (const modeId of wanted) {
    if (!identities.has(modeId)) {
      missing.set(modeId, { modeId, modeName: null, seasons: [] });
    }
  }

  for (const season of seasons) {
    const modes = getTimelineModes(hruId, season.id ?? undefined);
    const byId = new Map(modes.map((mode) => [mode.id, mode]));
    for (const modeId of wanted) {
      const mode = byId.get(modeId);
      if (!mode) continue;
      // Season-scoped reads carry the flag; the legacy read of a unit without
      // season rows does not, so the values themselves decide there.
      const configured = mode.configured ?? hasEffectiveValues(mode);
      if (configured) continue;
      const entry = missing.get(modeId) ?? { modeId, modeName: mode.name, seasons: [] };
      entry.seasons.push(season);
      missing.set(modeId, entry);
    }
  }

  return [...missing.values()].sort((a, b) => a.modeId - b.modeId);
}

/** The seasons the rule is checked against: the enabled ones, or the legacy values. */
export function enabledSeasonRefs(hruId: string): SeasonRef[] {
  const enabled = getEnabledSeasons(hruId);
  if (enabled.length === 0) return [{ id: null, seasonKey: null }];
  return enabled.map(toSeasonRef);
}

export function toSeasonRef(season: {
  id: number;
  seasonKey: SeasonKey;
  name?: string | null;
}): SeasonRef {
  return { id: season.id, seasonKey: season.seasonKey, name: season.name ?? null };
}

export interface CopiedModeValues {
  modeId: number;
  modeName: string | null;
  /** The season that received the values. */
  season: SeasonRef;
  /** The season they were copied from. */
  from: SeasonRef;
}

/**
 * Before a season is enabled, gives it the values of every mode a custom
 * timeline uses that it lacks, copied from the first of `sources` that has
 * them - the active season first, so the custom timeline keeps behaving as it
 * does today.
 *
 * Refusing instead would lock the user out: a disabled season cannot be opened
 * in the editor, so the missing values could never be supplied and the season
 * never enabled while any custom event used the mode. Modes no source has
 * remain missing and are reported by the rule check that follows.
 */
export function copyCustomTimelineModesInto(
  hruId: string,
  targets: SeasonRef[],
  sources: SeasonRef[],
): CopiedModeValues[] {
  const missing = findModesMissingInSeasons(hruId, getModeIdsUsedByCustomTimelines(hruId), targets);
  if (missing.length === 0) return [];

  const configuredIn = new Map<number, Set<number>>();
  for (const source of sources) {
    if (source.id === null || configuredIn.has(source.id)) continue;
    const modes = getTimelineModes(hruId, source.id).filter((mode) => mode.configured !== false);
    configuredIn.set(source.id, new Set(modes.map((mode) => mode.id)));
  }

  const copied: CopiedModeValues[] = [];
  for (const entry of missing) {
    for (const season of entry.seasons) {
      if (season.id === null) continue;
      const from = sources.find(
        (source) =>
          source.id !== null &&
          source.id !== season.id &&
          configuredIn.get(source.id)?.has(entry.modeId),
      );
      if (from?.id === null || from?.id === undefined) continue;
      if (copyTimelineModeValues(entry.modeId, from.id, season.id)) {
        copied.push({ modeId: entry.modeId, modeName: entry.modeName, season, from });
      }
    }
  }
  return copied;
}

export function findModesMissingInEnabledSeasons(
  hruId: string,
  modeIds: Iterable<number>,
): MissingModeConfiguration[] {
  return findModesMissingInSeasons(hruId, modeIds, enabledSeasonRefs(hruId));
}

export type PlanRef = { kind: "season"; id: number } | { kind: "custom"; id: number };

export interface NameConflict {
  kind: PlanRef["kind"];
  id: number;
  name: string;
}

/**
 * Another season or custom timeline of the unit already shown under this name.
 * Compared case-insensitively, against what the user sees: a season's own name,
 * or its translated default in the current language.
 */
export function findPlanNameConflict(
  hruId: string | null,
  name: string,
  self?: PlanRef,
): NameConflict | null {
  const key = nameKey(name);
  const lang = currentLanguage();

  for (const season of getSeasons(hruId)) {
    if (self?.kind === "season" && self.id === season.id) continue;
    const shown = seasonDisplayName(season, lang);
    if (nameKey(shown) === key) return { kind: "season", id: season.id, name: shown };
  }

  for (const timeline of hruId ? getCustomTimelines(hruId) : []) {
    if (self?.kind === "custom" && self.id === timeline.id) continue;
    if (nameKey(timeline.name) === key) {
      return { kind: "custom", id: timeline.id, name: timeline.name };
    }
  }

  return null;
}
