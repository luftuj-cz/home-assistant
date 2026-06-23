import { describe, expect, it } from "vitest";
import { SeasonalModesService } from "../seasonalModes.service.js";
import type { SeasonalMode } from "../../../services/db/seasonalModes.js";
import type { TimelineMode } from "../../../types/index.js";
import { BadRequestError, NotFoundError } from "../../../shared/errors/apiErrors.js";

function createService(options: {
  row?: SeasonalMode | null;
  modes?: TimelineMode[];
  hemisphere?: "northern" | "southern";
}) {
  const saved: unknown[] = [];
  const service = new SeasonalModesService(
    {
      getActiveForSeason() {
        return options.row ?? null;
      },
      upsert(row) {
        saved.push(row);
      },
    },
    {
      getSeasonHemisphere() {
        return options.hemisphere ?? "northern";
      },
    },
    {
      getTimelineMode(id: number) {
        return options.modes?.find((mode) => mode.id === id) ?? null;
      },
    },
  );
  return { service, saved };
}

describe("SeasonalModesService", () => {
  it("returns active override with the selected base mode", () => {
    const baseMode = { id: 1, name: "Summer", power: 40 };
    const { service } = createService({
      modes: [baseMode],
      row: {
        season: "summer",
        hruId: null,
        baseModeId: 1,
        power: null,
        temperature: null,
        variables: null,
        luftatorConfig: null,
        enabled: true,
        createdAt: "",
        updatedAt: "",
      },
    });

    const override = service.getActiveOverride(new Date("2026-06-23T12:00:00Z"), null);

    expect(override?.baseMode).toBe(baseMode);
    expect(override?.modeName).toBe("Summer");
  });

  it("ignores disabled seasonal rows", () => {
    const { service } = createService({
      modes: [{ id: 1, name: "Summer" }],
      row: {
        season: "summer",
        hruId: null,
        baseModeId: 1,
        power: null,
        temperature: null,
        variables: null,
        luftatorConfig: null,
        enabled: false,
        createdAt: "",
        updatedAt: "",
      },
    });

    expect(service.getActiveOverride(new Date("2026-06-23T12:00:00Z"), null)).toBeNull();
  });

  it("rejects nonexistent base modes", () => {
    const { service } = createService({ modes: [] });

    expect(() =>
      service.upsert({
        season: "summer",
        hruId: null,
        baseModeId: 99,
        enabled: true,
      }),
    ).toThrow(NotFoundError);
  });

  it("rejects base modes from another unit", () => {
    const { service } = createService({
      modes: [{ id: 2, name: "Unit B", hruId: "unit-b" }],
    });

    expect(() =>
      service.upsert({
        season: "winter",
        hruId: "unit-a",
        baseModeId: 2,
        enabled: true,
      }),
    ).toThrow(BadRequestError);
  });

  it("accepts global base modes for unit-specific seasonal rows", () => {
    const { service, saved } = createService({
      modes: [{ id: 1, name: "Global" }],
    });

    service.upsert({
      season: "winter",
      hruId: "unit-a",
      baseModeId: 1,
      enabled: true,
    });

    expect(saved).toHaveLength(1);
  });
});
