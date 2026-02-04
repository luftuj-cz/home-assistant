import type { Logger } from "pino";
import type { BroadcastFn, ValveController, ValveSnapshot } from "./valveManager";

export class OfflineValveManager implements ValveController {
  constructor(
    private readonly logger: Logger,
    private readonly broadcast: BroadcastFn,
  ) {}

  async start(): Promise<void> {
    this.logger.warn(
      "Valve manager running in offline mode; Home Assistant communication disabled",
    );
    await this.broadcast({ type: "snapshot", payload: [] });
  }

  async stop(): Promise<void> {
    this.logger.info("Valve manager offline shutdown complete");
  }

  async getSnapshot(): Promise<ValveSnapshot[]> {
    return [];
  }

  async setValue(): Promise<ValveSnapshot> {
    this.logger.error("Offline mode: valve control unavailable");
    throw new Error("Offline mode: valve control unavailable");
  }
}
