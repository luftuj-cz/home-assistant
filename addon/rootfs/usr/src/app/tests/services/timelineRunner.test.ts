import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import type { ValveController } from "../../src/core/valveManager.js";
import type { Logger } from "pino";
import type { TimelineEvent } from "../../src/services/database.js";

// Mock dependencies
const mockGetTimelineEvents = vi.fn<() => TimelineEvent[]>(() => []);
vi.mock("../../src/services/database.js", () => ({
  getTimelineEvents: mockGetTimelineEvents,
}));

const mockModbusWriteHolding = vi.fn(async () => {});
const mockWithTempModbusClient = vi.fn(async (_cfg: unknown, _logger: unknown, fn: (client: unknown) => Promise<void>) => {
  const mockClient = {
    writeHolding: mockModbusWriteHolding,
  };
  await fn(mockClient);
});

vi.mock("../../src/shared/modbus/client.js", () => ({
  withTempModbusClient: mockWithTempModbusClient,
  getSharedModbusClient: vi.fn(() => ({ isConnected: () => false, connect: vi.fn(), readHolding: vi.fn() })),
}));

vi.mock("../../src/features/hru/hru.service.js", () => ({
  HruService: vi.fn(() => ({ getAllUnits: () => [], writeValues: vi.fn() })),
}));

vi.mock("../../src/features/settings/settings.repository.js", () => ({
  SettingsRepository: vi.fn(() => ({ getTimelineOverride: () => null })),
}));

const mockLogger = {
  info: vi.fn(() => {}),
  warn: vi.fn(() => {}),
  debug: vi.fn(() => {}),
  error: vi.fn(() => {}),
} as unknown as Logger;

const mockSetValue = vi.fn(async () => ({}));
const mockValveManager = {
  setValue: mockSetValue,
  getSnapshot: vi.fn(async () => []),
} as unknown as ValveController;

describe("TimelineScheduler", () => {
  beforeEach(() => {
    mockGetTimelineEvents.mockClear();
    mockWithTempModbusClient.mockClear();
    mockModbusWriteHolding.mockClear();
    mockSetValue.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T12:00:00Z")); // Monday
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("should pick active event based on time and priority", async () => {
    const { TimelineScheduler } = await import("../../src/services/timelineScheduler.js");
    const events = [
      {
        id: 1,
        startTime: "10:00",
        endTime: "14:00",
        dayOfWeek: 0, // Monday
        priority: 10,
        enabled: true,
        luftatorConfig: { "valve.1": 50 },
      },
      {
        id: 2,
        startTime: "11:00",
        endTime: "13:00",
        dayOfWeek: 0, // Monday
        priority: 20, // Higher priority should win
        enabled: true,
        luftatorConfig: { "valve.1": 100 },
      },
    ];
    mockGetTimelineEvents.mockReturnValue(events);

    const scheduler = new TimelineScheduler(mockValveManager, {} as never, {} as never, mockLogger);
    await (scheduler as unknown as { executeScheduledEvent: () => Promise<void> }).executeScheduledEvent();

    expect(mockSetValue).toHaveBeenCalledWith("valve.1", 100);
    expect(mockSetValue).toHaveBeenCalledTimes(1);
  });

  test("should ignore disabled events", async () => {
    const { TimelineScheduler } = await import("../../src/services/timelineScheduler.js");
    const events = [
      {
        id: 1,
        startTime: "10:00",
        endTime: "14:00",
        dayOfWeek: 0,
        priority: 10,
        enabled: false,
        luftatorConfig: { "valve.1": 50 },
      },
    ];
    mockGetTimelineEvents.mockReturnValue(events);

    const scheduler = new TimelineScheduler(mockValveManager, {} as never, {} as never, mockLogger);
    await (scheduler as unknown as { executeScheduledEvent: () => Promise<void> }).executeScheduledEvent();

    expect(mockSetValue).not.toHaveBeenCalled();
  });

  test("should apply HRU settings if configured", async () => {
    const { TimelineScheduler } = await import("../../src/services/timelineScheduler.js");
    const events = [
      {
        id: 1,
        startTime: "10:00",
        endTime: "14:00",
        dayOfWeek: 0,
        priority: 10,
        enabled: true,
        hruConfig: { power: 60, temperature: 22 },
      },
    ];
    mockGetTimelineEvents.mockReturnValue(events);

    const scheduler = new TimelineScheduler(mockValveManager, {} as never, {} as never, mockLogger);
    await (scheduler as unknown as { executeScheduledEvent: () => Promise<void> }).executeScheduledEvent();

    expect(mockWithTempModbusClient).toHaveBeenCalled();
  });
});
