import type { Logger } from "pino";
import { getAppSetting, resolveActiveSeason } from "./database.js";
import { HRU_SETTINGS_KEY, type HruSettings } from "../types/index.js";
import type { MqttService } from "./mqttService.js";
import type { HruService } from "../features/hru/hru.service.js";
import type { TimelineScheduler } from "./timelineScheduler.js";

const POLLING_INTERVAL_MS = 10_000; // 10 seconds

export class HruMonitor {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly hruService: HruService,
    private readonly mqttService: MqttService,
    private readonly timelineScheduler: TimelineScheduler,
    private readonly logger: Logger,
  ) {
    // Register listeners once here, not in start(): stop() can't remove anonymous
    // listeners, so per-start() registration leaks a pair on every restart. They
    // gate on isRunning, so they no-op while stopped.
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
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info("Starting HRU Monitor");

    // Run initial cycle WITH discovery to ensure cache is populated
    void this.runCycle(true);

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

  private async runCycle(sendDiscovery: boolean): Promise<void> {
    this.logger.info(
      { sendDiscovery, isRefreshing: this.hruService.isRefreshing() },
      "HRU Monitor: runCycle called",
    );

    if (this.hruService.isRefreshing()) {
      if (sendDiscovery) {
        this.logger.debug(
          "HRU Monitor: Cycle skipped (already running), but discovery was requested. Will retry next cycle.",
        );
      }
      return;
    }
    this.hruService.setRefreshing(true);

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
        this.hruService.setCachedResult(result);
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
          // Stable key, never the localised name: automations comparing this
          // must not break when the interface language changes.
          active_season: this.resolveActiveSeasonKey(),
        });
        this.logger.info("HRU Monitor: Successfully published state update to MQTT");
      } catch (err) {
        this.logger.error({ err }, "HRU Monitor: Failed to read from HRU or publish to MQTT");
      }
    } finally {
      this.hruService.setRefreshing(false);
    }
  }

  /**
   * Season key for the MQTT state, or "-" when seasons are not in play. Never
   * throws: a monitoring read must not fail because a season could not be
   * resolved.
   */
  private resolveActiveSeasonKey(): string {
    try {
      const raw = getAppSetting(HRU_SETTINGS_KEY);
      const settings = raw ? (JSON.parse(raw) as HruSettings) : null;
      return resolveActiveSeason(settings?.unit ?? null)?.seasonKey ?? "-";
    } catch {
      return "-";
    }
  }
}
