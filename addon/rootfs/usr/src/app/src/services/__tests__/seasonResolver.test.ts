import { describe, expect, it } from "vitest";
import { resolveSeason } from "../seasonResolver.js";

describe("resolveSeason", () => {
  it.each([
    ["2026-03-19T12:00:00Z", "winter"],
    ["2026-03-20T12:00:00Z", "spring"],
    ["2026-06-21T12:00:00Z", "summer"],
    ["2026-09-22T12:00:00Z", "autumn"],
    ["2026-12-21T12:00:00Z", "winter"],
  ] as const)("resolves northern season for %s", (value, season) => {
    expect(resolveSeason(new Date(value), "northern")).toBe(season);
  });

  it.each([
    ["2026-03-20T12:00:00Z", "autumn"],
    ["2026-06-21T12:00:00Z", "winter"],
    ["2026-09-22T12:00:00Z", "spring"],
    ["2026-12-21T12:00:00Z", "summer"],
  ] as const)("flips southern season for %s", (value, season) => {
    expect(resolveSeason(new Date(value), "southern")).toBe(season);
  });
});
