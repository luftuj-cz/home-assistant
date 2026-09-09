import { ensureActiveSeasonId } from "../db/seasons.js";
import { getTimelineEventById } from "../db/timeline.js";
import { parseExplicitSeasonId } from "../unitResolution.js";

/**
 * Season an event write goes to.
 *
 * An explicit `seasonId` wins, so a user editing summer while winter is running
 * writes to summer. Without one, an event that already exists stays in the
 * season it belongs to: a client that predates seasons (or a Home Assistant
 * automation) sends no `seasonId`, and letting the *active* season win would
 * silently move a summer event into winter the moment it was edited in January
 * - and out of every view the user had it in. Only a brand-new event falls
 * through to the active season, creating the unit's whole-year season if the
 * database has none yet.
 *
 * `hruId` must already be normalised: null for "no unit", never "".
 */
export function resolveEventWriteSeasonId(
  rawSeasonId: unknown,
  eventId: number | undefined,
  hruId: string | null,
): number | undefined {
  const explicit = parseExplicitSeasonId(rawSeasonId);
  if (explicit !== undefined) return explicit;
  if (eventId !== undefined) {
    const existing = getTimelineEventById(eventId);
    if (existing?.timelineId != null) return existing.timelineId;
  }
  return ensureActiveSeasonId(hruId);
}
