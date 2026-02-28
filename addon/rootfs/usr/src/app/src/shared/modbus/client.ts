import ModbusRTU from "modbus-serial";
import type { Logger } from "pino";

export interface ModbusTcpConfig {
  host: string;
  port: number;
  unitId: number;
  timeoutMs?: number;
  reconnectMs?: number;
}

export class ModbusTcpClient {
  private client = new ModbusRTU();
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    private readonly cfg: ModbusTcpConfig,
    private readonly logger: Logger,
  ) {
    const timeout = cfg.timeoutMs ?? 2000;
    this.client.setTimeout(timeout);

    // Track connection health via events
    this.client.on("error", (err) => {
      this.logger.warn({ err }, "Modbus TCP connection error");
      this.handleDisconnect();
    });

    this.client.on("close", () => {
      this.logger.info("Modbus TCP connection closed");
      this.handleDisconnect();
    });
  }

  private handleDisconnect() {
    if (this.destroyed) return;
    this.connected = false;
    this.scheduleReconnect();
  }

  async connect(): Promise<void> {
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
    try {
      const res = await this.client.readHoldingRegisters(start, length);
      this.logger.debug({ start, length }, "Modbus TCP: readHolding success");
      return Array.from(res.data);
    } catch (err) {
      this.logger.error({ err, start, length }, "Modbus TCP: readHolding failed");
      this.handleDisconnect();
      throw err;
    }
  }

  async readInput(start: number, length: number): Promise<number[]> {
    try {
      const res = await this.client.readInputRegisters(start, length);
      this.logger.debug({ start, length }, "Modbus TCP: readInput success");
      return Array.from(res.data);
    } catch (err) {
      this.logger.error({ err, start, length }, "Modbus TCP: readInput failed");
      this.handleDisconnect();
      throw err;
    }
  }

  async writeHolding(start: number, values: number | number[]): Promise<void> {
    try {
      if (Array.isArray(values)) {
        await this.client.writeRegisters(start, values);
      } else {
        await this.client.writeRegister(start, values);
      }
      this.logger.info({ start, values }, "Modbus TCP: writeHolding success");
    } catch (err) {
      this.logger.error({ err, start }, "Modbus TCP: writeHolding failed");
      this.handleDisconnect();
      throw err;
    }
  }

  async writeCoil(start: number, values: boolean | number | (boolean | number)[]): Promise<void> {
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
      this.handleDisconnect();
      throw err;
    }
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
