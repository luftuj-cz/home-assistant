import { describe, expect, test } from "vitest";

import type { DecisionBranch } from "../core/engine.ts";
import {
  branchLabel,
  co2Band,
  formatClock,
  formatDuration,
  formatHhMm,
  parseHhMm,
  reviewLabel,
} from "./format.ts";

describe("co2Band", () => {
  test("co2Band boundaries", () => {
    expect(co2Band(799, 800, 1200)).toBe("ok");
    expect(co2Band(800, 800, 1200)).toBe("warn");
    expect(co2Band(1199, 800, 1200)).toBe("warn");
    expect(co2Band(1200, 800, 1200)).toBe("bad");
    expect(co2Band(null, 800, 1200)).toBe("none");
  });
});

describe("formatClock", () => {
  test("formatClock covers the whole day", () => {
    expect(formatClock(0)).toBe("00:00:00");
    expect(formatClock(86399)).toBe("23:59:59");
  });
});

describe("parseHhMm", () => {
  test("parseHhMm round-trips formatHhMm", () => {
    expect(formatHhMm(27000)).toBe("07:30");
    expect(parseHhMm("07:30")).toBe(27000);
    for (const secondOfDay of [0, 60, 27000, 86340]) {
      expect(parseHhMm(formatHhMm(secondOfDay))).toBe(secondOfDay);
    }
  });

  test("parseHhMm rejects text that is not a time of day", () => {
    expect(parseHhMm("24:00")).toBeNull();
    expect(parseHhMm("7:5")).toBeNull();
    expect(parseHhMm("")).toBeNull();
  });
});

describe("formatDuration", () => {
  test("formatDuration shows minutes and padded seconds", () => {
    expect(formatDuration(130)).toBe("2:10");
    expect(formatDuration(5)).toBe("0:05");
  });
});

describe("branchLabel", () => {
  test("branchLabel maps all five values", () => {
    const labels: Record<DecisionBranch, string> = {
      th2: "TH2",
      th1: "TH1",
      fluctuation: "Pohyb osob",
      allBelow: "Vše pod TH1",
      none: "Beze změny",
    };
    for (const [branch, label] of Object.entries(labels)) {
      expect(branchLabel(branch as DecisionBranch)).toBe(label);
    }
  });
});

describe("reviewLabel", () => {
  const roomNames = new Map([
    ["loznice", "Ložnice"],
    ["obyvak", "Obývák"],
  ]);

  test("a review that raises names the lane and the rooms that asked", () => {
    expect(
      reviewLabel({ lane: "slow", raised: true, asked: ["loznice"], held: ["obyvak"] }, roomNames),
    ).toBe("kontrola výkonu (pomalá): přidat, žádá Ložnice");
  });

  test("a held review names the rooms it looked at", () => {
    expect(
      reviewLabel({ lane: "fast", raised: false, asked: [], held: ["obyvak"] }, roomNames),
    ).toBe("kontrola výkonu (rychlá): držet, Obývák");
  });

  test("an unknown room falls back to its id", () => {
    expect(reviewLabel({ lane: "slow", raised: true, asked: ["x"], held: [] }, roomNames)).toBe(
      "kontrola výkonu (pomalá): přidat, žádá x",
    );
  });
});
