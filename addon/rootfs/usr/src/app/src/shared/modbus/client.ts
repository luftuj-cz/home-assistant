import ModbusRTU from "modbus-serial";
import type { Logger } from "pino";

export interface ModbusTcpConfig {
  host: string;
  port: number;
  unitId: number;
  timeoutMs?: number;
  reconnectMs?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModbusClient = any;

export class ModbusTcpClient {
  private client: ModbusClient;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private connectInFlight: Promise<void> | null = null;
  private opLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly cfg: ModbusTcpConfig,
    private readonly logger: Logger,
  ) {
    this.client = this.createClient();
  }

  private createClient(): ModbusClient {
    // modbus-serial exports a constructor function at runtime
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const c = new (ModbusRTU as unknown as new () => ModbusClient)();
    const timeout = this.cfg.timeoutMs ?? 2000;
    c.setTimeout(timeout);

    // Track connection health via events
    c.on("error", (err: unknown) => {
      this.logger.warn({ err }, "Modbus TCP connection error");
      this.handleDisconnect();
    });

    c.on("close", () => {
      this.logger.info("Modbus TCP connection closed");
      this.handleDisconnect();
    });

    return c;
  }

  private resetClient() {
    try {
      this.client.close?.();
    } catch {
      // ignore close errors while force-resetting the client instance
    }
    this.connected = false;
    this.client = this.createClient();
  }

  /**
   * Serialize Modbus operations to avoid overlapping requests on the same socket,
   * which can lead to "Port Not Open" errors when the server closes between calls.
   */
  private async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.opLock;
    let release: () => void;
    this.opLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await fn();
    } finally {
      // release is always defined because promise executor runs synchronously
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      release!();
    }
  }

  private handleDisconnect() {
    if (this.destroyed) return;
    this.connected = false;
    this.scheduleReconnect();
  }

  private isPortClosedError(err: unknown) {
    const e = err as { message?: string; errno?: string };
    const msg = e?.message?.toLowerCase() ?? "";
    return (
      msg.includes("port not open") || e?.errno === "ECONNRESET" || e?.errno === "ECONNREFUSED"
    );
  }

  private async ensureConnected() {
    return this.connect();
  }

  private async connectInternal(): Promise<void> {
    if (this.connected || this.destroyed) return;

    this.clearReconnectTimer();
    return new Promise((resolve, reject) => {
      this.logger.info({ host: this.cfg.host, port: this.cfg.port }, "Connecting Modbus TCP");
      this.client.connectTCP(this.cfg.host, { port: this.cfg.port }, (err?: Error) => {
        if (err) {
          this.logger.warn(
            { err, host: this.cfg.host, port: this.cfg.port },
            "Modbus TCP connect failed",
          );
          this.handleDisconnect();
          reject(err);
          return;
        }
        try {
          this.client.setID(this.cfg.unitId);
          this.connected = true;
          this.logger.info(
            { host: this.cfg.host, port: this.cfg.port, unitId: this.cfg.unitId },
            "Modbus TCP connected successfully",
          );
          resolve();
        } catch (e) {
          this.logger.error(
            { e, host: this.cfg.host, port: this.cfg.port },
            "Failed to set unit ID for Modbus TCP",
          );
          reject(e);
        }
      });
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.destroyed) throw new Error("Modbus client destroyed");
    if (this.connectInFlight) return this.connectInFlight;

    this.connectInFlight = this.connectInternal().finally(() => {
      this.connectInFlight = null;
    });

    return this.connectInFlight;
  }

  private scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;
    const wait = this.cfg.reconnectMs ?? 3000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        this.logger.debug("Modbus TCP reconnection failed");
      });
    }, wait);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.clearReconnectTimer();
    if (!this.connected) return;
    try {
      this.client.close(() => {
        this.connected = false;
        this.logger.info("Modbus TCP disconnected (requested)");
      });
    } catch (e) {
      this.logger.warn({ e }, "Modbus TCP disconnect error");
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  isConnected() {
    return this.connected;
  }

  async readHolding(start: number, length: number): Promise<number[]> {
    return this.runExclusive(async () => {
      await this.ensureConnected();
      try {
        const res = await this.client.readHoldingRegisters(start, length);
        this.logger.debug({ start, length }, "Modbus TCP: readHolding success");
        return Array.from(res.data);
      } catch (err) {
        this.logger.error({ err, start, length }, "Modbus TCP: readHolding failed");
        if (this.isPortClosedError(err)) {
          this.resetClient();
          this.handleDisconnect();
          await this.ensureConnected();
          const res = await this.client.readHoldingRegisters(start, length);
          this.logger.debug({ start, length }, "Modbus TCP: readHolding retry success");
          return Array.from(res.data);
        }
        this.handleDisconnect();
        throw err;
      }
    });
  }

  async readInput(start: number, length: number): Promise<number[]> {
    return this.runExclusive(async () => {
      await this.ensureConnected();
      try {
        const res = await this.client.readInputRegisters(start, length);
        this.logger.debug({ start, length }, "Modbus TCP: readInput success");
        return Array.from(res.data);
      } catch (err) {
        this.logger.error({ err, start, length }, "Modbus TCP: readInput failed");
        if (this.isPortClosedError(err)) {
          this.resetClient();
          this.handleDisconnect();
          await this.ensureConnected();
          const res = await this.client.readInputRegisters(start, length);
          this.logger.debug({ start, length }, "Modbus TCP: readInput retry success");
          return Array.from(res.data);
        }
        this.handleDisconnect();
        throw err;
      }
    });
  }

  async writeHolding(start: number, values: number | number[]): Promise<void> {
    return this.runExclusive(async () => {
      await this.ensureConnected();
      try {
        if (Array.isArray(values)) {
          await this.client.writeRegisters(start, values);
        } else {
          await this.client.writeRegister(start, values);
        }
        this.logger.info({ start, values }, "Modbus TCP: writeHolding success");
      } catch (err) {
        this.logger.error({ err, start }, "Modbus TCP: writeHolding failed");
        if (this.isPortClosedError(err)) {
          this.resetClient();
          this.handleDisconnect();
          await this.ensureConnected();
          if (Array.isArray(values)) {
            await this.client.writeRegisters(start, values);
          } else {
            await this.client.writeRegister(start, values);
          }
          this.logger.info({ start, values }, "Modbus TCP: writeHolding retry success");
          return;
        }
        this.handleDisconnect();
        throw err;
      }
    });
  }

  async writeCoil(start: number, values: boolean | number | (boolean | number)[]): Promise<void> {
    return this.runExclusive(async () => {
      await this.ensureConnected();
      try {
        if (Array.isArray(values)) {
          const bools = values.map((v) => !!v);
          await this.client.writeCoils(start, bools);
        } else {
          await this.client.writeCoil(start, !!values);
        }
        this.logger.info({ start, values }, "Modbus TCP: writeCoil success");
      } catch (err) {
        this.logger.error({ err, start }, "Modbus TCP: writeCoil failed");
        if (this.isPortClosedError(err)) {
          this.resetClient();
          this.handleDisconnect();
          await this.ensureConnected();
          if (Array.isArray(values)) {
            const bools = values.map((v) => !!v);
            await this.client.writeCoils(start, bools);
          } else {
            await this.client.writeCoil(start, !!values);
          }
          this.logger.info({ start, values }, "Modbus TCP: writeCoil retry success");
          return;
        }
        this.handleDisconnect();
        throw err;
      }
    });
  }
}

