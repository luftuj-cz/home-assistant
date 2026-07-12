import type { Valve } from "@luftuj/shared/types/valve";

export type OpeningsUpdater = (
  prev: Record<string, number | undefined>,
) => Record<string, number | undefined>;

export function valveStorageKey(v: Valve, idx: number): string {
  return v.entityId || v.name || `valve-${idx}`;
}
