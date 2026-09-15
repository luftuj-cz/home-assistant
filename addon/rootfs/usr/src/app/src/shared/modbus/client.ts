import ModbusRTU from "modbus-serial";
import type { Logger } from "pino";
import { classifyConnectionError, type ConnectionErrorState } from "../errorCodes.js";

export type ModbusOp =
  | "readHolding"
  | "readInput"
  | "readDiscrete"
  | "readCoil"
  | "writeHolding"
  | "writeCoil";

export interface ModbusOpContext {
  op: ModbusOp;
  address: number;
  /** Register/bit count - reads only. */
  length?: number;
  /** Payload actually put on the wire - writes only. */
  values?: readonly (number | boolean)[];
  unitId?: number;
}

function formatAddress(address: number): string {
  return `${address} (0x${address.toString(16).toUpperCase().padStart(4, "0")})`;
}

function formatOpContext(ctx: ModbusOpContext): string {
  const parts = [ctx.op, `addr=${formatAddress(ctx.address)}`];
  if (ctx.values !== undefined) {
    parts.push(
      ctx.values.length === 1
        ? `value=${String(ctx.values[0])}`
        : `values=[${ctx.values.join(",")}]`,
    );
  }
  if (ctx.length !== undefined) parts.push(`length=${ctx.length}`);
  if (ctx.unitId !== undefined) parts.push(`unitId=${ctx.unitId}`);
  return `[${parts.join(" ")}]`;
}

function readModbusCode(err: unknown): number | undefined {
  const code = (err as { modbusCode?: unknown } | null | undefined)?.modbusCode;
  return typeof code === "number" ? code : undefined;
}

/**
 * Carries the register address and the value that was actually sent along with
 * a failed operation. runBatch() only ever sees an opaque callback, so without
 * this the bare protocol message ("Modbus exception 3: Illegal data value") is
 * all that reaches the log, the dashboard's connection line and the API - and
 * it says nothing about which register of a multi-step HRU script rejected
 * which value, which is the one thing needed to fix a unit definition.
 *
 * The context is baked into `message` rather than left on properties alone
 * because logger.ts's expandErrors() reduces an Error to name/message/stack.
 */
export class ModbusOperationError extends Error {
  readonly op: ModbusOp;
  readonly address: number;
  readonly length: number | undefined;
  readonly values: readonly (number | boolean)[] | undefined;
  readonly unitId: number | undefined;
  readonly modbusCode: number | undefined;

  constructor(cause: unknown, ctx: ModbusOpContext) {
    const base = cause instanceof Error ? cause.message : String(cause);
    super(`${base} ${formatOpContext(ctx)}`);
    this.name = "ModbusOperationError";
    this.op = ctx.op;
    this.address = ctx.address;
    this.length = ctx.length;
    this.values = ctx.values;
    this.unitId = ctx.unitId;
    this.modbusCode = readModbusCode(cause);
    this.cause = cause;
  }
}

/** Log fields describing the failed operation; empty for anything else. */
function modbusOpFields(err: unknown): Record<string, unknown> {
  if (!(err instanceof ModbusOperationError)) return {};
  const fields: Record<string, unknown> = { op: err.op, address: err.address };
  if (err.length !== undefined) fields.length = err.length;
  if (err.values !== undefined) fields.values = err.values;
  if (err.modbusCode !== undefined) fields.modbusCode = err.modbusCode;
  return fields;
}

/**
 * Modbus-specific error classification (message-pattern matching), falling
 * back to the shared Node-errno classifier for socket-level errors. Kept
 * local to this module rather than in the shared classifier so Modbus and
 * MQTT don't have to import each other's protocol-specific patterns.
 */
function classifyModbusError(err: unknown): string {
  // A protocol exception carries no string `.code`, so the generic classifier
  // would report "UNKNOWN" for the most diagnosable failures there are.
  const modbusCode = err instanceof ModbusOperationError ? err.modbusCode : readModbusCode(err);
  if (modbusCode !== undefined) return `MODBUS_EXCEPTION_${modbusCode}`;
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Modbus TCP connect timed out")) return "CONNECT_TIMEOUT";
  return classifyConnectionError(err);
}

