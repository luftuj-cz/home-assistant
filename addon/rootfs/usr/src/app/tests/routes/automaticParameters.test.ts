import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HruVariable } from "../../src/features/hru/hru.definitions.js";
import { serveRouters, type ServedRouter } from "../helpers/httpRouter.js";
import { setupTempDatabase } from "../helpers/testDb.js";

function unitVariables(code: string): HruVariable[] {
  const file = path.resolve(`src/features/hru/definitions/units/${code}.json`);
  return (JSON.parse(readFileSync(file, "utf8")) as { variables: HruVariable[] }).variables;
}

/** Engine parameters over HTTP: overrides only, problems reported, unit equivalents shown. */
describe("automatic control parameters API", () => {
  let cleanup: () => void;
  let api: ServedRouter;
  let onParametersChanged: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    const { silentLogger } = await import("../helpers/httpRouter.js");
    const { createAutomaticRouter } = await import("../../src/routes/automatic.js");
    const { powerScaleFor } = await import("../../src/services/automatic/powerScale.js");
    onParametersChanged = vi.fn<() => void>();
    api = await serveRouters({
      "/api/automatic": createAutomaticRouter({
        logger: silentLogger() as never,
        onParametersChanged,
        powerScale: () => powerScaleFor(unitVariables("sp-sabik"), { maxPower: 400 }),
      }),
    });
  });

  afterEach(async () => {
    await api.close();
    cleanup();
  });

  it("starts with the engine's defaults and no overrides", async () => {
    const result = await api.call("GET", "/api/automatic/parameters");
    expect(result.body).toMatchObject({
      overrides: {},
      problems: [],
      maxReadingAgeSeconds: 1800,
      values: { th1: 800, hruMinPower: 2 },
    });
  });

  it("shows power parameters in the unit's terms", async () => {
    const result = await api.call("GET", "/api/automatic/parameters");
    expect(result.body).toMatchObject({
      power: { variable: "power", max: 400, equivalents: { hruMinPower: 80, hruMaxPowerDay: 400 } },
    });
  });

  it("stores only the values that differ from the defaults and tells the runner", async () => {
    const result = await api.call("PUT", "/api/automatic/parameters", {
      overrides: { th1: 900, th2: 1200 },
      maxReadingAgeSeconds: 600,
    });
    expect(result.body).toMatchObject({
      overrides: { th1: 900 },
      values: { th1: 900, th2: 1200 },
      maxReadingAgeSeconds: 600,
    });
    expect(onParametersChanged).toHaveBeenCalledTimes(1);
  });

  it("stores inconsistent values and lists the problem", async () => {
    const result = await api.call("PUT", "/api/automatic/parameters", { overrides: { th2: 700 } });
    expect(result.status).toBe(200);
    expect((result.body!.problems as string[]).length).toBeGreaterThan(0);
  });

  it("rejects values of the wrong type and unknown keys", async () => {
    expect(
      (await api.call("PUT", "/api/automatic/parameters", { overrides: { th1: "900" } })).status,
    ).toBe(400);
    expect(
      (await api.call("PUT", "/api/automatic/parameters", { overrides: { useJournal: true } }))
        .status,
    ).toBe(400);
  });

  it("resets to the defaults", async () => {
    await api.call("PUT", "/api/automatic/parameters", { overrides: { th1: 900 } });
    const reset = await api.call("PUT", "/api/automatic/parameters", {
      overrides: {},
      maxReadingAgeSeconds: null,
    });
    expect(reset.body).toMatchObject({ overrides: {}, maxReadingAgeSeconds: 1800 });
  });
});
