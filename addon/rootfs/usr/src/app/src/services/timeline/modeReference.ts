import type { TimelineMode } from "../../types/index.js";

/**
 * Finds a timeline mode by its reference (id or name).
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

  if (typeof reference === "number" || /^\d+$/.test(String(reference))) {
    const id = Number.parseInt(String(reference), 10);
    return modes.find((mode) => mode.id === id) ?? null;
  }

  return modes.find((mode) => mode.name === String(reference)) ?? null;
}

/**
 * Checks whether a timeline mode reference can be resolved against the available modes.
 * Returns true for empty/undefined references (allowing events without mode constraints)
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

  return findTimelineModeByReference(modes, reference) !== null;
}