export interface ModbusTcpConfig {
  host: string;
  port: number;
  unitId: number;
  timeoutMs?: number;
  reconnectMs?: number;
  /** Minimum spacing (ms) enforced between requests. Unit-specific, defaults to 0 (no gap). */
  minGapMs?: number;
}

export interface ModbusConnectionStatus extends ConnectionErrorState {
  connected: boolean;
  reconnecting: boolean;
  consecutiveFailures: number;
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
  private lastErrorCode: string | null = null;
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
      lastErrorCode: this.lastErrorCode,
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

  /** host/port/unitId, for failure logs that would otherwise not say which unit. */
  private connectionFields(): { host: string; port: number; unitId: number } {
    return { host: this.cfg.host, port: this.cfg.port, unitId: this.cfg.unitId };
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
    const modbusClient = new (ModbusRTU as unknown as new () => any)();
    const timeout = this.cfg.timeoutMs ?? 2000;
    modbusClient.setTimeout(timeout);

    // Track connection health via events
    // Guard on client identity so a discarded socket's late error/close can't
    // flip connected=false on the fresh instance (recoverable error would
    // otherwise flicker "unavailable" in the UI). Listeners stay attached, so a
    // late "error" is still handled and never throws as unhandled.
    modbusClient.on("error", (err: unknown) => {
      if (this.client !== modbusClient) return;
      this.logger.warn({ err }, "Modbus TCP connection error");
      this.handleDisconnect();
    });

    modbusClient.on("close", () => {
      if (this.client !== modbusClient) return;
      this.logger.info("Modbus TCP connection closed");
      this.handleDisconnect();
    });

    return modbusClient;
  }

  private resetClient() {
    try {
      this.client.close?.();
    } catch {
      // ignore close errors while force-resetting the client instance
    }
    // Reassign before the old socket's late error/close events fire; the
    // identity guard in createClient's listeners then rejects them.
    this.connected = false;
    this.client = this.createClient();
  }

