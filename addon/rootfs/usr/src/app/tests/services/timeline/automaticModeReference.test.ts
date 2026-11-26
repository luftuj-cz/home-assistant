import { describe, expect, it } from "vitest";
import { timelineModeInputSchema } from "../../../src/schemas/timeline.js";
import {
  AUTOMATIC_MODE_REFERENCE,
  findTimelineModeByReference,
  hasResolvableTimelineModeReference,
} from "../../../src/services/timeline/modeReference.js";
import type { TimelineMode } from "../../../src/types/index.js";

describe("the built-in Automatika mode", () => {
  const modes = [{ id: 1, name: "Útlum" }] as TimelineMode[];

  it("is accepted as an event's mode but never resolves to a stored mode", () => {
    expect(hasResolvableTimelineModeReference(modes, AUTOMATIC_MODE_REFERENCE)).toBe(true);
    expect(hasResolvableTimelineModeReference([], AUTOMATIC_MODE_REFERENCE)).toBe(true);
    expect(findTimelineModeByReference(modes, AUTOMATIC_MODE_REFERENCE)).toBeNull();
  });

  it("cannot be shadowed by a user mode: names starting with @ are rejected", () => {
    expect(timelineModeInputSchema.safeParse({ name: "@automatic" }).success).toBe(false);
    expect(timelineModeInputSchema.safeParse({ name: "@ jiný" }).success).toBe(false);
    expect(timelineModeInputSchema.safeParse({ name: "Komfort" }).success).toBe(true);
  });
});
