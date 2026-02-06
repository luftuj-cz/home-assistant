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
  private reconnectTimer: NodeJS.Timeout | null = null;

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
    this.connected = false;
    this.scheduleReconnect();
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    await this.safeDisconnect();
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
          this.logger.info({ unitId: this.cfg.unitId }, "Modbus TCP connected");
          resolve();
        } catch (e) {
          this.logger.error({ e }, "Failed to set unit ID for Modbus TCP");
          reject(e);
        }
      });
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const wait = this.cfg.reconnectMs ?? 3000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        this.logger.debug("Modbus TCP reconnection failed");
      });
    }, wait);
  }

  async safeDisconnect(): Promise<void> {
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

  isConnected() {
    return this.connected;
  }

  async readHolding(start: number, length: number): Promise<number[]> {
    try {
      const res = await this.client.readHoldingRegisters(start, length);
      return Array.from(res.data);
    } catch (err) {
      this.handleDisconnect();
      throw err;
    }
  }

  async readInput(start: number, length: number): Promise<number[]> {
    try {
      const res = await this.client.readInputRegisters(start, length);
      return Array.from(res.data);
    } catch (err) {
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
    } catch (err) {
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
    promises.push(client.safeDisconnect());
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
