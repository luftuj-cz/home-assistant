import { resolveApiUrl } from "../utils/api";

export type LocalizedText = string | { text: string; translate: boolean };

export type VariableClass = "power" | "temperature" | "mode" | "other";

export interface HruVariable {
  name: string;
  type: "number" | "select" | "boolean";
  editable: boolean;
  label: LocalizedText;
  unit?: LocalizedText;
  class?: VariableClass;
  min?: number;
  max?: number;
  maxDefault?: number;
  step?: number;
  options?: Array<{
    value: number;
    label: LocalizedText;
  }>;
  maxConfigurable?: boolean;
}

export interface HruUnit {
  id: string;
  code: string;
  name: string;
  variables: HruVariable[];
}

export async function fetchHruUnits(): Promise<HruUnit[]> {
  const res = await fetch(resolveApiUrl("/api/hru/units"));
  if (!res.ok) throw new Error("Failed to fetch HRU units");
  return res.json();
}

export async function fetchActiveUnit() {
  const [settingsRes, units] = await Promise.all([
    fetch(resolveApiUrl("/api/settings/hru")),
    fetchHruUnits().catch(() => [] as HruUnit[]),
  ]);

  let settings: { unit?: string } = {};
  if (settingsRes.ok) {
    settings = (await settingsRes.json()) as { unit?: string };
  }

  const activeUnit = units.find((u) => u.id === settings.unit) || units[0];
  return {
    unitId: activeUnit?.id,
    activeUnit,
    units,
  };
}
