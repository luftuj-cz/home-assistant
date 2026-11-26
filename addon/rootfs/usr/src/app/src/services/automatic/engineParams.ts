import { AutomaticModeEngine, Building, type HRU, ThresholdType } from "@luftator/algo-co2";

/**
 * Every public parameter of the engine as one flat object, the shape the API, the stored overrides and the
 * page use. Ported from the simulator's `tools/algo-co2-simulator/src/core/engineParams.ts`, which the backend
 * cannot import. `dayStart` and `dayEnd` are seconds of the day, as in the engine.
 */
export interface EngineParams {
  th1: number;
  th2: number;
  th1Hysteresis: number;
  th2Hysteresis: number;
  thresholdTimeLimit: number;
  belowTimeLimit: number;
  co2FilterAlpha: number;
  hruMinPower: number;
  hruMaxPowerDay: number;
  hruMaxPowerNight: number;
  hruPowerStep: number;
  hruPowerStepDownInterval: number;
  powerReviewInterval: number;
  co2FallingMargin: number;
  powerReviewStepLimit: number;
  missingReadingHold: number;
  hruMovePower: number;
  fluctuationEnabled: boolean;
  fluctuationOffset: number;
  partialCloseValue: number;
  fullyOpenValue: number;
  dayStart: number;
  dayEnd: number;
}

export const ENGINE_PARAM_KEYS = [
  "th1",
  "th2",
  "th1Hysteresis",
  "th2Hysteresis",
  "thresholdTimeLimit",
  "belowTimeLimit",
  "co2FilterAlpha",
  "hruMinPower",
  "hruMaxPowerDay",
  "hruMaxPowerNight",
  "hruPowerStep",
  "hruPowerStepDownInterval",
  "powerReviewInterval",
  "co2FallingMargin",
  "powerReviewStepLimit",
  "missingReadingHold",
  "hruMovePower",
  "fluctuationEnabled",
  "fluctuationOffset",
  "partialCloseValue",
  "fullyOpenValue",
  "dayStart",
  "dayEnd",
] as const satisfies ReadonlyArray<keyof EngineParams>;

function threshold(engine: AutomaticModeEngine, type: ThresholdType): number {
  const value = engine.thresholds.get(type);
  if (value === undefined) throw new Error(`The engine has no ${type} threshold`);
  return value;
}

export function readEngineParams(engine: AutomaticModeEngine): EngineParams {
  return {
    th1: threshold(engine, ThresholdType.TH1),
    th2: threshold(engine, ThresholdType.TH2),
    th1Hysteresis: engine.co2Hysteresis.get(ThresholdType.TH1) ?? 0,
    th2Hysteresis: engine.co2Hysteresis.get(ThresholdType.TH2) ?? 0,
    thresholdTimeLimit: engine.thresholdTimeLimit,
    belowTimeLimit: engine.belowTimeLimit,
    co2FilterAlpha: engine.co2FilterAlpha,
    hruMinPower: engine.hruMinPower,
    hruMaxPowerDay: engine.hruMaxPowerDay,
    hruMaxPowerNight: engine.hruMaxPowerNight,
    hruPowerStep: engine.hruPowerStep,
    hruPowerStepDownInterval: engine.hruPowerStepDownInterval,
    powerReviewInterval: engine.powerReviewInterval,
    co2FallingMargin: engine.co2FallingMargin,
    powerReviewStepLimit: engine.powerReviewStepLimit,
    missingReadingHold: engine.missingReadingHold,
    hruMovePower: engine.hruMovePower,
    fluctuationEnabled: engine.fluctuationEnabled,
    fluctuationOffset: engine.fluctuationOffset,
    partialCloseValue: engine.partialCloseValue,
    fullyOpenValue: engine.fullyOpenValue,
    dayStart: engine.dayStart,
    dayEnd: engine.dayEnd,
  };
}

export function applyEngineParams(engine: AutomaticModeEngine, params: EngineParams): void {
  engine.thresholds.set(ThresholdType.TH1, params.th1);
  engine.thresholds.set(ThresholdType.TH2, params.th2);
  engine.co2Hysteresis.set(ThresholdType.TH1, params.th1Hysteresis);
  engine.co2Hysteresis.set(ThresholdType.TH2, params.th2Hysteresis);
  engine.thresholdTimeLimit = params.thresholdTimeLimit;
  engine.belowTimeLimit = params.belowTimeLimit;
  engine.co2FilterAlpha = params.co2FilterAlpha;
  engine.hruMinPower = params.hruMinPower;
  engine.hruMaxPowerDay = params.hruMaxPowerDay;
  engine.hruMaxPowerNight = params.hruMaxPowerNight;
  engine.hruPowerStep = params.hruPowerStep;
  engine.hruPowerStepDownInterval = params.hruPowerStepDownInterval;
  engine.powerReviewInterval = params.powerReviewInterval;
  engine.co2FallingMargin = params.co2FallingMargin;
  engine.powerReviewStepLimit = params.powerReviewStepLimit;
  engine.missingReadingHold = params.missingReadingHold;
  engine.hruMovePower = params.hruMovePower;
  engine.fluctuationEnabled = params.fluctuationEnabled;
  engine.fluctuationOffset = params.fluctuationOffset;
  engine.partialCloseValue = params.partialCloseValue;
  engine.fullyOpenValue = params.fullyOpenValue;
  engine.dayStart = params.dayStart;
  engine.dayEnd = params.dayEnd;
}

const idleHru: HRU = {
  getPower() {
    return 0;
  },
  setPower() {
    // Nothing runs this engine; it only holds the defaults.
  },
};

/** The engine's own defaults, read from an instance so they never drift from the package. */
export function engineDefaults(): EngineParams {
  const engine = new AutomaticModeEngine(new Building([], []), idleHru, {
    info() {
      // Nothing runs this engine; it only holds the defaults.
    },
  });
  return readEngineParams(engine);
}

/** What the engine reports as wrong with `params`, one message per problem. */
export function parameterProblems(params: EngineParams): string[] {
  const engine = new AutomaticModeEngine(new Building([], []), idleHru, {
    info() {
      // Only checks the parameters.
    },
  });
  applyEngineParams(engine, params);
  return engine.getParameterProblems();
}
