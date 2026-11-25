import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempDatabase } from "../helpers/testDb.js";
import { serveRouters, type ServedRouter } from "../helpers/httpRouter.js";

/** The onboarding checklist's last row: does Home Assistant know the LUFTaTOR entities, and how many. */
describe("onboarding status API", () => {
  let cleanup: () => void;
  let api: ServedRouter | undefined;

  async function serve(haClient: unknown) {
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
      "/api/settings": createSettingsRouter(hruService, mqtt as never, haClient as never, logger),
    });
    return api;
  }

  beforeEach(async () => {
    const temp = await setupTempDatabase();
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await api?.close();
    api = undefined;
    cleanup();
  });

  it("counts the LUFTaTOR entities Home Assistant has", async () => {
    const haClient = {
      fetchLuftatorEntities: vi.fn(async () => [{ entity_id: "a" }, { entity_id: "b" }]),
    };
    const result = await (await serve(haClient)).call("GET", "/api/settings/onboarding-status");
    expect(result.body).toMatchObject({ luftatorAvailable: true, luftatorEntityCount: 2 });
  });

  it("reports no count without Home Assistant", async () => {
    const result = await (await serve(null)).call("GET", "/api/settings/onboarding-status");
    expect(result.body).toMatchObject({ luftatorAvailable: false, luftatorEntityCount: null });
  });

  it("reports no count when Home Assistant cannot be reached", async () => {
    const haClient = {
      fetchLuftatorEntities: vi.fn(async () => {
        throw new Error("offline");
      }),
    };
    const result = await (await serve(haClient)).call("GET", "/api/settings/onboarding-status");
    expect(result.body).toMatchObject({ luftatorAvailable: false, luftatorEntityCount: null });
  });
});
