import type { TimelineMode } from "../../types/index.js";

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

export function hasResolvableTimelineModeReference(
  modes: TimelineMode[],
  reference: string | number | undefined | null,
): boolean {
  if (reference === undefined || reference === null || reference === "") {
    return true;
  }

  return findTimelineModeByReference(modes, reference) !== null;
}
