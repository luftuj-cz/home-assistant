import { AutomaticModeEngine, Building } from "@luftator/algo-co2";
import { describe, expect, it } from "vitest";
import {
  applyEngineParams,
  ENGINE_PARAM_KEYS,
  engineDefaults,
  parameterProblems,
  readEngineParams,
} from "../../../src/services/automatic/engineParams.js";

function engine() {
  return new AutomaticModeEngine(
    new Building([], []),
    { getPower: () => 0, setPower: () => undefined },
    { info: () => undefined },
  );
}

describe("engine parameters", () => {
  it("maps every number and switch the engine declares before its journal flag", () => {
    // The engine declares its parameters first, then `useJournal` (a test aid) and its private state.
    const keys = Object.keys(engine());
    const declared = keys.slice(0, keys.indexOf("useJournal")).filter((key) => {
      const value = (engine() as unknown as Record<string, unknown>)[key];
      return typeof value === "number" || typeof value === "boolean";
    });
    expect(declared.length).toBeGreaterThan(10);
    for (const key of declared) expect(ENGINE_PARAM_KEYS).toContain(key);
  });

  it("reads the engine's defaults", () => {
    expect(engineDefaults()).toMatchObject({
      th1: 800,
      th2: 1200,
      hruMinPower: 2,
      dayStart: 25200,
    });
  });

  it("round-trips through an engine", () => {
    const params = { ...engineDefaults(), th1: 900, fluctuationEnabled: false, dayEnd: 79200 };
    const target = engine();
    applyEngineParams(target, params);
    expect(readEngineParams(target)).toEqual(params);
    expect(Object.keys(params).sort()).toEqual([...ENGINE_PARAM_KEYS].sort());
  });

  it("reports inconsistent values without throwing", () => {
    expect(parameterProblems(engineDefaults())).toEqual([]);
    expect(parameterProblems({ ...engineDefaults(), th2: 700 }).length).toBeGreaterThan(0);
  });
});
