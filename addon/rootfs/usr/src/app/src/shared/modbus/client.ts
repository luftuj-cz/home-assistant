import ModbusRTU from "modbus-serial";
import type { Logger } from "pino";

export interface ModbusTcpConfig {
  host: string;
  port: number;
  unitId: number;
  timeoutMs?: number;
  reconnectMs?: number;
  /** Minimum spacing (ms) enforced between requests. Unit-specific, defaults to 0 (no gap). */
  minGapMs?: number;
}

export interface ModbusConnectionStatus {
  connected: boolean;
  reconnecting: boolean;
  consecutiveFailures: number;
  lastErrorMessage: string | null;
  lastErrorAt: number | null;
}

type ConnectionStatusListener = (status: ModbusConnectionStatus) => void;

export class ModbusTcpClient {
  private static readonly BASE_RECONNECT_MS = 3000;
  private static readonly MAX_RECONNECT_MS = 60_000;
  private static readonly RETRY_DELAY_MS = 1000;

  private client: any;
  private connected = false;
  private hasConnectedOnce = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private connectInFlight: Promise<void> | null = null;
  private opLock: Promise<void> = Promise.resolve();
  private lastBatchEndedAt = 0;
  private consecutiveFailures = 0;
  private failureCounted = false;
  private lastErrorMessage: string | null = null;
  private lastErrorAt: number | null = null;
  private readonly statusListeners = new Set<ConnectionStatusListener>();

  constructor(
    private readonly cfg: ModbusTcpConfig,
    private readonly logger: Logger,
  ) {
    this.client = this.createClient();
  }

  onStatusChange(listener: ConnectionStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): ModbusConnectionStatus {
    return {
      connected: this.connected,
      // Only report "reconnecting" once we've connected at least once - the
      // very first connect() attempt on startup also sets connectInFlight,
      // and that's a normal first connection, not a recovery from failure.
      reconnecting:
        this.hasConnectedOnce && (this.reconnectTimer !== null || this.connectInFlight !== null),
      consecutiveFailures: this.consecutiveFailures,
      lastErrorMessage: this.lastErrorMessage,
      lastErrorAt: this.lastErrorAt,
    };
  }

  /**
   * Update the minimum inter-batch gap on an already-constructed (and possibly
   * cached/shared) client. Needed because getSharedModbusClient() only applies
   * the config a caller passes the FIRST time it creates a client for a given
   * host:port:unitId - without this, an early caller that omits minGapMs (e.g.
   * a status probe) would otherwise permanently cache a gap-less client for a
   * unit that needs one.
   */
  setMinGapMs(minGapMs: number | undefined): void {
    this.cfg.minGapMs = minGapMs;
  }

