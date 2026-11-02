import { describe, expect, test } from "vitest";

import type { HistorySample } from "../core/simulation.ts";
import {
  clockSecond,
  co2YMax,
  polylinePoints,
  thinSamples,
  windowSamples,
  yTicks,
} from "./chart.ts";

function sample(epochSecond: number, co2: number): HistorySample {
  return {
    epochSecond,
    co2Ppm: { a: co2, b: co2 / 2 },
    filteredCo2Ppm: { a: co2, b: null },
    powerPct: 20,
  };
}

function samplesEvery10s(count: number): HistorySample[] {
  return Array.from({ length: count }, (_, index) => sample(index * 10, 500));
}

describe("windowSamples", () => {
  test("windowSamples keeps only the window", () => {
    const history = samplesEvery10s(11);

    const kept = windowSamples(history, 100, 30);

    expect(kept.map((entry) => entry.epochSecond)).toEqual([70, 80, 90, 100]);
  });

  test("windowSamples returns everything while the run is younger than the window", () => {
    const history = samplesEvery10s(4);

    expect(windowSamples(history, 30, 1800)).toHaveLength(4);
  });
});

describe("polylinePoints", () => {
  test("polylinePoints maps the domain to the box with y up", () => {
    const points = [
      { x: 0, y: 400 },
      { x: 10, y: 1200 },
    ];

    const text = polylinePoints(points, { x0: 0, x1: 10, y0: 400, y1: 1200 }, { w: 100, h: 50 });

    expect(text).toBe("0,50 100,0");
  });

  test("polylinePoints puts an x domain that starts before the data at the right place", () => {
    const text = polylinePoints(
      [{ x: 0, y: 800 }],
      { x0: -100, x1: 100, y0: 400, y1: 1200 },
      { w: 200, h: 80 },
    );

    expect(text).toBe("100,40");
  });
});

describe("thinSamples", () => {
  test("thinSamples leaves a short series alone", () => {
    const history = samplesEvery10s(50);

    expect(thinSamples(history, 100)).toEqual(history);
  });

  test("thinSamples caps a long series and keeps the newest sample", () => {
    const history = samplesEvery10s(8640);

    const thinned = thinSamples(history, 800);

    expect(thinned.length).toBeLessThanOrEqual(801);
    expect(thinned.length).toBeGreaterThan(400);
    expect(thinned[thinned.length - 1]).toBe(history[8639]);
  });

  test("thinSamples picks the same samples when the window slides by a few samples", () => {
    const history = samplesEvery10s(9000);

    const earlier = thinSamples(history.slice(100, 8740), 800);
    const later = thinSamples(history.slice(103, 8743), 800);

    const laterEpochs = new Set(later.map((entry) => entry.epochSecond));
    const shared = earlier.filter((entry) => laterEpochs.has(entry.epochSecond));
    expect(shared.length).toBeGreaterThan(earlier.length - 5);
  });
});

describe("co2YMax", () => {
  test("co2YMax is 1600 until a room goes higher", () => {
    expect(co2YMax([sample(0, 900), sample(10, 1500)])).toBe(1600);
    expect(co2YMax([sample(0, 900), sample(10, 2345)])).toBe(2345);
  });

  test("co2YMax is 1600 without samples", () => {
    expect(co2YMax([])).toBe(1600);
  });
});

describe("yTicks", () => {
  test("yTicks steps by 400 over the default range", () => {
    expect(yTicks(400, 1600)).toEqual([400, 800, 1200, 1600]);
  });

  test("yTicks widens the step so a tall range keeps at most six labels", () => {
    const ticks = yTicks(400, 5000);

    expect(ticks).toEqual([800, 1600, 2400, 3200, 4000, 4800]);
  });
});

describe("clockSecond", () => {
  test("clockSecond wraps past midnight", () => {
    expect(clockSecond(23 * 3600, 2 * 3600)).toBe(3600);
  });

  test("clockSecond wraps before the start of the run", () => {
    expect(clockSecond(3600, -7200)).toBe(23 * 3600);
  });
});
