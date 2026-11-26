import type { Logger } from "pino";
import type { HassState } from "../homeAssistantClient.js";

/** What the store needs from the Home Assistant client. */
export interface SensorStateSource {
  fetchState(entityId: string): Promise<HassState | null>;
  addStateListener(listener: (state: HassState) => void): () => void;
  addStatusListener(
    listener: (state: "disconnected" | "connecting" | "connected") => void,
  ): () => void;
}

export const SENSOR_REFRESH_INTERVAL_MS = 60_000;

/**
 * The latest Home Assistant state of every entity assigned to a room as a CO2 source.
 *
 * Changes arrive over the WebSocket (`state_changed`). A value that does not change fires no event, so the
 * tracked entities are also fetched once a minute: that keeps `last_reported`, and with it the age check, current.
 * They are fetched again when the rooms change and after the WebSocket reconnects.
 */
export class SensorReadingStore {
  private tracked = new Set<string>();
  private readonly states = new Map<string, HassState | null>();
  private unsubscribers: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly source: SensorStateSource | null,
    private readonly logger: Logger,
    private readonly refreshIntervalMs = SENSOR_REFRESH_INTERVAL_MS,
  ) {}

  start(): void {
    if (!this.source || this.timer) return;
    this.unsubscribers.push(
      this.source.addStateListener((state) => {
        if (this.tracked.has(state.entity_id)) this.states.set(state.entity_id, state);
      }),
      this.source.addStatusListener((connection) => {
        if (connection === "connected") void this.refresh();
      }),
    );
    this.timer = setInterval(() => void this.refresh(), this.refreshIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Follows exactly these entities from now on, and fetches their current states. */
  async track(entityIds: Iterable<string>): Promise<void> {
    this.tracked = new Set(entityIds);
    for (const entityId of this.states.keys()) {
      if (!this.tracked.has(entityId)) this.states.delete(entityId);
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.source) return;
    const source = this.source;
    await Promise.all(
      [...this.tracked].map(async (entityId) => {
        try {
          this.states.set(entityId, await source.fetchState(entityId));
        } catch (error) {
          // Keep the last known state: its age decides when it stops counting.
          this.logger.warn({ error, entityId }, "Automatic control: could not fetch a sensor");
        }
      }),
    );
  }

  /** The latest state; undefined when it was never fetched, null when Home Assistant does not know it. */
  get(entityId: string): HassState | null | undefined {
    return this.states.get(entityId);
  }

  /** The full states of every tracked entity, for the bug report. */
  snapshot(): Record<string, HassState | null> {
    return Object.fromEntries([...this.tracked].map((id) => [id, this.states.get(id) ?? null]));
  }
}
