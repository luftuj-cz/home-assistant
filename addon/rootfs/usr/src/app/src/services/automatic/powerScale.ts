import type { HruVariable, LocalizedText } from "../../features/hru/hru.definitions.js";
import { getEffectiveMax, getEffectiveMin } from "../../features/hru/hru.service.js";

type PowerLimits = Parameters<typeof getEffectiveMax>[1];

/** The engine's power scale: 0 is no power, 10 the unit's maximum. */
export const ENGINE_POWER_MAX = 10;

/**
 * Converts between the engine's 0–10 scale and the unit's writable power variable. One module for every unit
 * definition: percent, m³/h with a configurable maximum, a minimum above 0, and levels.
 */
export interface PowerScale {
  /** Name of the unit's power variable, the key to write. */
  variable: string;
  min: number;
  max: number;
  step: number;
  unit: LocalizedText | null;
  /** Engine power to the value written to the unit: rounded to the step, kept within min and max. */
  toUnit(power: number): number;
  /** A value read from the unit to the engine's scale. */
  fromUnit(value: number): number;
  /** The engine step to use: at least one step of the unit, so a step always moves the unit. */
  effectiveStep(parameter: number): number;
}

function clean(value: number): number {
  return Number(value.toFixed(6));
}

/** The power variable automatic control writes: the editable number of class "power". */
export function powerVariableOf(variables: HruVariable[]): HruVariable | null {
  return (
    variables.find(
      (variable) => variable.class === "power" && variable.editable && variable.type === "number",
    ) ?? null
  );
}

/** Null when the unit has no writable power or no known maximum. */
export function powerScaleFor(variables: HruVariable[], limits: PowerLimits): PowerScale | null {
  const variable = powerVariableOf(variables);
  if (!variable) return null;
  const max = getEffectiveMax(variable, limits);
  if (max === undefined || !Number.isFinite(max) || max <= 0) return null;
  const min = Math.max(0, getEffectiveMin(variable, limits) ?? 0);
  const step = variable.step !== undefined && variable.step > 0 ? variable.step : 1;

  return {
    variable: variable.name,
    min,
    max,
    step,
    unit: variable.unit ?? null,
    toUnit(power) {
      const raw = (power / ENGINE_POWER_MAX) * max;
      const rounded = Math.round(raw / step) * step;
      return clean(Math.min(max, Math.max(min, rounded)));
    },
    fromUnit(value) {
      return clean((value / max) * ENGINE_POWER_MAX);
    },
    effectiveStep(parameter) {
      return clean(Math.max(parameter, (ENGINE_POWER_MAX * step) / max));
    },
  };
}
