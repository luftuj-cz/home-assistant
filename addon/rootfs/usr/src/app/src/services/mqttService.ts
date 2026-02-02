import mqtt from "mqtt";
import type { Logger } from "pino";
import type { AppConfig } from "../config/options";
import type { HruUnitDefinition } from "../features/hru/hru.definitions";
import { getAppSetting, setAppSetting } from "./database";
import { MQTT_SETTINGS_KEY, MQTT_LAST_DISCOVERY_KEY, type MqttSettings } from "../types";

const DISCOVERY_PREFIX = "homeassistant";
const BASE_TOPIC = "luftuj/hru";
const STATIC_CLIENT_ID = "luftuj-addon-static-client";
const DISCOVERY_INTERVAL_MS = 60_000;

import { EventEmitter } from "events";

export class MqttService extends EventEmitter {
  private client: mqtt.MqttClient | null = null;
  private connected = false;
  private lastSuccessAt = 0;

  private discoveryTimer: NodeJS.Timeout | null = null;
  private cachedDiscoveryUnit: HruUnitDefinition | null = null;

  constructor(
    private readonly envConfig: AppConfig["mqtt"],
    private readonly logger: Logger,
  ) {
    super();
  }

  public isConnected(): boolean {
    if (!this.client) return false;
    return this.connected || Date.now() - this.lastSuccessAt < 120_000;
  }

  public async connect(): Promise<void> {
    if (this.client) {
      this.logger.warn("MQTT: Connect called but client already exists. Ignoring.");
      return;
    }

    const config = this.resolveConfig();
    if (!config.host) {
      this.logger.info("MQTT: Host not configured, skipping start");
      return;
    }

    const brokerUrl = `mqtt://${config.host}:${config.port}`;
    this.logger.info(
      {
        brokerUrl,
        clientId: STATIC_CLIENT_ID,
        user: config.user,
      },
      "MQTT: Initializing service (v5)",
    );

    try {
      this.client = mqtt.connect(brokerUrl, {
        username: config.user ?? undefined,
        password: config.password ?? undefined,
        clientId: STATIC_CLIENT_ID,
        clean: true,
        keepalive: 60,
        protocolVersion: 5,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        properties: {
          sessionExpiryInterval: 120,
        },
      });

      this.setupEventListeners();
    } catch (err) {
      this.logger.error({ err }, "MQTT: Failed to initialize client");
      this.client = null;
    }
  }

  public async disconnect(): Promise<void> {
    this.stopDiscoveryLoop();

    if (this.client) {
      this.logger.info("MQTT: Disconnecting...");
      try {
        await this.client.endAsync(true);
      } catch (err) {
        this.logger.warn({ err }, "MQTT: Error during disconnect");
      }
      this.client = null;
      this.connected = false;
    }
  }

  public async publishDiscovery(unit: HruUnitDefinition): Promise<boolean> {
    this.cachedDiscoveryUnit = unit;
    this.ensureDiscoveryLoop();

    return true;
  }

  public async publishState(state: {
    power?: number;
    temperature?: number;
    mode?: string;
  }): Promise<void> {
    if (!this.client || !this.connected) return;

    const topic = `${BASE_TOPIC}/state`;
    const payload = JSON.stringify(state);

    try {
      await this.client.publishAsync(topic, payload, { qos: 1, retain: false });
      this.lastSuccessAt = Date.now();
      this.logger.debug({ topic }, "MQTT: State published");
    } catch (err) {
      this.logger.error({ err }, "MQTT: Failed to publish state");
    }
  }

