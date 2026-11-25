import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempDatabase } from "../helpers/testDb.js";
import { serveRouters, type ServedRouter } from "../helpers/httpRouter.js";

/** Vzhled in Settings: the theme may follow the system, and temperatures may show in °F. */
describe("appearance settings API", () => {
  let cleanup: () => void;
  let api: ServedRouter;

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;

    const { silentLogger } = await import("../helpers/httpRouter.js");
    const { HruService } = await import("../../src/features/hru/hru.service.js");
    const { HruRepository } = await import("../../src/features/hru/hru.repository.js");
    const { SettingsRepository } =
      await import("../../src/features/settings/settings.repository.js");
    const { createSettingsRouter } = await import("../../src/routes/settings.js");

    const logger = silentLogger() as never;
    const hruService = new HruService(
      new HruRepository(logger),
      new SettingsRepository(logger),
      logger,
    );
    const mqtt = { publishDiscovery: vi.fn(async () => true) };
    api = await serveRouters({
      "/api/settings": createSettingsRouter(hruService, mqtt as never, null, logger),
    });
  });

  afterEach(async () => {
    await api.close();
    cleanup();
  });

  it("stores the system theme", async () => {
    expect((await api.call("POST", "/api/settings/theme", { theme: "system" })).status).toBe(204);
    expect((await api.call("GET", "/api/settings/theme")).body).toEqual({ theme: "system" });
  });

  it("defaults the temperature unit to celsius and stores fahrenheit", async () => {
    expect((await api.call("GET", "/api/settings/temperature-unit")).body).toEqual({
      unit: "celsius",
    });
    const saved = await api.call("POST", "/api/settings/temperature-unit", { unit: "fahrenheit" });
    expect(saved.status).toBe(204);
    expect((await api.call("GET", "/api/settings/temperature-unit")).body).toEqual({
      unit: "fahrenheit",
    });
  });

  it("rejects an unknown temperature unit", async () => {
    const result = await api.call("POST", "/api/settings/temperature-unit", { unit: "kelvin" });
    expect(result.status).toBe(400);
  });
});
