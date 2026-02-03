import type { Logger } from "pino";
import type { MqttService } from "./mqttService";
import type { HruService } from "../features/hru/hru.service";

const POLLING_INTERVAL_MS = 60_000; // 1 minute

export class HruMonitor {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly hruService: HruService,
    private readonly mqttService: MqttService,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.info("Starting HRU Monitor");

    // No pre-check, runCycle will handle the refresh logic
    void this.runCycle(true);

    this.timer = setInterval(() => {
      void this.runCycle(true); // Send discovery every minute as requested
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
    const config = this.hruService.getResolvedConfiguration();
    if (!config) {
      this.logger.debug("HRU Monitor: HRU unit not configured, skipping cycle");
      return;
    }

    if (sendDiscovery) {
      this.logger.info("HRU Monitor: Attempting MQTT discovery refresh...");
      const success = await this.mqttService.publishDiscovery(config.unit);
      if (success) {
        this.mqttService.setLastDiscoveryTime(new Date().toISOString());
      }
    }

    try {
      const result = await this.hruService.readValues();

      this.logger.info({ ...result.value }, "HRU Monitor: Read successful, publishing to MQTT");

      // Always try to publish; MqttService will handle its internal state
      await this.mqttService.publishState(result.value);
    } catch (err) {
      this.logger.warn({ err }, "HRU Monitor: Failed to read from HRU");
    }
  }
}
