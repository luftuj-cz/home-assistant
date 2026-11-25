import type { TFunction } from "i18next";

import { localizedText } from "@luftuj/features/timeline/utils";
import type { HruVariable } from "@luftuj/shared/api/hru";
import type { StatItem } from "@luftuj/shared/ui/stat-strip";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseApiError } from "@luftuj/shared/utils/apiError";

/** What `/api/hru/test` sends: the unit, where it is, and its own power limits. */
export interface HruTestInput {
  unit: string;
  host: string;
  port: number;
  unitId: number;
  minPower?: number;
  maxPower?: number;
}

/** What `/api/hru/test` read from the unit. */
export interface HruTestResult {
  values?: Record<string, unknown> | null;
  displayValues?: Record<string, unknown> | null;
  variables?: HruVariable[] | null;
}

/** Reads the unit's values with settings that are not saved yet. Throws the parsed API error when it fails. */
export async function testHruConnection(input: HruTestInput): Promise<HruTestResult> {
  const res = await fetch(resolveApiUrl("/api/hru/test"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseApiError(res);
  return (await res.json()) as HruTestResult;
}

interface TemperatureDisplay {
  show: (celsius: number) => number;
  label: string;
}

/**
 * What a test read, for a StatStrip: the variables the dashboard shows, with their units, option labels in place of
 * raw codes, and temperatures in the chosen unit.
 */
export function hruTestValues(
  result: HruTestResult | null,
  t: TFunction,
  temperature: TemperatureDisplay,
): StatItem[] {
  return (result?.variables ?? [])
    .filter((variable) => variable.onDashboard)
    .map((variable) => {
      const raw = result?.displayValues?.[variable.name] ?? result?.values?.[variable.name];
      const option = variable.options?.find((entry) => entry.value === Number(raw));
      const isTemperature = variable.class === "temperature" && typeof raw === "number";
      let value = raw == null ? "—" : String(raw);
      if (option) value = localizedText(option.label, t);
      else if (isTemperature) value = temperature.show(raw).toFixed(1);
      let unit = variable.unit ? localizedText(variable.unit, t) : undefined;
      if (isTemperature) unit = temperature.label;
      return { legend: localizedText(variable.label, t), value, unit };
    });
}
