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
        this.logger.info("HRU Monitor: MQTT connected, triggering immediate state refresh");
        void this.runCycle(false); // State only, let MqttService handle discovery
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
        this.logger.debug("HRU Monitor: HRU unit not configured, skipping cycle");
        return;
      }

      if (sendDiscovery) {
        this.logger.info("HRU Monitor: Attempting MQTT discovery refresh...");
        const success = await this.mqttService.publishDiscovery(
          config.unit,
          config.strategy.capabilities,
        );
        if (success) {
          this.mqttService.setLastDiscoveryTime(new Date().toISOString());
        }
      }

      try {
        const result = await this.hruService.readValues();
        const addonMode = this.timelineScheduler.getFormattedActiveMode();
        const boostRemaining = this.timelineScheduler.getBoostRemainingMinutes();
        const boostActiveName = this.timelineScheduler.getActiveBoostName();

        this.logger.info(
          { ...result.value, addonMode, boostRemaining, boostActiveName },
          "HRU Monitor: Read successful, publishing to MQTT",
        );

        await this.mqttService.publishState({
          ...result.value,
          mode_formatted: addonMode,
          native_mode_formatted: result.value.mode,
          boost_remaining: boostRemaining,
          boost_name: boostActiveName || "-",
        });
      } catch (err) {
        this.logger.warn({ err }, "HRU Monitor: Failed to read from HRU");
      }
    } finally {
      this.isRefreshing = false;
    }
  }
}
