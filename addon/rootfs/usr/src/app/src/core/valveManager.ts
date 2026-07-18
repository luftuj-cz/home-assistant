import type {
  HassStateChangedEvent,
  HomeAssistantClient,
} from "../services/homeAssistantClient.js";
import type { Logger } from "pino";
import { Mutex } from "../utils/mutex.js";
import { storeValveSnapshots } from "../services/database.js";
import { z } from "zod";

export const HassStateSchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  last_changed: z.string().optional(),
  last_updated: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export type ValveSnapshot = z.infer<typeof HassStateSchema>;

export const BroadcastMessageSchema = z.object({
  type: z.enum(["snapshot", "update"]),
  payload: z.union([z.array(HassStateSchema), HassStateSchema]),
});

export type BroadcastMessage = z.infer<typeof BroadcastMessageSchema>;

export type BroadcastFn = (message: BroadcastMessage) => Promise<void>;

export interface ValveController {
  start(): Promise<void>;

  stop(): Promise<void>;

  refresh(): Promise<void>;

  getSnapshot(): Promise<ValveSnapshot[]>;

  setValue(entityId: string, value: number): Promise<ValveSnapshot>;
}

export const HassStateChangedEventSchema = z.object({
  entity_id: z.string(),
  new_state: HassStateSchema.nullable(),
  old_state: HassStateSchema.nullable(),
});

export class ValveManager implements ValveController {
  private static readonly SNAPSHOT_REFRESH_INTERVAL_MS = 60_000;
  private static readonly MISSING_SNAPSHOTS_BEFORE_REMOVAL = 3;
  private readonly mutex = new Mutex();
  private readonly valves = new Map<string, ValveSnapshot>();
  private readonly missingSnapshots = new Map<string, number>();
  private disconnect: (() => void) | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshInProgress: Promise<void> | null = null;

  constructor(
    private readonly client: HomeAssistantClient,
    private readonly logger: Logger,
    private readonly broadcast: BroadcastFn,
  ) {}

  async start(): Promise<void> {
    this.logger.info("Valve manager starting; refreshing initial snapshot");
    await this.refresh();
    this.logger.info("Valve manager subscribing to Home Assistant events");
    this.disconnect = this.client.subscribeLuftatorEvents(async (event) => {
      this.logger.debug(
        { entityId: event.entity_id },
        "Received Home Assistant state change event",
      );
      await this.handleEvent(event);
    });
    this.startPeriodicRefresh();
  }

