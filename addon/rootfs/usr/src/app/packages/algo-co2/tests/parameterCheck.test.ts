import { describe, expect, test } from "vitest";

import { ThresholdType, type AutomaticModeEngine } from "../src/index.js";
import { ALL_LOW, createHouse, runAt } from "./house.js";

/** The problems reported after `change` has been applied to a fresh engine. */
function problemsAfter(change: (engine: AutomaticModeEngine) => void): string[] {
  const { engine } = createHouse();
  change(engine);
  return engine.getParameterProblems();
}

describe("parameter check", () => {
  test("finds nothing wrong with the defaults", () => {
    expect(createHouse({ alpha: 0.3 }).engine.getParameterProblems()).toEqual([]);
  });

  test("reports thresholds in the wrong order", () => {
    const problems = problemsAfter((engine) => {
      engine.thresholds.set(ThresholdType.TH1, 1000);
      engine.thresholds.set(ThresholdType.TH2, 900);
    });

    expect(problems).toContain("thresholds TH2 must be above TH1");
  });

  test("reports a missing threshold", () => {
    const problems = problemsAfter((engine) => {
      engine.thresholds.delete(ThresholdType.TH1);
    });

    expect(problems).toContain("thresholds TH1 must be a finite number above 0");
  });

  test("reports a TH2 band that reaches down to TH1", () => {
    const problems = problemsAfter((engine) => {
      engine.thresholds.set(ThresholdType.TH2, 900);
      engine.co2Hysteresis.set(ThresholdType.TH2, 100);
    });

    expect(problems).toEqual(["co2Hysteresis TH2 must leave TH2 minus the hysteresis above TH1"]);
  });

  test("reports a minimum above the night maximum", () => {
    const problems = problemsAfter((engine) => {
      engine.hruMinPower = 6;
    });

    expect(problems).toContain("hruMinPower must not be above hruMaxPowerNight");
  });

  test("reports valve positions that cannot redistribute the airflow", () => {
    const problems = problemsAfter((engine) => {
      engine.partialCloseValue = 0;
    });

    expect(problems).toEqual(["partialCloseValue must be greater than fullyOpenValue"]);
  });

  test("reports one message per problem", () => {
    const problems = problemsAfter((engine) => {
      engine.hruPowerStep = 0;
      engine.co2FilterAlpha = Number.NaN;
    });

    expect(problems).toEqual([
      "co2FilterAlpha must be above 0 and at most 1",
      "hruPowerStep must be a finite number above 0",
    ]);
  });

  test.each<[string, (engine: AutomaticModeEngine) => void, string]>([
    [
      "a negative hysteresis",
      (engine) => engine.co2Hysteresis.set(ThresholdType.TH1, -1),
      "co2Hysteresis TH1 must be a finite number from 0 to below TH1",
    ],
    [
      "a fluctuation offset as large as TH1",
      (engine) => {
        engine.fluctuationOffset = 800;
      },
      "fluctuationOffset must be a finite number from 0 to below TH1",
    ],
    [
      "a negative time limit",
      (engine) => {
        engine.belowTimeLimit = -1;
      },
      "belowTimeLimit must be a finite number, 0 or more",
    ],
    [
      "an alpha above 1",
      (engine) => {
        engine.co2FilterAlpha = 1.5;
      },
      "co2FilterAlpha must be above 0 and at most 1",
    ],
    [
      "a step-down interval of 0",
      (engine) => {
        engine.hruPowerStepDownInterval = 0;
      },
      "hruPowerStepDownInterval must be a finite number above 0",
    ],
    [
      "a power above the scale",
      (engine) => {
        engine.hruMaxPowerDay = 11;
      },
      "hruMaxPowerDay must be a finite number from 0 to 10",
    ],
    [
      "Pmove below the minimum",
      (engine) => {
        engine.hruMovePower = 1;
      },
      "hruMovePower must not be below hruMinPower",
    ],
    [
      "Pmove above the day maximum",
      (engine) => {
        engine.hruMaxPowerDay = 3;
      },
      "hruMovePower must not be above hruMaxPowerDay",
    ],
    [
      "a negative valve position",
      (engine) => {
        engine.fullyOpenValue = -1;
      },
      "fullyOpenValue must be a finite number, 0 or more",
    ],
    [
      "a day boundary outside the day",
      (engine) => {
        engine.dayEnd = 86400;
      },
      "dayEnd must be a whole second of the day, 0 to 86399",
    ],
    [
      "equal day boundaries",
      (engine) => {
        engine.dayEnd = engine.dayStart;
      },
      "dayStart and dayEnd must differ",
    ],
  ])("reports %s", (_name, change, message) => {
    expect(problemsAfter(change)).toContain(message);
  });

  test("does not stop the engine from running", () => {
    const house = createHouse();
    house.engine.thresholds.set(ThresholdType.TH2, 700);

    expect(house.engine.getParameterProblems()).not.toEqual([]);
    expect(() => runAt(house, 0, ALL_LOW)).not.toThrow();
  });
});
