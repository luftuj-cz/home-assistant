import { AutomaticModeEngine, Building, ThresholdType } from "./engine.ts";
import type { HRU } from "./engine.ts";

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
  hruMovePower: number;
  fluctuationEnabled: boolean;
  fluctuationOffset: number;
  partialCloseValue: number;
  fullyOpenValue: number;
  dayStart: number;
  dayEnd: number;
}

function threshold(engine: AutomaticModeEngine, type: ThresholdType): number {
  const value = engine.thresholds.get(type);
  if (value === undefined) {
    throw new Error(`The engine has no ${type} threshold`);
  }
  return value;
}

/** A missing hysteresis entry means 0 to the engine. */
function hysteresis(engine: AutomaticModeEngine, type: ThresholdType): number {
  return engine.co2Hysteresis.get(type) ?? 0;
}

export function readEngineParams(engine: AutomaticModeEngine): EngineParams {
  return {
    th1: threshold(engine, ThresholdType.TH1),
    th2: threshold(engine, ThresholdType.TH2),
    th1Hysteresis: hysteresis(engine, ThresholdType.TH1),
    th2Hysteresis: hysteresis(engine, ThresholdType.TH2),
    thresholdTimeLimit: engine.thresholdTimeLimit,
    belowTimeLimit: engine.belowTimeLimit,
    co2FilterAlpha: engine.co2FilterAlpha,
    hruMinPower: engine.hruMinPower,
    hruMaxPowerDay: engine.hruMaxPowerDay,
    hruMaxPowerNight: engine.hruMaxPowerNight,
    hruPowerStep: engine.hruPowerStep,
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
  engine.hruMovePower = params.hruMovePower;
  engine.fluctuationEnabled = params.fluctuationEnabled;
  engine.fluctuationOffset = params.fluctuationOffset;
  engine.partialCloseValue = params.partialCloseValue;
  engine.fullyOpenValue = params.fullyOpenValue;
  engine.dayStart = params.dayStart;
  engine.dayEnd = params.dayEnd;
}

/** The engine's own defaults, read from an instance so they never drift from the package. */
export function engineDefaults(): EngineParams {
  const idleHru: HRU = {
    getPower() {
      return 0;
    },
    setPower() {
      // Nothing runs this engine; it only holds the defaults.
    },
  };
  const engine = new AutomaticModeEngine(new Building([], []), idleHru, {
    info() {
      // Nothing runs this engine; it only holds the defaults.
    },
  });
  return readEngineParams(engine);
}
