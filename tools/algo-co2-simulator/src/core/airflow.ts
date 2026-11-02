export type ValveKind = "supply" | "exhaust";

export interface ValveFlowInput {
  id: string;
  type: ValveKind;
  position: number;
}

/** Fraction of full flow a valve passes: 1 at position 0, 0 at the fully closed position. */
export function valveOpening(
  position: number,
  fullyClosed: number,
  halfClosedShare: number,
): number {
  if (position <= 0) {
    return 1;
  }
  if (position >= fullyClosed) {
    return 0;
  }
  const exponent = Math.log(halfClosedShare) / Math.log(0.5);
  return (1 - position / fullyClosed) ** exponent;
}

/** Splits a total flow among the valves of each type, in proportion to their opening. */
export function splitValveFlows(
  valves: readonly ValveFlowInput[],
  totalM3h: number,
  fullyClosed: number,
  halfClosedShare: number,
): Map<string, number> {
  const openings = new Map<string, number>();
  const openingSums: Record<ValveKind, number> = { supply: 0, exhaust: 0 };
  for (const valve of valves) {
    const opening = valveOpening(valve.position, fullyClosed, halfClosedShare);
    openings.set(valve.id, opening);
    openingSums[valve.type] += opening;
  }

  const flows = new Map<string, number>();
  for (const valve of valves) {
    const openingSum = openingSums[valve.type];
    const opening = openings.get(valve.id) ?? 0;
    flows.set(valve.id, openingSum === 0 ? 0 : (totalM3h * opening) / openingSum);
  }
  return flows;
}

export function hruFlowM3h(nominalFlowM3h: number, powerPct: number): number {
  return (nominalFlowM3h * powerPct) / 100;
}
