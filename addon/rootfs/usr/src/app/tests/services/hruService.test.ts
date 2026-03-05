import { describe, expect, test, vi, beforeEach } from "vitest";
import type { Logger } from "pino";

// Mock implementation
const mockConnect = vi.fn(() => Promise.resolve());
const mockSafeDisconnect = vi.fn(() => Promise.resolve());
const mockReadHolding = vi.fn(() => Promise.resolve([123]));

class MockModbusTcpClient {
  constructor(
    public config: { host: string; port: number; unitId: number },
    public logger: Logger,
  ) {}
}

// Mock the module
vi.mock("../../src/shared/modbus/client.js", () => ({
  ModbusTcpClient: MockModbusTcpClient,
}));

vi.mock("../../src/services/database.js", () => ({
  getAppSetting: vi.fn(() => null),
  setupDatabase: vi.fn(() => {}),
}));

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

describe("HruService", () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockSafeDisconnect.mockClear();
    mockReadHolding.mockClear();
  });

  test("withTempModbusClient should connect, run fn, and disconnect", async () => {
    const { withTempModbusClient } = await import("../../src/shared/modbus/client.js");
    const result = await withTempModbusClient(
      { host: "localhost", port: 502, unitId: 1 },
      mockLogger,
      async (client: { readHolding: (start: number, len: number) => Promise<number[]> }) => {
        return await client.readHolding(0, 1);
      },
    );

    expect(mockConnect).toHaveBeenCalled();
    expect(mockSafeDisconnect).toHaveBeenCalled();
    expect(result).toEqual([123]);
  });

  test("withTempModbusClient should disconnect even if function throws", async () => {
    const { withTempModbusClient } = await import("../../src/shared/modbus/client.js");
    try {
      await withTempModbusClient(
        { host: "localhost", port: 502, unitId: 1 },
        mockLogger,
        async () => {
          throw new Error("Test Error");
        },
      );
    } catch (e) {
      expect((e as Error).message).toBe("Test Error");
    }

    expect(mockConnect).toHaveBeenCalled();
    expect(mockSafeDisconnect).toHaveBeenCalled();
  });
});
