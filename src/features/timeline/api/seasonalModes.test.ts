import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteSeasonalMode, fetchSeasonalModes, upsertSeasonalMode } from "./seasonalModes";

describe("seasonal modes API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches seasonal modes with encoded HRU query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSeasonalModes("unit/a");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/timeline/seasonal-modes?hruId=unit%2Fa",
    );
  });

  it("upserts and deletes seasonal modes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ season: "summer" })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await upsertSeasonalMode("summer", null, {
      baseModeId: 1,
      power: null,
      temperature: null,
      variables: null,
      luftatorConfig: null,
      enabled: true,
    });
    await deleteSeasonalMode("summer", null);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3000/api/timeline/seasonal-modes/summer",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/api/timeline/seasonal-modes/summer",
      { method: "DELETE" },
    );
  });
});
