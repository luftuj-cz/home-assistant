import { describe, expect, it, vi } from "vitest";
import { TimelineScheduler } from "../../../src/services/timelineScheduler.js";

type ValveApplier = {
  applyValveUpdates: (
    luftatorConfig: Record<string, number>,
    source: string,
  ) => Promise<Error | null>;
};

function makeScheduler(snapshotIds: string[], setValue = vi.fn(async () => ({ state: "80" }))) {
  const scheduler = new TimelineScheduler(
    {
      getSnapshot: async () => snapshotIds.map((entity_id) => ({ entity_id })),
      setValue,
    } as never,
    { getAllUnits: () => [] } as never,
    { setTimelineOverride: vi.fn() } as never,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
  );
  return {
    apply: (scheduler as unknown as ValveApplier).applyValveUpdates.bind(scheduler),
    setValue,
  };
}

/**
 * A valve the mode configures but Home Assistant does not currently expose
 * cannot be moved. That has to surface as a failure: a boost that reported
 * success while nothing moved left the dashboard claiming a running boost over
 * hardware that had not changed. Before 1.1.0 the write threw "Unknown valve"
 * and the boost was rolled back.
 */
describe("applying valve positions", () => {
  it("moves every valve present in the snapshot", async () => {
    const { apply, setValue } = makeScheduler(["number.a", "number.b"]);

    const error = await apply({ "number.a": 80, "number.b": 20 }, "boost");

    expect(error).toBeNull();
    expect(setValue).toHaveBeenCalledTimes(2);
  });

  it("reports a valve missing from the snapshot as a failure while still moving the rest", async () => {
    const { apply, setValue } = makeScheduler(["number.a"]);

    const error = await apply({ "number.a": 80, "number.gone": 20 }, "boost");

    expect(error?.message).toMatch(/number\.gone/);
    expect(setValue).toHaveBeenCalledTimes(1);
    expect(setValue).toHaveBeenCalledWith("number.a", 80);
  });

  it("fails when Home Assistant exposes no valves at all", async () => {
    const { apply, setValue } = makeScheduler([]);

    const error = await apply({ "number.a": 80 }, "boost");

    expect(error).not.toBeNull();
    expect(setValue).not.toHaveBeenCalled();
  });

  it("applies a scheduled event best-effort, so an evicted valve cannot block cancelling a boost", async () => {
    const { apply, setValue } = makeScheduler(["number.a"]);

    const error = await apply({ "number.a": 80, "number.gone": 20 }, "schedule");

    expect(error).toBeNull();
    expect(setValue).toHaveBeenCalledTimes(1);
  });
});
