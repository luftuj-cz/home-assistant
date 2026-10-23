import type { Logger } from "pino";
import { describe, expect, it } from "vitest";
import { createLogger, getRecentServerLogs } from "../../src/logger.js";
import { createErrorHandler } from "../../src/middleware/errorHandler.js";
import { HruConnectionError } from "../../src/shared/errors/apiErrors.js";
import { ModbusOperationError, ModbusTcpClient } from "../../src/shared/modbus/client.js";

function silentLogger(): Logger {
  function noop() {}
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    trace: noop,
  } as unknown as Logger;
}

/**
 * Builds a client whose transport is replaced by `stub`, so the low-level
 * helpers can be driven without a socket. They are documented as only running
 * inside runBatch(), but they carry no locking of their own, so calling them
 * directly exercises exactly the wrapping under test.
 */
function clientWithTransport(stub: Record<string, unknown>): ModbusTcpClient {
  const client = new ModbusTcpClient({ host: "127.0.0.1", port: 502, unitId: 1 }, silentLogger());
  (client as unknown as { client: unknown }).client = stub;
  return client;
}

function modbusException(code: number): Error {
  const err = new Error(`Modbus exception ${code}: Illegal data value`) as Error & {
    modbusCode: number;
  };
  err.modbusCode = code;
  return err;
}

describe("ModbusOperationError", () => {
  it("names the register and the value of a rejected single write", async () => {
    const client = clientWithTransport({
      writeRegister: () => Promise.reject(modbusException(3)),
    });

    const err = await client.writeHolding(4210, 3).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ModbusOperationError);
    const opErr = err as ModbusOperationError;
    expect(opErr.message).toContain("Modbus exception 3: Illegal data value");
    expect(opErr.message).toContain("addr=4210 (0x1072)");
    expect(opErr.message).toContain("value=3");
    expect(opErr.message).toContain("unitId=1");
    expect(opErr.op).toBe("writeHolding");
    expect(opErr.address).toBe(4210);
    expect(opErr.values).toEqual([3]);
    expect(opErr.modbusCode).toBe(3);
    expect(opErr.cause).toBeInstanceOf(Error);
  });

  it("lists every value of a rejected multi-register write", async () => {
    const client = clientWithTransport({
      writeRegisters: () => Promise.reject(modbusException(2)),
    });

    const err = (await client
      .writeHolding(4210, [3, 0, 1])
      .catch((e: unknown) => e)) as ModbusOperationError;

    expect(err.message).toContain("values=[3,0,1]");
    expect(err.values).toEqual([3, 0, 1]);
  });

  it("reports the length of a failed read instead of a value", async () => {
    const client = clientWithTransport({
      readHoldingRegisters: () => Promise.reject(modbusException(2)),
    });

    const err = (await client.readHolding(256, 4).catch((e: unknown) => e)) as ModbusOperationError;

    expect(err.message).toContain("[readHolding addr=256 (0x0100) length=4 unitId=1]");
    expect(err.values).toBeUndefined();
    expect(err.length).toBe(4);
  });

  it("does not append the context twice when an already-wrapped error passes through", async () => {
    const wrapped = new ModbusOperationError(modbusException(3), {
      op: "writeHolding",
      address: 4210,
      values: [3],
      unitId: 1,
    });
    const client = clientWithTransport({ writeRegister: () => Promise.reject(wrapped) });

    const err = (await client.writeHolding(4210, 3).catch((e: unknown) => e)) as Error;

    expect(err).toBe(wrapped);
    expect(err.message.match(/addr=4210/g)).toHaveLength(1);
  });

  it("keeps a socket-level failure unclassified as a protocol exception", async () => {
    const socketError = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const client = clientWithTransport({ writeRegister: () => Promise.reject(socketError) });

    const err = (await client.writeHolding(1, 1).catch((e: unknown) => e)) as ModbusOperationError;

    expect(err.modbusCode).toBeUndefined();
    expect(err.message).toContain("connect ECONNREFUSED");
    expect(err.message).toContain("addr=1 (0x0001)");
  });
});

describe("Modbus error classification", () => {
  it("derives MODBUS_EXCEPTION_<n> for a protocol exception surfaced by a batch", async () => {
    const client = clientWithTransport({
      connectTCP: (_host: string, _opts: unknown, cb: () => void) => cb(),
      setID: () => {},
      close: () => {},
      on: () => {},
      setTimeout: () => {},
      writeRegister: () => Promise.reject(modbusException(3)),
    });

    await expect(client.runBatch(() => client.writeHolding(4210, 3))).rejects.toThrow(/addr=4210/);

    const status = client.getStatus();
    expect(status.lastErrorCode).toBe("MODBUS_EXCEPTION_3");
    expect(status.lastErrorMessage).toContain("addr=4210 (0x1072) value=3");

    await client.destroy();
  });
});

/** The wire error a unit raises when it rejects a written value. */
function illegalDataValue(): Error {
  return Object.assign(new Error("Modbus exception 3: Illegal data value"), { modbusCode: 3 });
}

function rejectedWrite(): ModbusOperationError {
  return new ModbusOperationError(illegalDataValue(), {
    op: "writeHolding",
    address: 4210,
    values: [3],
    unitId: 1,
  });
}

describe("surfacing the failed operation beyond the Modbus client", () => {
  it("sends the register and value to the client as the cause of a generic 502", () => {
    let status = 0;
    let body: { detail?: string; code?: string; cause?: string } = {};
    const res = {
      headersSent: false,
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: typeof body) {
        body = payload;
        return this;
      },
    };

    const handle = createErrorHandler(silentLogger());
    handle(
      new HruConnectionError("Failed to write HRU values", rejectedWrite()),
      {} as never,
      res as never,
      (() => {}) as never,
    );

    expect(status).toBe(502);
    // The UI translates `detail` away via `code`, so the diagnosis has to ride
    // in `cause` - see translateApiError in src/shared/utils/apiError.ts.
    expect(body.code).toBe("HRU_CONNECTION_ERROR");
    expect(body.cause).toContain("addr=4210 (0x1072) value=3 unitId=1");
  });

  it("keeps the operation fields in the buffered log the bug report is built from", () => {
    const err = rejectedWrite();
    createLogger("warn").warn(
      { err, op: err.op, address: err.address, values: err.values, modbusCode: err.modbusCode },
      "Modbus TCP: batch failed, retrying",
    );

    const line = getRecentServerLogs(1)[0]?.line ?? "";
    expect(line).toContain("addr=4210 (0x1072) value=3");
    expect(line).toContain('"op":"writeHolding"');
    expect(line).toContain('"modbusCode":3');
  });
});
