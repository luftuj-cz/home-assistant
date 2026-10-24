import { describe, expect, it, vi } from "vitest";
import pino from "pino";

/**
 * Systemair SAVE drops or mismatches overlapping requests, so a script must
 * never have two Modbus reads in flight at once, even when they are sibling
 * arguments of one expression.
 */

const inFlight = { now: 0, max: 0 };
const calls: string[] = [];
const inputRegisters: Record<number, number> = { 7004: 47228, 7005: 235 };
const holdingRegisters: Record<number, number> = { 105: 3, 106: 400 };

const fakeClient = {
  async readHolding(start: number, length: number) {
    calls.push(`readHolding ${start} ${length}`);
    return Array.from({ length }, (_, i) => holdingRegisters[start + i] ?? 0);
  },
  async readInput(start: number, length: number) {
    calls.push(`readInput ${start} ${length}`);
    inFlight.now++;
    inFlight.max = Math.max(inFlight.max, inFlight.now);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight.now--;
    return Array.from({ length }, (_, i) => inputRegisters[start + i] ?? 0);
  },
};

vi.mock("../../src/shared/modbus/client.js", () => ({
  withTempModbusClient: (_cfg: unknown, _logger: unknown, fn: (client: unknown) => unknown) =>
    fn(fakeClient),
}));

const { HruRepository } = await import("../../src/features/hru/hru.repository.js");

const repo = new HruRepository(pino({ level: "silent" }));
const config = { host: "test", port: 502, unitId: 1 };

function reset() {
  inFlight.now = 0;
  inFlight.max = 0;
  calls.length = 0;
}

describe("HruRepository.executeScript", () => {
  it("evaluates sibling Modbus reads one at a time, left to right", async () => {
    reset();
    const vars = await repo.executeScript(config, [
      {
        type: "assignment",
        variable: "$filter",
        value: {
          function: "sum",
          args: [
            {
              function: "multiply",
              args: [{ function: "modbus_read_input", args: [7005, 1] }, 65536],
            },
            { function: "modbus_read_input", args: [7004, 1] },
          ],
        },
      },
    ]);

    expect(inFlight.max).toBe(1);
    expect(calls).toEqual(["readInput 7005 1", "readInput 7004 1"]);
    expect(vars.$filter).toBe(235 * 65536 + 47228);
  });

  it("reads a low-word-first input pair in one request with modbus_read_input_uint32_le", async () => {
    reset();
    const vars = await repo.executeScript(config, [
      {
        type: "assignment",
        variable: "$filter",
        value: { function: "modbus_read_input_uint32_le", args: [7004] },
      },
    ]);

    expect(calls).toEqual(["readInput 7004 2"]);
    expect(vars.$filter).toBe(235 * 65536 + 47228);
  });

  it("reads a high-word-first input pair in one request with modbus_read_input_uint32_be", async () => {
    reset();
    const vars = await repo.executeScript(config, [
      {
        type: "assignment",
        variable: "$value",
        value: { function: "modbus_read_input_uint32_be", args: [7004] },
      },
    ]);

    expect(calls).toEqual(["readInput 7004 2"]);
    expect(vars.$value).toBe(47228 * 65536 + 235);
  });

  it("reads a low-word-first holding pair in one request with modbus_read_holding_uint32_le", async () => {
    reset();
    const vars = await repo.executeScript(config, [
      {
        type: "assignment",
        variable: "$value",
        value: { function: "modbus_read_holding_uint32_le", args: [105] },
      },
    ]);

    expect(calls).toEqual(["readHolding 105 2"]);
    expect(vars.$value).toBe(400 * 65536 + 3);
  });

  it("reads a high-word-first holding pair in one request with modbus_read_holding_uint32_be", async () => {
    reset();
    const vars = await repo.executeScript(config, [
      {
        type: "assignment",
        variable: "$value",
        value: { function: "modbus_read_holding_uint32_be", args: [105] },
      },
    ]);

    expect(calls).toEqual(["readHolding 105 2"]);
    expect(vars.$value).toBe(3 * 65536 + 400);
  });

  it("divides, returning 0 for a zero divisor", async () => {
    reset();
    const vars = await repo.executeScript(config, [
      {
        type: "assignment",
        variable: "$ratio",
        value: {
          function: "divide",
          args: [{ function: "modbus_read_holding", args: [106, 1] }, 8],
        },
      },
      { type: "assignment", variable: "$zero", value: { function: "divide", args: [5, 0] } },
    ]);

    expect(vars.$ratio).toBe(50);
    expect(vars.$zero).toBe(0);
  });
});
