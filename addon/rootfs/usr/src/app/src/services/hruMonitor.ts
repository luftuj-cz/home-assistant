import type { Logger } from "pino";
import type { MqttService } from "./mqttService";
import { getHruDefinitionSafe, getSharedModbusClient } from "./hruService";

const POLLING_INTERVAL_MS = 60_000; // 1 minute

export class HruMonitor {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
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
    const hruCtx = getHruDefinitionSafe();
    if (!hruCtx) {
      this.logger.debug("HRU Monitor: HRU not configured, skipping cycle");
      return;
    }

    const { settings, def } = hruCtx;

    // Get shared client
    const client = getSharedModbusClient(
      {
        host: settings.host,
        port: settings.port,
        unitId: settings.unitId,
      },
      this.logger,
    );

    // Log the configuration we are using for this cycle
    this.logger.debug(
      {
        host: settings.host,
        port: settings.port,
        unitId: settings.unitId,
        discovery: sendDiscovery,
      },
      "HRU Monitor: Starting polling cycle",
    );

    if (sendDiscovery) {
      this.logger.info("HRU Monitor: Attempting MQTT discovery refresh...");
      const success = await this.mqttService.publishDiscovery(def);
      if (success) {
        this.mqttService.setLastDiscoveryTime(new Date().toISOString());
      }
    }

    try {
      if (!client.isConnected()) {
        try {
          await client.connect();
        } catch (connErr) {
          this.logger.warn({ err: connErr }, "HRU Monitor: Failed to connect to HRU");
          return;
        }
      }

      async function readRegister(reg: { address: number; kind: string }) {
        if (reg.kind === "input") {
          return client.readInput(reg.address, 1);
        }
        return client.readHolding(reg.address, 1);
      }

      // Read Power
      const powerVal = await readRegister(def.registers.read.power);
      const power = powerVal[0] ?? 0;

      // Read Mode
      const modeVal = await readRegister(def.registers.read.mode);
      const rawMode = modeVal[0] ?? 0;
      const modeStr = def.registers.read.mode.values[rawMode] ?? "Unknown";

      // Read Temperature
      const tempVal = await readRegister(def.registers.read.temperature);
      const rawTemp = tempVal[0] ?? 0;
      const scale = def.registers.read.temperature.scale ?? 1;
      const temperature = Number((rawTemp * scale).toFixed(1));

      this.logger.info(
        { power, temperature, mode: modeStr },
        "HRU Monitor: Read successful, publishing to MQTT",
      );

      // Always try to publish; MqttService will handle its internal state
      await this.mqttService.publishState({
        power,
        mode: modeStr,
        temperature,
      });
    } catch (err) {
      this.logger.warn({ err, settings }, "HRU Monitor: Failed to read from HRU");
      // We don't disconnect the shared client here, as other services might use it.
      // ModbusTcpClient handles its own health checks/reconnects if needed.
    }
  }
}
