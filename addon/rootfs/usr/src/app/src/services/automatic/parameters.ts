import { z } from "zod";
import { getAppSetting, setAppSetting } from "../database.js";
import { ENGINE_PARAM_KEYS, type EngineParams, engineDefaults } from "./engineParams.js";
import { DEFAULT_MAX_READING_AGE_SECONDS } from "./readings.js";

export const AUTOMATIC_PARAMETERS_KEY = "automatic.parameters";
export const AUTOMATIC_MAX_READING_AGE_KEY = "automatic.maxReadingAgeSeconds";

const finite = z.number().finite();

/** One override per engine parameter, all optional; unknown keys are rejected. */
export const parameterOverridesSchema = z
  .object({
    th1: finite,
    th2: finite,
    th1Hysteresis: finite,
    th2Hysteresis: finite,
    thresholdTimeLimit: finite,
    belowTimeLimit: finite,
    co2FilterAlpha: finite,
    hruMinPower: finite,
    hruMaxPowerDay: finite,
    hruMaxPowerNight: finite,
    hruPowerStep: finite,
    hruPowerStepDownInterval: finite,
    powerReviewInterval: finite,
    co2FallingMargin: finite,
    powerReviewStepLimit: finite,
    missingReadingHold: finite,
    hruMovePower: finite,
    fluctuationEnabled: z.boolean(),
    fluctuationOffset: finite,
    partialCloseValue: finite,
    fullyOpenValue: finite,
    dayStart: finite.min(0).max(86400),
    dayEnd: finite.min(0).max(86400),
  } satisfies Record<keyof EngineParams, z.ZodType>)
  .partial()
  .strict();

export const parametersInputSchema = z.object({
  overrides: parameterOverridesSchema.default({}),
  maxReadingAgeSeconds: z.number().finite().positive().nullish(),
});

export type ParameterOverrides = Partial<EngineParams>;

/** The stored overrides; anything unreadable or no longer a parameter is ignored. */
export function getParameterOverrides(): ParameterOverrides {
  const raw = getAppSetting(AUTOMATIC_PARAMETERS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const known = Object.fromEntries(
      Object.entries(parsed).filter(([key]) =>
        (ENGINE_PARAM_KEYS as readonly string[]).includes(key),
      ),
    );
    const result = parameterOverridesSchema.safeParse(known);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

export function getEffectiveParameters(): EngineParams {
  return { ...engineDefaults(), ...getParameterOverrides() };
}

/** Stores the overrides, keeping only values that differ from the engine's defaults. */
export function setParameterOverrides(overrides: ParameterOverrides): ParameterOverrides {
  const defaults = engineDefaults();
  const changed = Object.fromEntries(
    Object.entries(overrides).filter(
      ([key, value]) => value !== undefined && defaults[key as keyof EngineParams] !== value,
    ),
  ) as ParameterOverrides;
  setAppSetting(AUTOMATIC_PARAMETERS_KEY, JSON.stringify(changed));
  return changed;
}

export function getMaxReadingAgeSeconds(): number {
  const value = Number(getAppSetting(AUTOMATIC_MAX_READING_AGE_KEY));
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_READING_AGE_SECONDS;
}

/** Null restores the default. */
export function setMaxReadingAgeSeconds(seconds: number | null): void {
  setAppSetting(AUTOMATIC_MAX_READING_AGE_KEY, seconds === null ? "" : String(seconds));
}
