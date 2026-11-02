import { describe, expect, test } from "vitest";

import { MAX_STEPS_PER_FRAME, stepsForFrame } from "./runLoop.ts";

describe("stepsForFrame", () => {
  test("stepsForFrame converts real time by speed", () => {
    expect(stepsForFrame(1000, 60, 0)).toEqual({ steps: 60, carryS: 0 });
  });

  test("stepsForFrame carries fractions", () => {
    const first = stepsForFrame(16, 1, 0);
    expect(first.steps).toBe(0);
    expect(first.carryS).toBeCloseTo(0.016, 10);

    const second = stepsForFrame(1000, 1, first.carryS);
    expect(second.steps).toBe(1);
    expect(second.carryS).toBeCloseTo(0.016, 10);
  });

  test("stepsForFrame caps a long pause", () => {
    expect(stepsForFrame(600000, 600, 0)).toEqual({ steps: MAX_STEPS_PER_FRAME, carryS: 0 });
  });
});
