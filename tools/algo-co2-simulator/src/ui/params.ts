import type { EngineParams } from "../core/engineParams.ts";
import type { SimSettings } from "../core/settings.ts";

const MIN_ALPHA = 0.01;
const MIN_SHARE = 0.01;
/** The engine's power scale is 0–10. */
const MAX_POWER = 10;
/** The engine rounds written powers to two decimals, so a smaller step would vanish. */
const MIN_POWER_STEP = 0.01;
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
  const hruMinPower = clamp(params.hruMinPower, 0, MAX_POWER);
  return {
    th1,
    th2: atLeast(th1 + 1, params.th2),
    th1Hysteresis: atLeast(0, params.th1Hysteresis),
    th2Hysteresis: atLeast(0, params.th2Hysteresis),
    thresholdTimeLimit: atLeast(0, params.thresholdTimeLimit),
    belowTimeLimit: atLeast(0, params.belowTimeLimit),
    co2FilterAlpha: clamp(params.co2FilterAlpha, MIN_ALPHA, 1),
    hruMinPower,
    hruMaxPowerDay: clamp(params.hruMaxPowerDay, hruMinPower, MAX_POWER),
    hruMaxPowerNight: clamp(params.hruMaxPowerNight, hruMinPower, MAX_POWER),
    hruPowerStep: atLeast(MIN_POWER_STEP, params.hruPowerStep),
    hruMovePower: clamp(params.hruMovePower, hruMinPower, MAX_POWER),
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
