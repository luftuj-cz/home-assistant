import type { HruService } from "../features/hru/hru.service.js";
import { HRU_SETTINGS_KEY, type HruSettings } from "../types/index.js";
import { getAppSetting } from "./db/settings.js";

/**
 * Which unit a request or a scheduler tick is about.
 *
 * An explicit override (the `unitId` query parameter) wins. Otherwise the unit
 * selected in Settings applies, and an install that never selected one falls
 * back to the first unit the HRU service knows about - the same fallback the
 * frontend uses, so both sides agree on what "the unit" is.
 *
 * Every router and the scheduler used to carry its own copy of this; a drift
 * between them meant the schedule could be written for one unit and read back
 * for another.
 */
export function resolveCurrentUnitId(
  hruService: Pick<HruService, "getAllUnits">,
  unitIdOverride?: string | null,
): string | null {
  if (unitIdOverride) return unitIdOverride;
  try {
    const raw = getAppSetting(HRU_SETTINGS_KEY);
    const settings = raw ? (JSON.parse(raw) as HruSettings) : null;
    if (settings?.unit) return settings.unit;
  } catch {
    // Unreadable settings are treated as "no unit selected" - the fallback
    // below still applies, matching every caller's previous behaviour.
  }
  return hruService.getAllUnits()[0]?.id ?? null;
}

/**
 * Parses an explicit `seasonId` query value. Anything that is not a numeric
 * string means "not given"; the caller decides what the default is.
 */
export function parseExplicitSeasonId(rawSeasonId: unknown): number | undefined {
  if (typeof rawSeasonId !== "string" || rawSeasonId.trim() === "") return undefined;
  const parsed = Number.parseInt(rawSeasonId, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
