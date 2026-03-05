import type { HruVariable } from "../features/hru/hru.definitions.js";

export interface DemoState {
  values: Record<string, number | string | boolean | null>;
  displayValues: Record<string, string | number | boolean | null>;
  variables: HruVariable[];
}

const stateByUnit = new Map<string, DemoState | null>();

export function setDemoState(unitId: string, state: DemoState | null): void {
  stateByUnit.set(unitId, state);
}

export function getDemoState(unitId: string): DemoState | null {
  return stateByUnit.get(unitId) ?? null;
}
