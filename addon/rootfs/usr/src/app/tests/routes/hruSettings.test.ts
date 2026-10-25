import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HruService } from "../../src/features/hru/hru.service.js";
import { setupTempDatabase } from "../helpers/testDb.js";
import { serveRouters, type ServedRouter } from "../helpers/httpRouter.js";

// Atrea aM CF takes a configurable maximum in m³/h; Atrea aM is a plain 0-100 %.
const CONFIGURABLE_UNIT = "atrea-am-cf";
const PERCENT_UNIT = "atrea-am";
const URL = "/api/settings/hru";

const savedConfigurable = {
  unit: CONFIGURABLE_UNIT,
  host: "192.168.1.10",
  port: 502,
  unitId: 1,
  maxPower: 380,
};

const cachedRead = { values: { power: 120 }, displayValues: { power: 120 }, variables: [] };

/**
 * Switching the unit, or its address, from the Settings page: the request a
 * stale form sends must not be rejected, and nothing read from the previous
 * unit may be served as if it came from the new one.
 */
describe("HRU settings API", () => {
  let cleanup: () => void;
  let api: ServedRouter;
  let hruService: HruService;
  let storedSettings: () => Record<string, unknown>;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
    temp.database.setAppSetting("hru.settings", JSON.stringify(savedConfigurable));
    storedSettings = () =>
      JSON.parse(temp.database.getAppSetting("hru.settings") ?? "null") as Record<string, unknown>;

    const { silentLogger } = await import("../helpers/httpRouter.js");
    const { HruService } = await import("../../src/features/hru/hru.service.js");
    const { HruRepository } = await import("../../src/features/hru/hru.repository.js");
    const { SettingsRepository } =
      await import("../../src/features/settings/settings.repository.js");
    const { createSettingsRouter } = await import("../../src/routes/settings.js");

    const logger = silentLogger() as never;
    hruService = new HruService(new HruRepository(logger), new SettingsRepository(logger), logger);
    const mqtt = { publishDiscovery: vi.fn(async () => true) };
    api = await serveRouters({
      "/api/settings": createSettingsRouter(hruService, mqtt as never, null, logger),
    });
  });

  afterEach(async () => {
    await api.close();
    cleanup();
  });

  it("accepts the previous unit's maxPower when the new unit has no configurable maximum", async () => {
    const result = await api.call("POST", URL, { ...savedConfigurable, unit: PERCENT_UNIT });

    expect(result.status).toBe(204);
    expect(storedSettings()).toMatchObject({ unit: PERCENT_UNIT, host: "192.168.1.10" });
    expect(storedSettings().maxPower).toBeUndefined();
  });

  it("still rejects a maxPower above the limit of a unit that takes one", async () => {
    const result = await api.call("POST", URL, {
      ...savedConfigurable,
      unit: "domekt-c6",
      maxPower: 700,
    });

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "MAX_POWER_EXCEEDED" });
    expect(storedSettings()).toMatchObject(savedConfigurable);
  });

  // SP Sabik takes both a configurable minimum (80 m³/h) and maximum (400 m³/h).
  const sabikLimits = { unit: "sp-sabik", minPower: 120, maxPower: 350 };

  it("drops the previous unit's minPower when the new unit has no configurable minimum", async () => {
    const result = await api.call("POST", URL, {
      ...savedConfigurable,
      ...sabikLimits,
      unit: "domekt-c6",
      maxPower: 300,
    });

    expect(result.status).toBe(204);
    expect(storedSettings()).toMatchObject({ unit: "domekt-c6", maxPower: 300 });
    expect(storedSettings().minPower).toBeUndefined();
  });

  it("accepts the previous unit's limits when the new unit takes neither", async () => {
    const result = await api.call("POST", URL, {
      ...savedConfigurable,
      ...sabikLimits,
      unit: "zehnder",
    });

    expect(result.status).toBe(204);
    expect(storedSettings().minPower).toBeUndefined();
    expect(storedSettings().maxPower).toBeUndefined();
  });

  it("still rejects a minPower below the minimum of a unit that takes one", async () => {
    const result = await api.call("POST", URL, {
      ...savedConfigurable,
      ...sabikLimits,
      minPower: 50,
    });

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "MIN_POWER_TOO_LOW" });
  });

  it("drops the cached read of the previous unit", async () => {
    hruService.setCachedResult(cachedRead);

    await api.call("POST", URL, { ...savedConfigurable, unit: PERCENT_UNIT, maxPower: undefined });

    expect(hruService.getCachedRead()).toBeNull();
  });

  it("drops the cached read when the unit moves to another address", async () => {
    hruService.setCachedResult(cachedRead);

    await api.call("POST", URL, { ...savedConfigurable, host: "192.168.1.20" });

    expect(hruService.getCachedRead()).toBeNull();
  });

  it("drops the read failure of the previous address", async () => {
    hruService.setReadFailure(new Error("connect ECONNREFUSED 192.168.1.10:502"));

    await api.call("POST", URL, { ...savedConfigurable, host: "192.168.1.20" });

    expect(hruService.getReadFailure()).toBeNull();
  });

  it("keeps the cached read when only maxPower changes", async () => {
    hruService.setCachedResult(cachedRead);

    await api.call("POST", URL, { ...savedConfigurable, maxPower: 300 });

    expect(hruService.getCachedRead()?.result).toBe(cachedRead);
  });
});
