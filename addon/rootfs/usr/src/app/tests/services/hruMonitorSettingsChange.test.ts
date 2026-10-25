import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { HruService } from "../../src/features/hru/hru.service.js";
import type { HruRepository } from "../../src/features/hru/hru.repository.js";
import type { SettingsRepository } from "../../src/features/settings/settings.repository.js";
import { HruMonitor } from "../../src/services/hruMonitor.js";
import type { MqttService } from "../../src/services/mqttService.js";
import type { TimelineScheduler } from "../../src/services/timelineScheduler.js";
import type { HruSettings } from "../../src/types/index.js";

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

/**
 * A poll that was already reading when the HRU settings were saved finishes
 * against the previous unit or address. Its values must not land in the cache
 * or on MQTT as the new unit's state.
 */
describe("HruMonitor when the HRU settings change mid-read", () => {
  let settings: HruSettings;
  let finishRead: (raw: Record<string, number>) => void;
  let executeScript: ReturnType<typeof vi.fn>;
  let publishState: ReturnType<typeof vi.fn>;
  let hruService: HruService;
  let monitor: HruMonitor;

  beforeEach(() => {
    settings = { unit: "atrea-am", host: "192.168.1.10", port: 502, unitId: 1 };
    executeScript = vi.fn(
      () =>
        new Promise<Record<string, number>>((resolve) => {
          finishRead = resolve;
        }),
    );
    publishState = vi.fn(async () => undefined);

    hruService = new HruService(
      { executeScript } as unknown as HruRepository,
      { getHruSettings: () => settings } as unknown as SettingsRepository,
      logger,
    );
    const mqtt = {
      on: vi.fn(),
      publishDiscovery: vi.fn(async () => true),
      setLastDiscoveryTime: vi.fn(),
      publishState,
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
  });

  afterEach(() => {
    monitor.stop();
  });

  async function readInFlight() {
    monitor.start();
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalledOnce());
  }

  async function cycleDone() {
    await vi.waitFor(() => expect(hruService.isRefreshing()).toBe(false));
  }

  it("caches and publishes a read when the settings stay the same", async () => {
    await readInFlight();

    finishRead({ $power: 40 });
    await cycleDone();

    expect(hruService.getCachedRead()?.result.values.power).toBe(40);
    expect(publishState).toHaveBeenCalledOnce();
  });

  it("drops a read of the previous address", async () => {
    await readInFlight();

    settings = { ...settings, host: "192.168.1.20" };
    finishRead({ $power: 40 });
    await cycleDone();

    expect(hruService.getCachedRead()).toBeNull();
    expect(publishState).not.toHaveBeenCalled();
  });

  it("drops a read of the previous unit", async () => {
    await readInFlight();

    settings = { ...settings, unit: "atrea-am-cf", maxPower: 380 };
    finishRead({ $power: 40 });
    await cycleDone();

    expect(hruService.getCachedRead()).toBeNull();
    expect(publishState).not.toHaveBeenCalled();
  });
});
