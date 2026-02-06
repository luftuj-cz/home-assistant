import type { HassStateChangedEvent, HomeAssistantClient } from "../services/homeAssistantClient";
import type { Logger } from "pino";
import { Mutex } from "../utils/mutex";
import { storeValveSnapshots } from "../services/database";
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
  getSnapshot(): Promise<ValveSnapshot[]>;
  setValue(entityId: string, value: number): Promise<ValveSnapshot>;
}

export const HassStateChangedEventSchema = z.object({
  entity_id: z.string(),
  new_state: HassStateSchema.nullable(),
  old_state: HassStateSchema.nullable(),
});

export class ValveManager implements ValveController {
  private readonly mutex = new Mutex();
  private readonly valves = new Map<string, ValveSnapshot>();
  private disconnect: (() => void) | null = null;

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
  }

  async stop(): Promise<void> {
    this.logger.info("Valve manager stopping; unsubscribing from Home Assistant");
    if (this.disconnect) {
      this.disconnect();
      this.disconnect = null;
    }
  }

  async refresh(): Promise<void> {
    this.logger.debug("Fetching valve snapshot from Home Assistant");
    const rawSnapshot = await this.client.fetchLuftatorEntities();
    const snapshot = z.array(HassStateSchema).parse(rawSnapshot);

    await this.mutex.runExclusive(async () => {
      this.valves.clear();
      for (const valve of snapshot) {
        this.valves.set(valve.entity_id, valve);
      }
    });

    await this.broadcast({ type: "snapshot", payload: snapshot });
    storeValveSnapshots(
      snapshot.map((valve) => ({
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
    this.logger.debug({ count: snapshot.length }, "Valve snapshot synchronised");
  }

  async setValue(entityId: string, value: number): Promise<ValveSnapshot> {
    let valve: ValveSnapshot | undefined;
    await this.mutex.runExclusive(async () => {
      valve = this.valves.get(entityId);
      if (!valve) {
        throw new Error(`Unknown valve: ${entityId}`);
      }
    });

    // Forced update to ensure synchronization (idempotent)
    this.logger.debug({ entityId, value }, "Forwarding setValue to Home Assistant");
    await this.client.setValveValue(entityId, value);

    const updated: ValveSnapshot = HassStateSchema.parse({
      ...(valve as ValveSnapshot),
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

  private async handleEvent(event: HassStateChangedEvent): Promise<void> {
    try {
      const validatedEvent = HassStateChangedEventSchema.parse(event);
      const { entity_id: entityId, new_state: newState } = validatedEvent;
      if (!newState) {
        return;
      }

      await this.mutex.runExclusive(async () => {
        this.valves.set(entityId, newState);
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
    const baseSegments =
      segments.length >= 3 ? segments.slice(0, segments.length - 1) : segments.slice(0, 1);
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