  /**
   * Serialize `fn` against every other lock holder on this client. Used by
   * runBatch (data batches) AND the reconnect timer, so a reconnect can't swap
   * the socket out from under an in-flight transaction. connect()/ensureConnected
   * must NOT be wrapped when already inside a holder - they'd deadlock on the
   * lock this call holds.
   */
  private async withOpLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.opLock;
    let release: () => void;
    this.opLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await fn();
    } finally {
      release!();
    }
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
    return this.withOpLock(async () => {
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
            this.lastErrorCode = null;
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
            this.lastErrorCode = classifyModbusError(err);
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
              this.logger.error(
                { err, ...this.connectionFields(), attempt, ...modbusOpFields(err) },
                "Modbus TCP: batch failed, giving up",
              );
              throw err;
            }
            this.notifyStatus();
            this.logger.warn(
              { err, ...this.connectionFields(), attempt, attemptsLeft, ...modbusOpFields(err) },
              "Modbus TCP: batch failed, retrying",
            );
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
      }
    });
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

      // Bound the handshake: connectTCP's callback only fires on connect/OS
      // failure, so a dropped SYN would hold the op lock for the OS timeout.
      // `settled` makes timer and callback mutually exclusive.
      let settled = false;
      const connectTimeoutMs = this.cfg.timeoutMs ?? 2000;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.logger.warn(
          { host: this.cfg.host, port: this.cfg.port },
          "Modbus TCP connect timed out",
        );
        // Discard the half-open client so the next connect starts fresh.
        this.resetClient();
        this.handleDisconnect();
        reject(new Error("Modbus TCP connect timed out"));
      }, connectTimeoutMs);
      timer.unref?.(); // don't keep the process alive at shutdown

      this.client.connectTCP(this.cfg.host, { port: this.cfg.port }, (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
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
          this.lastErrorMessage = null;
          this.lastErrorCode = null;
          this.lastErrorAt = null;
          this.logger.info(
            { host: this.cfg.host, port: this.cfg.port, unitId: this.cfg.unitId },
            "Modbus TCP connected successfully",
          );
          this.notifyStatus();
          resolve();
        } catch (err) {
          this.logger.error(
            { err, host: this.cfg.host, port: this.cfg.port },
            "Failed to set unit ID for Modbus TCP",
          );
          reject(err);
        }
      });
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.destroyed) throw new Error("Modbus client destroyed");
    if (this.connectInFlight !== null) return this.connectInFlight;

    this.connectInFlight = this.connectInternal().finally(() => {
      this.connectInFlight = null;
    });

    return this.connectInFlight;
  }

  /**
   * connect() under the op lock, so an external caller (e.g. status probe) can't
   * swap the socket mid-runBatch. No-ops if connected. Returns connected state.
   */
  async connectSerialized(): Promise<boolean> {
    await this.withOpLock(() => this.connect());
    return this.connected;
  }

  private scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;
    const base = this.cfg.reconnectMs ?? ModbusTcpClient.BASE_RECONNECT_MS;
    const wait = Math.min(base * 2 ** this.consecutiveFailures, ModbusTcpClient.MAX_RECONNECT_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.notifyStatus();
      // Take the op lock so the reconnect's connectTCP can't swap the socket
      // mid-transaction while a runBatch is in flight (orphans the in-flight
      // read/write, which then times out into a failure loop).
      void this.withOpLock(() => this.connect()).catch(() => {
        this.logger.debug("Modbus TCP reconnection failed");
      });
    }, wait);
    this.notifyStatus();
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.clearReconnectTimer();

    // If there is a connection in flight, wait for it to finish (it will handle destruction)
    if (this.connectInFlight !== null) {
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
      } catch (err) {
        this.logger.warn({ err }, "Modbus TCP disconnect error");
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

  /**
   * Attach the register address (and, for writes, the payload) to whatever the
   * transport throws. Purely a try/catch - the locking, inter-batch gap and
   * connect handling all belong to runBatch(), per the note above.
   */
  private async runOp<T>(ctx: ModbusOpContext, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof ModbusOperationError) throw err;
      throw new ModbusOperationError(err, { ...ctx, unitId: this.cfg.unitId });
    }
  }

  async readHolding(start: number, length: number): Promise<number[]> {
    const res = await this.runOp<{ data: number[] }>(
      { op: "readHolding", address: start, length },
      () => this.client.readHoldingRegisters(start, length),
    );
    this.logger.debug({ start, length }, "Modbus TCP: readHolding success");
    return Array.from(res.data);
  }

  async readInput(start: number, length: number): Promise<number[]> {
    const res = await this.runOp<{ data: number[] }>(
      { op: "readInput", address: start, length },
      () => this.client.readInputRegisters(start, length),
    );
    this.logger.debug({ start, length }, "Modbus TCP: readInput success");
    return Array.from(res.data);
  }

  async readDiscrete(start: number, length: number): Promise<boolean[]> {
    const res = await this.runOp<{ data: boolean[] }>(
      { op: "readDiscrete", address: start, length },
      () => this.client.readDiscreteInputs(start, length),
    );
    this.logger.debug({ start, length }, "Modbus TCP: readDiscrete success");
    return Array.from(res.data);
  }

  async readCoil(start: number, length: number): Promise<boolean[]> {
    const res = await this.runOp<{ data: boolean[] }>(
      { op: "readCoil", address: start, length },
      () => this.client.readCoils(start, length),
    );
    this.logger.debug({ start, length }, "Modbus TCP: readCoil success");
    return Array.from(res.data);
  }

  async writeHolding(start: number, values: number | number[]): Promise<void> {
    const sent = Array.isArray(values) ? values : [values];
    await this.runOp({ op: "writeHolding", address: start, values: sent }, () =>
      Array.isArray(values)
        ? this.client.writeRegisters(start, values)
        : this.client.writeRegister(start, values),
    );
    this.logger.info({ start, values }, "Modbus TCP: writeHolding success");
  }

  async writeCoil(start: number, values: boolean | number | (boolean | number)[]): Promise<void> {
    const bools = (Array.isArray(values) ? values : [values]).map((v) => !!v);
    await this.runOp({ op: "writeCoil", address: start, values: bools }, () =>
      Array.isArray(values)
        ? this.client.writeCoils(start, bools)
        : this.client.writeCoil(start, !!values),
    );
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