  async stop(): Promise<void> {
    this.logger.info("Valve manager stopping; unsubscribing from Home Assistant");
    if (this.disconnect) {
      this.disconnect();
      this.disconnect = null;
    }
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async refresh(): Promise<void> {
    if (this.refreshInProgress) {
      return this.refreshInProgress;
    }

    const refreshPromise = this.refreshSnapshot();
    this.refreshInProgress = refreshPromise;
    try {
      await refreshPromise;
    } finally {
      if (this.refreshInProgress === refreshPromise) {
        this.refreshInProgress = null;
      }
    }
  }

  async setValue(entityId: string, value: number): Promise<ValveSnapshot> {
    let valve: ValveSnapshot | undefined;
    await this.mutex.runExclusive(async () => {
      valve = this.valves.get(entityId);
      if (!valve) {
        this.logger.error({ entityId }, "Attempted to set value for unknown valve");
        throw new Error(`Unknown valve: ${entityId}`);
      }
    });

    // Forced update to ensure synchronization (idempotent)
    this.logger.debug({ entityId, value }, "Forwarding setValue to Home Assistant");
    await this.client.setValveValue(entityId, value);

    const updated: ValveSnapshot = HassStateSchema.parse({
      ...valve,
      state: value.toString(),
    });

    await this.mutex.runExclusive(async () => {
      this.valves.set(entityId, updated);
    });

    await this.broadcast({ type: "update", payload: updated });
    storeValveSnapshots([
      {
        entityId: updated.entity_id,
        controllerId: this.resolveControllerId(updated.entity_id),
        controllerName: this.resolveControllerName(updated.entity_id),
        name: (updated.attributes?.friendly_name as string | undefined) ?? null,
        value: Number.isFinite(Number(updated.state)) ? Number(updated.state) : null,
        state: updated.state,
        attributes: updated.attributes ?? {},
        timestamp: updated.last_updated ?? updated.last_changed ?? new Date().toISOString(),
      },
    ]);
    this.logger.debug({ entityId, value }, "Valve value set via manager");

    return updated;
  }

  async getSnapshot(): Promise<ValveSnapshot[]> {
    return this.mutex.runExclusive(async () => Array.from(this.valves.values()));
  }

  private async refreshSnapshot(): Promise<void> {
    this.logger.debug("Fetching valve snapshot from Home Assistant");
    const rawSnapshot = await this.client.fetchLuftatorEntities();
    const snapshot = z.array(HassStateSchema).parse(rawSnapshot);

    const filteredSnapshot = snapshot.filter(
      (valve) => this.isValveEntity(valve.entity_id) && !this.isDemoValve(valve.entity_id),
    );
    let added = 0;
    let removed = 0;
    let reconciledSnapshot: ValveSnapshot[] = [];

    await this.mutex.runExclusive(async () => {
      const refreshedEntityIds = new Set(filteredSnapshot.map((valve) => valve.entity_id));
      for (const valve of filteredSnapshot) {
        const entityId = valve.entity_id;
        if (!this.valves.has(entityId)) {
          added++;
        }
        this.valves.set(entityId, valve);
        this.missingSnapshots.delete(entityId);
      }

      for (const entityId of this.valves.keys()) {
        if (refreshedEntityIds.has(entityId)) continue;

        const missingCount = (this.missingSnapshots.get(entityId) ?? 0) + 1;
        if (missingCount < ValveManager.MISSING_SNAPSHOTS_BEFORE_REMOVAL) {
          this.missingSnapshots.set(entityId, missingCount);
          continue;
        }

        this.valves.delete(entityId);
        this.missingSnapshots.delete(entityId);
        removed++;
      }
      reconciledSnapshot = Array.from(this.valves.values());
    });

    await this.broadcast({ type: "snapshot", payload: reconciledSnapshot });
    storeValveSnapshots(
      reconciledSnapshot.map((valve) => ({
        entityId: valve.entity_id,
        controllerId: this.resolveControllerId(valve.entity_id),
        controllerName: this.resolveControllerName(valve.entity_id),
        name: (valve.attributes?.friendly_name as string | undefined) ?? null,
        value: Number.isFinite(Number(valve.state)) ? Number(valve.state) : null,
        state: valve.state,
        attributes: valve.attributes ?? {},
        timestamp: valve.last_updated ?? valve.last_changed ?? new Date().toISOString(),
      })),
    );
    this.logger.info(
      {
        count: reconciledSnapshot.length,
        added,
        removed,
        removalConfirmationSnapshots: ValveManager.MISSING_SNAPSHOTS_BEFORE_REMOVAL,
      },
      "Valve snapshot synchronised",
    );
  }

  private startPeriodicRefresh(): void {
    if (this.refreshTimer) return;

    this.refreshTimer = setInterval(() => {
      void this.refresh().catch((error: unknown) => {
        this.logger.error({ error }, "Periodic valve snapshot refresh failed");
      });
    }, ValveManager.SNAPSHOT_REFRESH_INTERVAL_MS);
    this.refreshTimer.unref();
    this.logger.info(
      { intervalMs: ValveManager.SNAPSHOT_REFRESH_INTERVAL_MS },
      "Periodic valve snapshot refresh started",
    );
  }

  private isDemoValve(entityId: string): boolean {
    return entityId.includes("_demonstration_");
  }

  private isValveEntity(entityId: string): boolean {
    // Valve entities follow pattern: number.luftator_<controller>_<zone>[_<extra>]
    // Examples: number.luftator_master_bedroom, number.luftator_ground_floor_office
    // HRU variables follow pattern: number.luftator_<hru>_<variable>
    // Examples: number.luftator_zehnder_duration, number.luftator_atrea_power

    // Must start with number.luftator_ or luftator_
    const hasValidPrefix = /^(?:number\.)?luftator_/i.test(entityId);
    if (!hasValidPrefix) return false;

    // Exclude app-internal entities
    const isAppInternal = /^(?:number\.)?luftator_app_/i.test(entityId);
    if (isAppInternal) return false;

    // Exclude demonstration entities
    if (entityId.includes("_demonstration_")) return false;

    // Exclude known non-valve suffixes (HRU variables, timeline entities)
    // This list covers all HRU unit definitions: Zehnder, Atrea, Meltem, Korado, Xvent
    const isNonValveEntity = [
      // Timeline / manual mode entities
      "_doba_manualniho_rezimu",
      "_manual_mode_duration",
      "_manual_duration",
      "_duration",
      // HRU control variables
      "_power",
      "_power_target",
      "_temperature",
      "_temperature_target",
      "_mode",
      "_mode_target",
      "_bypass",
      "_boost",
      "_offset",
      "_comfo_clime",
      // HRU status variables
      "_error",
      "_change_filter",
      "_replace_filter_days",
      "_flow_in",
      "_flow_out",
      "_outside_temperature",
      "_room_temperature",
      "_room_humidity",
      "_supply_temperature",
      "_temperature_profile",
      "_unit_sn",
    ].some((suffix) => entityId.toLowerCase().endsWith(suffix));

    return !isNonValveEntity;
  }

  private async handleEvent(event: HassStateChangedEvent): Promise<void> {
    try {
      const validatedEvent = HassStateChangedEventSchema.parse(event);
      const { entity_id: entityId, new_state: newState } = validatedEvent;
      if (!newState) {
        return;
      }

      if (!this.isValveEntity(entityId) || this.isDemoValve(entityId)) {
        return;
      }

      await this.mutex.runExclusive(async () => {
        this.valves.set(entityId, newState);
        this.missingSnapshots.delete(entityId);
      });

      await this.broadcast({ type: "update", payload: newState });
      storeValveSnapshots([
        {
          entityId: newState.entity_id,
          controllerId: this.resolveControllerId(newState.entity_id),
          controllerName: this.resolveControllerName(newState.entity_id),
          name: (newState.attributes?.friendly_name as string | undefined) ?? null,
          value: Number.isFinite(Number(newState.state)) ? Number(newState.state) : null,
          state: newState.state,
          attributes: newState.attributes ?? {},
          timestamp: newState.last_updated ?? newState.last_changed ?? new Date().toISOString(),
        },
      ]);
      this.logger.debug({ entityId }, "Valve state updated from event");
    } catch (err) {
      this.logger.error({ err, entityId: event.entity_id }, "Error handling valve state event");
    }
  }

  private resolveControllerId(entityId: string): string | null {
    const parts = entityId.split(".");
    if (parts.length !== 2) {
      return null;
    }
    const suffix = parts[1];
    if (!suffix) {
      return null;
    }
    const segments = suffix.split("_");
    if (segments.length < 2) {
      return null;
    }
    // Expect pattern number.luftator_<controller>_<zone>
    const baseSegments = segments.length >= 3 ? segments.slice(0, -1) : segments.slice(0, 1);
    const controller = baseSegments.join("_");
    return controller || null;
  }

  private resolveControllerName(entityId: string): string | null {
    const controllerId = this.resolveControllerId(entityId);
    if (!controllerId) {
      return null;
    }
    return controllerId.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
