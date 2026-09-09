import type { TimelineMode, TimelineOverride } from "../../types/index.js";

/**
 * Raised when a boost is requested for a mode that has no values in the season
 * that is running. Writing the override anyway would report a running boost
 * while nothing reached the hardware.
 */
export class BoostModeNotConfiguredError extends Error {
  constructor(public readonly mode: TimelineMode) {
    super(`Mode "${mode.name}" has no values configured for the current season`);
    this.name = "BoostModeNotConfiguredError";
  }
}

/**
 * The override a boost stores, with the mode's values frozen at start.
 *
 * A boost may outlive a season boundary. Resolving the mode live on every tick
 * would silently switch it to the new season's values mid-run, or cancel it
 * where the mode has none - so the values are captured here and the scheduler
 * prefers them over a live lookup. Every path that starts a boost (HTTP, MQTT
 * button, MQTT infinite button) builds its override through this function so
 * they cannot drift apart again.
 */
export function buildBoostOverride(
  mode: TimelineMode,
  durationMinutes: number,
  endTime: string,
): NonNullable<TimelineOverride> {
  if (mode.configured === false) {
    throw new BoostModeNotConfiguredError(mode);
  }
  return {
    modeId: mode.id,
    endTime,
    durationMinutes,
    customConfig: {
      nativeMode: mode.nativeMode,
      power: mode.power,
      temperature: mode.temperature,
      variables: mode.variables,
      luftatorConfig: mode.luftatorConfig,
      scriptEntityIds: mode.scriptEntityIds,
    },
  };
}
