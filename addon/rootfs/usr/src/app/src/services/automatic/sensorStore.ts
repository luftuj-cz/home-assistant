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

/** The key of one value of an entity: "" for its state, else the attribute's name. */
function fieldKey(attribute: string | null): string {
  return attribute ?? "";
}

function parseTime(stamp: string | undefined): number | null {
  if (!stamp) return null;
  const parsed = Date.parse(stamp);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The latest Home Assistant state of every entity assigned to a room as a CO2 source, and when each of its values
 * last changed.
 *
 * The age of a reading is the time since its value last changed, tracked here rather than taken from Home
 * Assistant's `last_reported`: Home Assistant drops an MQTT sensor's repeated value without a trace, so an alive
 * sensor holding one value and a frozen sensor look the same. A value unchanged for longer than the limit counts as
 * frozen, as the engine's README asks. A sensor that drops out shows as unavailable through its availability.
 *
 * Changes arrive over the WebSocket (`state_changed`). The tracked entities are also fetched once a minute, when the
 * rooms change and after the WebSocket reconnects, so a missed event does not leave a value behind.
 */
export class SensorReadingStore {
  private tracked = new Set<string>();
  private readonly states = new Map<string, HassState | null>();
  /** Per entity, per value ("" = state): the value and when it last changed. */
  private readonly changes = new Map<string, Map<string, { value: string; at: number }>>();
  private unsubscribers: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly source: SensorStateSource | null,
    private readonly logger: Logger,
    private readonly refreshIntervalMs = SENSOR_REFRESH_INTERVAL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Stores a state and notes which of its values changed. A value seen for the first time counts from Home
   * Assistant's own change time (`last_changed` for the state, `last_updated` for attributes), so a restart does
   * not make a frozen sensor look fresh.
   */
  private remember(entityId: string, state: HassState | null): void {
    this.states.set(entityId, state);
    if (!state) {
      this.changes.delete(entityId);
      return;
    }
    const known = this.changes.get(entityId) ?? new Map<string, { value: string; at: number }>();
    const fields: [string, unknown, number | null][] = [
      ["", state.state, parseTime(state.last_changed)],
      ...Object.entries(state.attributes ?? {}).map(
        ([key, value]) =>
          [key, value, parseTime(state.last_updated)] as [string, unknown, number | null],
      ),
    ];
    for (const [key, raw, haTime] of fields) {
      const value = JSON.stringify(raw);
      const previous = known.get(key);
      if (!previous) known.set(key, { value, at: haTime ?? this.now() });
      else if (previous.value !== value) known.set(key, { value, at: this.now() });
    }
    this.changes.set(entityId, known);
  }

  start(): void {
    if (!this.source || this.timer) return;
    this.unsubscribers.push(
      this.source.addStateListener((state) => {
        if (this.tracked.has(state.entity_id)) this.remember(state.entity_id, state);
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
      if (!this.tracked.has(entityId)) {
        this.states.delete(entityId);
        this.changes.delete(entityId);
      }
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.source) return;
    const source = this.source;
    await Promise.all(
      [...this.tracked].map(async (entityId) => {
        try {
          this.remember(entityId, await source.fetchState(entityId));
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

  /** When the entity's state (`attribute` null) or attribute last changed, in ms; undefined when never seen. */
  changedAt(entityId: string, attribute: string | null): number | undefined {
    return this.changes.get(entityId)?.get(fieldKey(attribute))?.at;
  }

  /** The full states of every tracked entity, for the bug report. */
  snapshot(): Record<string, HassState | null> {
    return Object.fromEntries([...this.tracked].map((id) => [id, this.states.get(id) ?? null]));
  }
}
