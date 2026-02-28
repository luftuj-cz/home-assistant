import type { Logger } from "pino";
import type { MqttService } from "./mqttService";
import type { HruService } from "../features/hru/hru.service";
import type { TimelineScheduler } from "./timelineScheduler";

const POLLING_INTERVAL_MS = 10_000; // 10 seconds

export class HruMonitor {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly hruService: HruService,
    private readonly mqttService: MqttService,
    private readonly timelineScheduler: TimelineScheduler,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info("Starting HRU Monitor");

    // Run initial cycle WITH discovery to ensure cache is populated
    void this.runCycle(true);

    this.mqttService.on("command-received", () => {
      if (this.isRunning) {
        this.logger.debug("HRU Monitor: Command received, triggering immediate cycle");
        void this.runCycle(false);
      }
    });

    this.mqttService.on("connect", () => {
      if (this.isRunning) {
        this.logger.info("HRU Monitor: MQTT connected, triggering state refresh");
        void this.runCycle(false);
      }
    });

    this.timer = setInterval(() => {
      // Periodic update - state only, no discovery to prevent flooding
      void this.runCycle(false);
    }, POLLING_INTERVAL_MS);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("Stopped HRU Monitor");
  }

  private isRefreshing = false;

  private async runCycle(sendDiscovery: boolean): Promise<void> {
    this.logger.info(
      { sendDiscovery, isRefreshing: this.isRefreshing },
      "HRU Monitor: runCycle called",
    );

    if (this.isRefreshing) {
      if (sendDiscovery) {
        this.logger.debug(
          "HRU Monitor: Cycle skipped (already running), but discovery was requested. Will retry next cycle.",
        );
      }
      return;
    }
    this.isRefreshing = true;

    try {
      const config = this.hruService.getResolvedConfiguration();
      if (!config) {
        this.logger.warn("HRU Monitor: HRU unit not configured, skipping cycle");
        return;
      }

      if (sendDiscovery) {
        this.logger.info("HRU Monitor: Attempting MQTT discovery refresh...");
        const success = await this.mqttService.publishDiscovery(config.unit);
        if (success) {
          this.mqttService.setLastDiscoveryTime(new Date().toISOString());
          this.logger.info("HRU Monitor: MQTT discovery refresh successful");
        } else {
          this.logger.error("HRU Monitor: MQTT discovery refresh failed");
        }
      }

      try {
        const result = await this.hruService.readValues();
        const addonMode = this.timelineScheduler.getFormattedActiveMode();
        const boostRemaining = this.timelineScheduler.getBoostRemainingMinutes();
        const boostActiveName = this.timelineScheduler.getActiveBoostName();

        this.logger.info(
          { ...result.displayValues, addonMode, boostRemaining, boostActiveName },
          "HRU Monitor: Read successful, publishing to MQTT",
        );

        await this.mqttService.publishState({
          ...result.displayValues,
          mode_formatted: addonMode,
          boost_remaining: boostRemaining,
          boost_name: boostActiveName || "-",
        });
        this.logger.info("HRU Monitor: Successfully published state update to MQTT");
      } catch (err) {
        this.logger.error({ err }, "HRU Monitor: Failed to read from HRU or publish to MQTT");
      }
    } finally {
      this.isRefreshing = false;
    }
  }
}