  private notifyStatus() {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (err) {
        this.logger.warn(
          { err, host: this.cfg.host, port: this.cfg.port, unitId: this.cfg.unitId },
          "Modbus TCP: status listener threw",
        );
      }
    }
  }

  private createClient(): any {
    // modbus-serial exports a constructor function at runtime
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const c = new (ModbusRTU as unknown as new () => any)();
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
   * Serialize a whole batch (one HRU read or write cycle - typically several
   * register operations) against the same socket, and enforce the vendor-recommended
   * minimum spacing BETWEEN batches, not between every register op inside one -
   * the doc's "5s between sessions" means one script execution is one session.
   * Also discards the underlying client on ANY failure (not just socket-level
   * errors) - a frozen Atrea aM unit times out instead of closing the socket, so
   * the modbus-serial transaction state must be reset explicitly or every
   * subsequent request keeps failing the same way until the process restarts.
   *
   * `retries` defaults to 0 - the transport layer doesn't know whether a
   * dropped batch matters to the caller. Callers with periodic natural
   * retries (HruMonitor's poll, TimelineScheduler's tick) should stay at 0 so
   * a transient failure doesn't hold the shared lock/socket any longer than
   * necessary. Callers where a failure would silently discard something the
   * user asked to send (a write) should pass retries explicitly.
   */
  async runBatch<T>(fn: () => Promise<T>, opts?: { retries?: number }): Promise<T> {
    const maxAttempts = 1 + Math.max(0, opts?.retries ?? 0);
    const previous = this.opLock;
    let release: () => void;
    this.opLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      const minGapMs = this.cfg.minGapMs ?? 0;
      const wait = minGapMs - (Date.now() - this.lastBatchEndedAt);
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await this.ensureConnected();
          const result = await fn();
          this.consecutiveFailures = 0;
          this.lastErrorMessage = null;
          this.lastErrorAt = null;
          return result;
        } catch (err) {
          // Capture this before resetClient()/handleDisconnect() below can
          // flip it to false - if the failure was a connect failure,
          // connectInternal()'s own error path already called
          // handleDisconnect() (and counted it) before this catch ran, so
          // `connected` will already be false here.
          const alreadyCountedByConnect = !this.connected;
          this.lastErrorMessage = err instanceof Error ? err.message : String(err);
          this.lastErrorAt = Date.now();
          this.resetClient();

          const attemptsLeft = maxAttempts - attempt;
          if (attemptsLeft <= 0) {
            // Only call handleDisconnect() (which counts the failure) once
            // every retry within this batch is exhausted - in-batch retries
            // are one caller's own retry budget, not independent disconnects,
            // and shouldn't inflate scheduleReconnect's backoff exponent.
            // Skip it here if a connect failure already ran it, or this batch
            // failure would be double-counted for one real disconnect.
            if (!alreadyCountedByConnect) {
              this.handleDisconnect();
            }
            this.logger.error({ err, attempt }, "Modbus TCP: batch failed, giving up");
            throw err;
          }
          this.notifyStatus();
          this.logger.warn({ err, attempt, attemptsLeft }, "Modbus TCP: batch failed, retrying");
          // Retrying reconnects and starts a new Modbus session, so it must
          // respect the same vendor-mandated inter-session spacing as the
          // gap between whole batches, not just the retry backoff.
          const retryDelay = Math.max(ModbusTcpClient.RETRY_DELAY_MS * attempt, minGapMs);
          await new Promise((r) => setTimeout(r, retryDelay));
        }
      }
      // Unreachable: the loop above always returns or throws.
      throw new Error("Modbus TCP: batch retry loop exited unexpectedly");
    } finally {
      this.lastBatchEndedAt = Date.now();
      release!();
    }
  }

  private handleDisconnect() {
    if (this.destroyed) return;
    this.connected = false;
    // De-dup: one outage fires several events (connect-callback err, socket
    // "error", socket "close", plus resetClient()'s own close). Count the
    // failure once per connect attempt so scheduleReconnect's exponent tracks
    // real outages, not event count. Flag resets when the next attempt starts,
    // so backoff still grows across repeated failed reconnects.
    if (this.failureCounted) {
      this.scheduleReconnect();
      return;
    }
    this.failureCounted = true;
    this.consecutiveFailures++;
    this.scheduleReconnect();
    this.notifyStatus();
  }

  private async ensureConnected() {
    return this.connect();
  }

  private async connectInternal(): Promise<void> {
    if (this.connected || this.destroyed) return;

    // New attempt: allow this outage to be counted once (see handleDisconnect).
    this.failureCounted = false;
    this.clearReconnectTimer();
    return new Promise((resolve, reject) => {
      this.logger.info({ host: this.cfg.host, port: this.cfg.port }, "Connecting Modbus TCP");
      this.client.connectTCP(this.cfg.host, { port: this.cfg.port }, (err?: Error) => {
        if (this.destroyed) {
          this.logger.debug("Modbus TCP connection finished after destruction, closing");
          try {
            this.client.close(() => {});
          } catch {
            // Ignore
          }
          reject(new Error("Client destroyed during connection"));
          return;
        }
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
          this.hasConnectedOnce = true;
          this.logger.info(
            { host: this.cfg.host, port: this.cfg.port, unitId: this.cfg.unitId },
            "Modbus TCP connected successfully",
          );
          this.notifyStatus();
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
    const base = this.cfg.reconnectMs ?? ModbusTcpClient.BASE_RECONNECT_MS;
    const wait = Math.min(base * 2 ** this.consecutiveFailures, ModbusTcpClient.MAX_RECONNECT_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.notifyStatus();
      void this.connect().catch(() => {
        this.logger.debug("Modbus TCP reconnection failed");
      });
    }, wait);
    this.notifyStatus();
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.clearReconnectTimer();

    // If there is a connection in flight, wait for it to finish (it will handle destruction)
    if (this.connectInFlight) {
      try {
        await this.connectInFlight;
      } catch {
        // Ignore connection errors during destruction
      }
    }

    if (!this.connected) return;

    return new Promise((resolve) => {
      try {
        this.client.close(() => {
          this.connected = false;
          this.logger.info("Modbus TCP disconnected (requested)");
          resolve();
        });
      } catch (e) {
        this.logger.warn({ e }, "Modbus TCP disconnect error");
        resolve();
      }
    });
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

  // These are only ever called from inside an active runBatch() callback,
  // which already holds the lock, applied the inter-batch gap, and ensured
  // the connection - so no locking/gap/connect logic is needed here.

  async readHolding(start: number, length: number): Promise<number[]> {
    const res = await this.client.readHoldingRegisters(start, length);
    this.logger.debug({ start, length }, "Modbus TCP: readHolding success");
    return Array.from(res.data);
  }

  async readInput(start: number, length: number): Promise<number[]> {
    const res = await this.client.readInputRegisters(start, length);
    this.logger.debug({ start, length }, "Modbus TCP: readInput success");
    return Array.from(res.data);
  }

  async readDiscrete(start: number, length: number): Promise<boolean[]> {
    const res = await this.client.readDiscreteInputs(start, length);
    this.logger.debug({ start, length }, "Modbus TCP: readDiscrete success");
    return Array.from(res.data);
  }

  async readCoil(start: number, length: number): Promise<boolean[]> {
    const res = await this.client.readCoils(start, length);
    this.logger.debug({ start, length }, "Modbus TCP: readCoil success");
    return Array.from(res.data);
  }

  async writeHolding(start: number, values: number | number[]): Promise<void> {
    if (Array.isArray(values)) {
      await this.client.writeRegisters(start, values);
    } else {
      await this.client.writeRegister(start, values);
    }
    this.logger.info({ start, values }, "Modbus TCP: writeHolding success");
  }

  async writeCoil(start: number, values: boolean | number | (boolean | number)[]): Promise<void> {
    if (Array.isArray(values)) {
      const bools = values.map((v) => !!v);
      await this.client.writeCoils(start, bools);
    } else {
      await this.client.writeCoil(start, !!values);
    }
    this.logger.info({ start, values }, "Modbus TCP: writeCoil success");
  }
}

const clientCache = new Map<string, ModbusTcpClient>();

type GlobalStatusListener = (key: string, status: ModbusConnectionStatus) => void;
const globalStatusListeners = new Set<GlobalStatusListener>();

export function onAnyModbusStatusChange(listener: GlobalStatusListener): () => void {
  globalStatusListeners.add(listener);
  return () => globalStatusListeners.delete(listener);
}

function toKey(cfg: { host: string; port: number; unitId: number }): string {
  return `${cfg.host}:${cfg.port}:${cfg.unitId}`;
}

export function getSharedModbusClient(
  cfg: { host: string; port: number; unitId: number; minGapMs?: number },
  logger: Logger,
): ModbusTcpClient {
  const key = toKey(cfg);
  let client = clientCache.get(key);
  if (!client) {
    client = new ModbusTcpClient(
      {
        host: cfg.host,
        port: cfg.port,
        unitId: cfg.unitId,
        timeoutMs: 5000,
        minGapMs: cfg.minGapMs,
      },
      logger,
    );
    client.onStatusChange((status) => {
      for (const listener of globalStatusListeners) listener(key, status);
    });
    clientCache.set(key, client);
  } else if (cfg.minGapMs !== undefined) {
    // A cached client only got its minGapMs from whichever caller first
    // created it for this host:port:unitId - a later caller that knows the
    // correct per-unit value (e.g. hru.service.ts) must be able to correct
    // it, or a caller that created it without one (e.g. a status probe)
    // would silently and permanently defeat the unit's required gap.
    client.setMinGapMs(cfg.minGapMs);
  }
  return client;
}

export function getModbusStatusFor(cfg: {
  host: string;
  port: number;
  unitId: number;
}): ModbusConnectionStatus | null {
  return clientCache.get(toKey(cfg))?.getStatus() ?? null;
}

/**
 * Destroy and evict one cached client (socket + reconnect timer). Call when a
 * config tuple is retired (e.g. HRU host/port/unitId changed) so it doesn't leak.
 */
export async function releaseSharedModbusClient(cfg: {
  host: string;
  port: number;
  unitId: number;
}): Promise<void> {
  const key = toKey(cfg);
  const client = clientCache.get(key);
  if (!client) return;
  clientCache.delete(key);
  await client.destroy();
}

export async function closeAllSharedClients(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const client of clientCache.values()) {
    promises.push(client.destroy());
  }

  // Use a safety timeout to ensure we don't hang during shutdown
  await Promise.race([Promise.all(promises), new Promise((resolve) => setTimeout(resolve, 2000))]);

  clientCache.clear();
}

export async function withTempModbusClient<T>(
  cfg: { host: string; port: number; unitId: number; minGapMs?: number },
  logger: Logger,
  fn: (client: ModbusTcpClient) => Promise<T>,
  opts?: { retries?: number },
): Promise<T> {
  const client = getSharedModbusClient(cfg, logger);

  try {
    return await client.runBatch(() => fn(client), opts);
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
