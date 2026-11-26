import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempDatabase } from "../helpers/testDb.js";
import { serveRouters, type ServedRouter } from "../helpers/httpRouter.js";

/** Řízení in the onboarding wizard: the weekly plan or automatic control, kept as a flag for later wiring. */
describe("control mode API", () => {
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

  it("defaults to the weekly plan when nothing was chosen", async () => {
    expect((await api.call("GET", "/api/settings/control-mode")).body).toEqual({
      mode: "schedule",
    });
  });

  it("stores automatic control", async () => {
    const saved = await api.call("POST", "/api/settings/control-mode", { mode: "automatic" });
    expect(saved.status).toBe(204);
    expect((await api.call("GET", "/api/settings/control-mode")).body).toEqual({
      mode: "automatic",
    });
  });

  it("rejects an unknown mode", async () => {
    const result = await api.call("POST", "/api/settings/control-mode", { mode: "manual" });
    expect(result.status).toBe(400);
  });
});
