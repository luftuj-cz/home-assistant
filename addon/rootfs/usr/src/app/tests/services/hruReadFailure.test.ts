import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { HruController } from "../../src/features/hru/hru.controller.js";
import { createHruRouter } from "../../src/features/hru/hru.routes.js";
import { HruService } from "../../src/features/hru/hru.service.js";
import type { HruRepository } from "../../src/features/hru/hru.repository.js";
import type { SettingsRepository } from "../../src/features/settings/settings.repository.js";
import { HruMonitor } from "../../src/services/hruMonitor.js";
import type { MqttService } from "../../src/services/mqttService.js";
import type { TimelineScheduler } from "../../src/services/timelineScheduler.js";
import type { HruSettings } from "../../src/types/index.js";
import { serveRouters, type ServedRouter } from "../helpers/httpRouter.js";

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function refused(): Error {
  return Object.assign(new Error("connect ECONNREFUSED 127.0.0.2:1599"), { code: "ECONNREFUSED" });
}

/**
 * An HRU that has never answered - a wrong address, a unit that is off - must
 * show up on the dashboard as an error, not as a read that is still loading.
 */
describe("HRU read failures", () => {
  let settings: HruSettings;
  let executeScript: ReturnType<typeof vi.fn>;
  let commandReceived: () => void;
  let hruService: HruService;
  let monitor: HruMonitor;
  let api: ServedRouter;

  beforeEach(async () => {
    settings = { unit: "atrea-am", host: "127.0.0.2", port: 1599, unitId: 1 };
    executeScript = vi.fn();
    hruService = new HruService(
      { executeScript } as unknown as HruRepository,
      { getHruSettings: () => settings } as unknown as SettingsRepository,
      logger,
    );

    const mqtt = {
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "command-received") commandReceived = listener;
      }),
      publishDiscovery: vi.fn(async () => true),
      setLastDiscoveryTime: vi.fn(),
      publishState: vi.fn(async () => undefined),
    };
    const scheduler = {
      getFormattedActiveMode: () => "manual",
      getBoostRemainingMinutes: () => 0,
      getActiveBoostName: () => null,
    };
    monitor = new HruMonitor(
      hruService,
      mqtt as unknown as MqttService,
      scheduler as unknown as TimelineScheduler,
      logger,
    );
    api = await serveRouters({
      "/api/hru": createHruRouter(new HruController(hruService, logger)),
    });
  });

  afterEach(async () => {
    monitor.stop();
    await api.close();
  });

  async function cycle(run: () => void, expectedCalls: number) {
    run();
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalledTimes(expectedCalls));
    await vi.waitFor(() => expect(hruService.isRefreshing()).toBe(false));
  }

  it("reports why the reads fail while nothing has been read yet", async () => {
    executeScript.mockRejectedValue(refused());
    await cycle(() => monitor.start(), 1);

    const result = await api.call("GET", "/api/hru/read");

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      values: null,
      fetchedAt: null,
      readError: { code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.2:1599" },
    });
  });

  it("forgets the failure once a read succeeds", async () => {
    executeScript.mockRejectedValueOnce(refused()).mockResolvedValueOnce({ $power: 40 });
    await cycle(() => monitor.start(), 1);
    await cycle(() => commandReceived(), 2);

    const result = await api.call("GET", "/api/hru/read");

    expect(result.body).toMatchObject({ values: { power: 40 }, readError: null });
  });

  it("does not report a failed read of the previous address for the new one", async () => {
    const read = Promise.withResolvers<Record<string, number>>();
    executeScript.mockReturnValue(read.promise);
    monitor.start();
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalledOnce());

    settings = { ...settings, host: "127.0.0.3" };
    read.reject(refused());
    await vi.waitFor(() => expect(hruService.isRefreshing()).toBe(false));

    expect(hruService.getReadFailure()).toBeNull();
  });
});
