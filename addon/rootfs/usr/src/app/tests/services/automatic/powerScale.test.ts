import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { HruVariable } from "../../../src/features/hru/hru.definitions.js";
import { powerScaleFor } from "../../../src/services/automatic/powerScale.js";

function unitVariables(code: string): HruVariable[] {
  const file = path.resolve(`src/features/hru/definitions/units/${code}.json`);
  return (JSON.parse(readFileSync(file, "utf8")) as { variables: HruVariable[] }).variables;
}

describe("powerScaleFor", () => {
  it("percent: rounds to the unit's step", () => {
    const scale = powerScaleFor(unitVariables("atrea-am"), null)!;
    expect(scale.toUnit(4.3)).toBe(45);
    expect(scale.toUnit(10)).toBe(100);
    expect(scale.fromUnit(45)).toBe(4.5);
    expect(scale.effectiveStep(1)).toBe(1);
  });

  it("minimum above zero: never writes below it", () => {
    const scale = powerScaleFor(unitVariables("sp-sabik"), { maxPower: 400 })!;
    expect(scale.toUnit(1)).toBe(80);
    expect(scale.toUnit(2)).toBe(80);
    expect(scale.toUnit(5)).toBe(200);
  });

  it("levels: one engine step is one level", () => {
    const scale = powerScaleFor(unitVariables("zehnder"), null)!;
    expect(scale.effectiveStep(1)).toBeCloseTo(10 / 3, 5);
    expect(scale.toUnit(2)).toBe(1);
    expect(scale.toUnit(2 + scale.effectiveStep(1))).toBe(2);
    expect(scale.fromUnit(3)).toBe(10);
    expect(powerScaleFor(unitVariables("xvent"), null)!.effectiveStep(1)).toBeCloseTo(10 / 7, 5);
  });

  it("configurable maximum: uses the user's maximum, else the default", () => {
    expect(powerScaleFor(unitVariables("brink"), { maxPower: 300 })!.toUnit(5)).toBe(150);
    expect(powerScaleFor(unitVariables("brink"), null)!.max).toBe(225);
  });

  it("writes the editable power variable only", () => {
    expect(powerScaleFor(unitVariables("meltem"), null)!.variable).toBe("power");
  });

  it("has no scale without a known maximum or a writable power", () => {
    const noMax: HruVariable[] = [
      { name: "power", type: "number", editable: true, label: "x", class: "power", min: 0 },
    ];
    expect(powerScaleFor(noMax, null)).toBeNull();
    expect(powerScaleFor([], null)).toBeNull();
  });
});
