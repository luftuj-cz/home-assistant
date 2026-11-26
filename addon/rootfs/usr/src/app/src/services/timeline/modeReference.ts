import type { TimelineMode } from "../../types/index.js";

/**
 * The built-in mode "Automatika": automatic control (LUFTaTOR Algo CO2) instead of a stored mode. It belongs to
 * no season and has no values. User modes cannot be named like it, since mode names starting with "@" are
 * rejected.
 */
export const AUTOMATIC_MODE_REFERENCE = "@automatic";

export function isAutomaticModeReference(reference: unknown): boolean {
  return reference === AUTOMATIC_MODE_REFERENCE;
}

/**
 * Finds a timeline mode by its reference (id or name). Never resolves the built-in "Automatika".
 *
 * @param modes - Array of timeline modes to search through
 * @param reference - Mode reference to resolve (mode id as number/string, or mode name as string)
 * @returns The matching TimelineMode or null if not found
 */
export function findTimelineModeByReference(
  modes: TimelineMode[],
  reference: string | number | undefined | null,
): TimelineMode | null {
  if (reference === undefined || reference === null || reference === "") {
    return null;
  }
  if (isAutomaticModeReference(reference)) return null;

  if (typeof reference === "number" || /^\d+$/.test(String(reference))) {
    const id = Number.parseInt(String(reference), 10);
    return modes.find((mode) => mode.id === id) ?? null;
  }

  return modes.find((mode) => mode.name === String(reference)) ?? null;
}

/**
 * Checks whether a timeline mode reference can be resolved against the available modes.
 * Returns true for empty/undefined references (allowing events without mode constraints), for the built-in
 * "Automatika",
 * or when a matching mode exists.
 *
 * @param modes - Array of timeline modes to validate against
 * @param reference - Mode reference to check (mode id or name, may be empty/undefined)
 * @returns true if reference is empty/undefined OR resolves to an existing mode
 */
export function hasResolvableTimelineModeReference(
  modes: TimelineMode[],
  reference: string | number | undefined | null,
): boolean {
  if (reference === undefined || reference === null || reference === "") {
    return true;
  }
  if (isAutomaticModeReference(reference)) return true;

  return findTimelineModeByReference(modes, reference) !== null;
}