  public async reloadConfig(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  public getLastDiscoveryTime(): string | null {
    return getAppSetting(MQTT_LAST_DISCOVERY_KEY);
  }

  public setLastDiscoveryTime(time: string): void {
    setAppSetting(MQTT_LAST_DISCOVERY_KEY, time);
  }

  public static async testConnection(
    settings: MqttSettings,
    logger: Logger,
  ): Promise<{ success: boolean; message?: string }> {
    const brokerUrl = `mqtt://${settings.host}:${settings.port}`;
    const clientId = `luftuj-test-${Math.random().toString(16).slice(2, 8)}`;

    logger.info({ brokerUrl, clientId }, "MQTT: Testing connection (v5)");

    return new Promise((resolve) => {
      const client = mqtt.connect(brokerUrl, {
        username: settings.user ?? undefined,
        password: settings.password ?? undefined,
        clientId,
        clean: true,
        protocolVersion: 5,
        connectTimeout: 5000,
        reconnectPeriod: 0,
        manualConnect: true,
      });

      let finished = false;
      function finish(ok: boolean, msg?: string) {
        if (finished) return;
        finished = true;
        client.end(true);
        resolve({ success: ok, message: msg });
      }

      client.on("connect", () => finish(true));
      client.on("error", (e) => finish(false, e.message));
      client.on("close", () => finish(false, "Connection closed"));

      try {
        client.connect();
      } catch (e: unknown) {
        finish(false, e instanceof Error ? e.message : "Unknown error");
      }

      setTimeout(() => finish(false, "Timeout"), 6000);
    });
  }

  private resolveConfig(): AppConfig["mqtt"] {
    const raw = getAppSetting(MQTT_SETTINGS_KEY);
    if (raw) {
      try {
        const dbSettings = JSON.parse(raw) as MqttSettings;
        if (dbSettings.enabled) {
          return {
            host: dbSettings.host,
            port: dbSettings.port,
            user: dbSettings.user ?? null,
            password: dbSettings.password ?? null,
          };
        }
        return { host: null, port: 1883, user: null, password: null };
      } catch {
        this.logger.error("MQTT: Failed to parse settings from database");
      }
    }
    return this.envConfig;
  }

  private setupEventListeners() {
    if (!this.client) return;

    this.client.on("connect", (connack) => {
      this.logger.info({ connack }, "MQTT: Connected");
      this.connected = true;
      this.lastSuccessAt = Date.now();
      this.emit("connect");
      void this.publishAvailability("online");
    });

    this.client.on("reconnect", () => {
      this.logger.info("MQTT: Attempting reconnect...");
    });

    this.client.on("error", (err) => {
      this.logger.error({ err }, "MQTT: Error");
      this.connected = false;
      this.emit("disconnect");
    });

    this.client.on("close", () => {
      if (this.connected) {
        this.logger.warn("MQTT: Connection closed");
      }
      this.connected = false;
      this.emit("disconnect");
    });

    this.client.on("offline", () => {
      this.logger.warn("MQTT: Client offline");
    });
  }

  private ensureDiscoveryLoop() {
    if (this.discoveryTimer) return;

    this.logger.info("MQTT: Starting discovery loop");

    this.discoveryTimer = setInterval(() => {
      void this.runDiscoveryCycle();
    }, DISCOVERY_INTERVAL_MS);

    void this.runDiscoveryCycle();
  }

  private stopDiscoveryLoop() {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
      this.logger.info("MQTT: Stopped discovery loop");
    }
  }

  private async runDiscoveryCycle() {
    if (!this.connected || !this.client || !this.cachedDiscoveryUnit) {
      return;
    }

    try {
      await this.internalSendDiscovery(this.cachedDiscoveryUnit);
      this.lastSuccessAt = Date.now();
    } catch (err) {
      this.logger.warn({ err }, "MQTT: Discovery cycle failed");
    }
  }

  private async internalSendDiscovery(unit: HruUnitDefinition) {
    if (!this.client) return;

    const device = {
      identifiers: [`luftuj_hru_${unit.id}`],
      name: `Luftuj HRU (${unit.name})`,
      model: unit.name,
      manufacturer: "Luftuj",
    };
    const availability = [{ topic: `${BASE_TOPIC}/status` }];

    const pub = async (field: string, name: string, cls: string, unitStr?: string) => {
      const payload = {
        name,
        unique_id: `luftuj_hru_${unit.id}_${field}`,
        state_topic: `${BASE_TOPIC}/state`,
        value_template: `{{ value_json.${field} }}`,
        device,
        availability,
        ...(cls ? { device_class: cls } : {}),
        ...(unitStr ? { unit_of_measurement: unitStr } : {}),
      };
      const topic = `${DISCOVERY_PREFIX}/sensor/luftuj_hru/${field}/config`;
      await this.client?.publishAsync(topic, JSON.stringify(payload), { qos: 1, retain: true });
    };

    await pub("power", "Requested Power", "power_factor", "%");
    await pub("temperature", "Requested Temperature", "temperature", "°C");

    const modePayload = {
      name: "Mode",
      unique_id: `luftuj_hru_${unit.id}_mode`,
      state_topic: `${BASE_TOPIC}/state`,
      value_template: "{{ value_json.mode }}",
      device,
      availability,
    };
    const modeTopic = `${DISCOVERY_PREFIX}/sensor/luftuj_hru/mode/config`;
    await this.client.publishAsync(modeTopic, JSON.stringify(modePayload), {
      qos: 1,
      retain: true,
    });

    this.logger.info("MQTT: Discovery payloads sent");
  }

  private async publishAvailability(status: "online" | "offline") {
    if (!this.client) return;
    try {
      await this.client.publishAsync(`${BASE_TOPIC}/status`, status, { qos: 1, retain: true });
    } catch {
      this.logger.warn("MQTT: Failed to publish availability");
    }
  }
}