const clientCache = new Map<string, ModbusTcpClient>();

export function getSharedModbusClient(
  cfg: { host: string; port: number; unitId: number },
  logger: Logger,
): ModbusTcpClient {
  const key = `${cfg.host}:${cfg.port}:${cfg.unitId}`;
  let client = clientCache.get(key);
  if (!client) {
    client = new ModbusTcpClient(
      { host: cfg.host, port: cfg.port, unitId: cfg.unitId, timeoutMs: 5000 },
      logger,
    );
    clientCache.set(key, client);
  }
  return client;
}

export async function closeAllSharedClients(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const client of clientCache.values()) {
    promises.push(client.destroy());
  }
  await Promise.all(promises);
  clientCache.clear();
}

export async function withTempModbusClient<T>(
  cfg: { host: string; port: number; unitId: number },
  logger: Logger,
  fn: (client: ModbusTcpClient) => Promise<T>,
): Promise<T> {
  const client = getSharedModbusClient(cfg, logger);

  if (!client.isConnected()) {
    await client.connect();
  }

  try {
    return await fn(client);
  } catch (err) {
    logger.debug({ err }, "Operation failed in withTempModbusClient");
    throw err;
  }
}

export function isModbusReachable(host: string, port: number): boolean {
  const normalizedHost = host === "localhost" ? "127.0.0.1" : host;

  for (const [key, client] of clientCache.entries()) {
    const [cHost, cPort] = key.split(":");
    const normalizedCHost = cHost === "localhost" ? "127.0.0.1" : cHost;

    if (normalizedHost === normalizedCHost && String(port) === cPort && client.isConnected()) {
      return true;
    }
  }
  return false;
}
