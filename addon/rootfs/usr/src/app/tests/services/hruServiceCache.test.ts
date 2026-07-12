import { describe, expect, it } from "vitest";
import { HruService } from "../../src/features/hru/hru.service.js";
import type { HruRepository } from "../../src/features/hru/hru.repository.js";
import type { SettingsRepository } from "../../src/features/settings/settings.repository.js";
import type { Logger } from "pino";

function createService(): HruService {
  const noopLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger;

  return new HruService({} as HruRepository, {} as SettingsRepository, noopLogger);
}

describe("HruService cache", () => {
  it("has no cached read before anything is set", () => {
    const service = createService();
    expect(service.getCachedRead()).toBeNull();
    expect(service.isRefreshing()).toBe(false);
  });

  it("stores a cached read with a fetchedAt timestamp", () => {
    const service = createService();
    const result = { values: { power: 1 }, displayValues: { power: 1 }, variables: [] };

    const before = Date.now();
    service.setCachedResult(result);
    const after = Date.now();

    const cached = service.getCachedRead();
    expect(cached).not.toBeNull();
    expect(cached?.result).toBe(result);
    expect(cached?.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(cached?.fetchedAt).toBeLessThanOrEqual(after);
  });

  it("tracks the refreshing flag", () => {
    const service = createService();
    expect(service.isRefreshing()).toBe(false);
    service.setRefreshing(true);
    expect(service.isRefreshing()).toBe(true);
    service.setRefreshing(false);
    expect(service.isRefreshing()).toBe(false);
  });
});
