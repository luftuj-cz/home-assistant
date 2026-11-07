import type { EngineParams } from "../core/engineParams.ts";
import type { SimSettings } from "../core/settings.ts";

const MIN_ALPHA = 0.01;
const MIN_SHARE = 0.01;
const MAX_POWER_PCT = 100;
const LAST_SECOND_OF_DAY = 86399;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `value`, raised to `min` when below it. */
function atLeast(min: number, value: number): number {
  return Math.max(min, value);
}

/** Whole seconds, at least 1. */
function wholeSeconds(value: number): number {
  return atLeast(1, Math.floor(value));
}

/** The parameters in a form the engine can run with; applied before every change reaches it. */
export function sanitizeEngineParams(params: EngineParams): EngineParams {
  const th1 = atLeast(0, params.th1);
  const hruMinPower = clamp(params.hruMinPower, 0, MAX_POWER_PCT);
  return {
    th1,
    th2: atLeast(th1 + 1, params.th2),
    co2Hysteresis: atLeast(0, params.co2Hysteresis),
    thresholdTimeLimit: atLeast(0, params.thresholdTimeLimit),
    co2FilterAlpha: clamp(params.co2FilterAlpha, MIN_ALPHA, 1),
    hruMinPower,
    hruMaxPowerDay: clamp(params.hruMaxPowerDay, hruMinPower, MAX_POWER_PCT),
    hruMaxPowerNight: clamp(params.hruMaxPowerNight, hruMinPower, MAX_POWER_PCT),
    hruPowerStep: atLeast(1, params.hruPowerStep),
    hruMovePower: clamp(params.hruMovePower, hruMinPower, MAX_POWER_PCT),
    fluctuationEnabled: params.fluctuationEnabled,
    fluctuationOffset: atLeast(0, params.fluctuationOffset),
    partialCloseValue: atLeast(0, params.partialCloseValue),
    fullyOpenValue: atLeast(0, params.fullyOpenValue),
    dayStart: clamp(params.dayStart, 0, LAST_SECOND_OF_DAY),
    dayEnd: clamp(params.dayEnd, 0, LAST_SECOND_OF_DAY),
  };
}

/** The settings in a form the simulation can run with; always a copy, never the input's nested record. */
export function sanitizeSettings(settings: SimSettings): SimSettings {
  const { sleeping, sitting, active } = settings.co2PerPersonLph;
  return {
    enginePeriodS: wholeSeconds(settings.enginePeriodS),
    sensorIntervalS: wholeSeconds(settings.sensorIntervalS),
    sensorNoise: settings.sensorNoise,
    sensorNoiseSigmaPpm: atLeast(0, settings.sensorNoiseSigmaPpm),
    outdoorCo2Ppm: atLeast(0, settings.outdoorCo2Ppm),
    infiltrationAch: atLeast(0, settings.infiltrationAch),
    co2PerPersonLph: {
      sleeping: atLeast(0, sleeping),
      sitting: atLeast(0, sitting),
      active: atLeast(0, active),
    },
    valveFullyClosedPosition: atLeast(1, settings.valveFullyClosedPosition),
    valveHalfClosedFlowShare: clamp(settings.valveHalfClosedFlowShare, MIN_SHARE, 1),
  };
}
