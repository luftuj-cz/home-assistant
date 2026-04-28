import { apiClient } from "@luftuj/shared/api/client";

export type LocalizedText = string | { text: string; translate: boolean };

export type VariableClass = "power" | "temperature" | "mode" | "other";

export interface HruVariable {
  name: string;
  type: "number" | "select" | "boolean";
  editable: boolean;
  onDashboard?: boolean;
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
  interfaceType?: string;
}

export async function fetchHruUnits(): Promise<HruUnit[]> {
  return apiClient.get<HruUnit[]>("/api/hru/units");
}

export async function fetchActiveUnit() {
  const [settings, units] = await Promise.all([
    apiClient.get<{ unit?: string }>("/api/settings/hru").catch((): { unit?: string } => ({})),
    fetchHruUnits().catch(() => [] as HruUnit[]),
  ]);

  const activeUnit = units.find((u) => u.id === settings.unit) || units[0];
  return {
    unitId: activeUnit?.id,
    activeUnit,
    units,
  };
}
