import mqtt from "mqtt";
import { EventEmitter } from "events";
import type { Logger } from "pino";
import type { AppConfig } from "../config/options";
import type { HeatRecoveryUnit } from "../features/hru/hru.definitions";
import { type MqttSettings, type TimelineOverride } from "../types";
import type { SettingsRepository } from "../features/settings/settings.repository";
import type { TimelineScheduler } from "./timelineScheduler";

const DISCOVERY_PREFIX = "homeassistant";
const BASE_TOPIC = "luftuj/hru";
const STATIC_CLIENT_ID = "luftuj-addon-static-client";
const DISCOVERY_INTERVAL_MS = 60_000;

const LOCALIZED_STRINGS: Record<
  string,
  {
    power: string;
    temperature: string;
    mode: string;
    native_mode: string;
    boost_duration: string;
    cancel_boost: string;
    boost_label: string;
    boost_remaining: string;
    boost_mode: string;
  }
> = {
  en: {
    power: "Requested Power",
    temperature: "Requested Temperature",
    mode: "Mode",
    native_mode: "Native Mode",
    boost_duration: "Boost Duration",
    cancel_boost: "Cancel Boost",
    boost_label: "Boost: {{name}}",
    boost_remaining: "Boost Time Remaining",
    boost_mode: "Active Boost",
  },
  cs: {
    power: "Požadovaný výkon",
    temperature: "Požadovaná teplota",
    mode: "Režim",
    native_mode: "Nativní režim",
    boost_duration: "Doba boostu",
    cancel_boost: "Zrušit boost",
    boost_label: "Boost: {{name}}",
    boost_remaining: "Zbývající čas boostu",
    boost_mode: "Aktivní boost",
  },
};

export class MqttService extends EventEmitter {
  private client: mqtt.MqttClient | null = null;
  private connected = false;
  private lastSuccessAt = 0;

  private discoveryTimer: NodeJS.Timeout | null = null;
  private cachedDiscoveryUnit: HeatRecoveryUnit | null = null;

  constructor(
    private readonly envConfig: AppConfig["mqtt"],
    private readonly settingsRepo: SettingsRepository,
    private readonly timelineScheduler: TimelineScheduler,
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

  public async publishDiscovery(unit: HeatRecoveryUnit): Promise<boolean> {
    this.cachedDiscoveryUnit = unit;
    this.ensureDiscoveryLoop();

    return true;
  }

  public async publishState(state: {
    power?: number;
    temperature?: number;
    mode_formatted?: string;
    native_mode_formatted?: string;
    boost_remaining?: number;
    boost_name?: string;
  }): Promise<void> {
    if (!this.client || !this.connected || !this.cachedDiscoveryUnit) return;

    const unitId = this.slugify(this.cachedDiscoveryUnit.code || this.cachedDiscoveryUnit.name);
    const topic = `${BASE_TOPIC}/${unitId}/state`;
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
    return this.settingsRepo.getLastDiscoveryTime();
  }

  public setLastDiscoveryTime(time: string): void {
    this.settingsRepo.setLastDiscoveryTime(time);
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
    const dbSettings = this.settingsRepo.getMqttSettings();
    if (dbSettings) {
      if (dbSettings.enabled) {
        return {
          host: dbSettings.host,
          port: dbSettings.port,
          user: dbSettings.user ?? null,
          password: dbSettings.password ?? null,
        };
      }
      return { host: null, port: 1883, user: null, password: null };
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

      if (this.cachedDiscoveryUnit) {
        const unitId = this.slugify(this.cachedDiscoveryUnit.code || this.cachedDiscoveryUnit.name);
        void this.publishAvailability(unitId, "online");
        void this.subscribeToCommands(unitId);
      }
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

      if (this.cachedDiscoveryUnit) {
        const unitId = this.slugify(this.cachedDiscoveryUnit.code || this.cachedDiscoveryUnit.name);
        void this.publishAvailability(unitId, "offline");
      }
    });

    this.client.on("offline", () => {
      this.logger.warn("MQTT: Client offline");
    });

    this.client.on("message", (topic, message) => {
      this.handleIncomingMessage(topic, message.toString());
    });
  }

  private async subscribeToCommands(unitId: string) {
    if (!this.client) return;
    const unitBaseTopic = `${BASE_TOPIC}/${unitId}`;
    try {
      await this.client.subscribeAsync(`${unitBaseTopic}/boost_duration/set`);
      await this.client.subscribeAsync(`${unitBaseTopic}/boost/cancel`);
      await this.client.subscribeAsync(`${unitBaseTopic}/boost/+/start`);
      this.logger.debug({ unitId }, "MQTT: Subscribed to unit commands");
    } catch (err) {
      this.logger.warn({ err, unitId }, "MQTT: Failed to subscribe to commands");
    }
  }

  private async handleIncomingMessage(topic: string, payload: string) {
    if (!this.cachedDiscoveryUnit) return;
    const unitId = this.slugify(this.cachedDiscoveryUnit.code || this.cachedDiscoveryUnit.name);
    const unitBaseTopic = `${BASE_TOPIC}/${unitId}`;

    // 1. Duration Set
    if (topic === `${unitBaseTopic}/boost_duration/set`) {
      const duration = parseInt(payload, 10);
      if (!isNaN(duration)) {
        this.settingsRepo.setBoostDuration(duration);
        await this.client?.publishAsync(`${unitBaseTopic}/boost_duration/state`, String(duration), {
          qos: 1,
          retain: true,
        });
        this.logger.info({ duration }, "MQTT: Boost duration updated");
      }
    }

    // 2. Cancel Boost
    if (topic === `${unitBaseTopic}/boost/cancel` && payload === "CANCEL") {
      this.settingsRepo.setTimelineOverride(null);
      await this.timelineScheduler.executeScheduledEvent();
      this.emit("command-received");
      this.logger.info("MQTT: Boost cancelled");
    }

    // 3. Start Boost
    const startBoostMatch = topic.match(new RegExp(`${unitBaseTopic}/boost/(\\d+)/start`));
    if (startBoostMatch && payload === "START") {
      const modeIdStr = startBoostMatch[1];
      if (!modeIdStr) return;

      const modeId = parseInt(modeIdStr, 10);
      const duration = this.settingsRepo.getBoostDuration();
      const endTime = new Date(Date.now() + duration * 60 * 1000).toISOString();
      const override: TimelineOverride = { modeId, endTime, durationMinutes: duration };

      this.settingsRepo.setTimelineOverride(override);
      this.logger.info({ modeId, duration, endTime }, "MQTT: Boost activated");

      await this.timelineScheduler.executeScheduledEvent();
      this.emit("command-received");
    }
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/(^_|_$)/g, "");
  }

  private ensureDiscoveryLoop() {
    if (this.discoveryTimer) return;

    this.logger.info("MQTT: Starting discovery loop");

    this.discoveryTimer = setInterval(() => {
      void this.runDiscoveryCycle();
    }, DISCOVERY_INTERVAL_MS);
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

  private async internalSendDiscovery(unit: HeatRecoveryUnit) {
    if (!this.client) return;

    const unitId = this.slugify(unit.code || unit.name);
    const device = {
      identifiers: [`luftuj_hru_${unitId}`],
      name: `Luftuj (${unit.name})`,
      manufacturer: "Luftuj s.r.o.",
      model: unit.code || "HRU",
    };

    const unitBaseTopic = `${BASE_TOPIC}/${unitId}`;
    await this.client.subscribeAsync(`${unitBaseTopic}/boost_duration/set`);
    await this.client.subscribeAsync(`${unitBaseTopic}/boost/cancel`);
    await this.client.subscribeAsync(`${unitBaseTopic}/boost/+/start`);

    const availability = [{ topic: `${unitBaseTopic}/status` }];

    const strings = LOCALIZED_STRINGS[this.settingsRepo.getLanguage()] || LOCALIZED_STRINGS.en;

    if (!strings) {
      this.logger.error("MQTT: Failed to load localization strings for discovery");
      return;
    }

    // --- 1. Sensors & Configuration ---

    // Shared sensor helper
    const publishSensor = async (
      id: string,
      name: string,
      template: string,
      icon?: string,
      unit_of_measure?: string,
      device_class?: string,
    ) => {
      const payload = {
        name,
        unique_id: `luftuj_hru_${unitId}_${id}`,
        state_topic: `${unitBaseTopic}/state`,
        value_template: template,
        device,
        availability,
        ...(icon ? { icon } : {}),
        ...(unit_of_measure ? { unit_of_measurement: unit_of_measure } : {}),
        ...(device_class ? { device_class } : {}),
      };
      await this.client!.publishAsync(
        `${DISCOVERY_PREFIX}/sensor/luftuj_hru_${unitId}/${id}/config`,
        JSON.stringify(payload),
        { qos: 1, retain: true },
      );
    };

    const powerUnit = unit.controlUnit || "%";
    const powerCls = powerUnit === "%" ? "power_factor" : null;

    await publishSensor(
      "power",
      strings.power,
      "{{ value_json.power }}",
      "mdi:fan",
      powerUnit,
      powerCls || undefined,
    );
    await publishSensor(
      "temperature",
      strings.temperature,
      "{{ value_json.temperature }}",
      "mdi:thermometer",
      "°C",
      "temperature",
    );
    await publishSensor("mode", strings.mode, "{{ value_json.mode_formatted }}", "mdi:fan");
    await publishSensor(
      "native_mode",
      strings.native_mode,
      "{{ value_json.native_mode_formatted }}",
      "mdi:cog",
    );
    await publishSensor(
      "boost_remaining",
      strings.boost_remaining,
      "{{ value_json.boost_remaining }}",
      "mdi:timer-sand",
      "min",
    );
    await publishSensor(
      "boost_mode",
      strings.boost_mode,
      "{{ value_json.boost_name }}",
      "mdi:rocket",
    );

    // Boost Duration Number Control
    const durationPayload = {
      name: strings.boost_duration,
      unique_id: `luftuj_hru_${unitId}_boost_duration`,
      state_topic: `${unitBaseTopic}/boost_duration/state`,
      command_topic: `${unitBaseTopic}/boost_duration/set`,
      min: 5,
      max: 240,
      step: 5,
      unit_of_measurement: "min",
      icon: "mdi:clock-fast",
      device,
      availability,
    };
    await this.client.publishAsync(
      `${DISCOVERY_PREFIX}/number/luftuj_hru_${unitId}/boost_duration/config`,
      JSON.stringify(durationPayload),
      { qos: 1, retain: true },
    );

    // Initial publish of boost duration
    const currentDuration = this.settingsRepo.getBoostDuration();
    await this.client.publishAsync(
      `${unitBaseTopic}/boost_duration/state`,
      String(currentDuration),
      { qos: 1, retain: true },
    );

    // Cancel Boost Button
    const cancelPayload = {
      name: strings.cancel_boost,
      unique_id: `luftuj_hru_${unitId}_cancel_boost`,
      command_topic: `${unitBaseTopic}/boost/cancel`,
      payload_press: "CANCEL",
      icon: "mdi:stop-circle-outline",
      device,
      availability,
    };
    await this.client.publishAsync(
      `${DISCOVERY_PREFIX}/button/luftuj_hru_${unitId}/cancel_boost/config`,
      JSON.stringify(cancelPayload),
      { qos: 1, retain: true },
    );

    // --- 2. Boost Controls Lifecycle ---

    // Tracking for Unit ID changes
    const lastUnitId = this.settingsRepo.getLastUnitId();
    if (lastUnitId && lastUnitId !== unitId) {
      this.logger.warn(
        { lastUnitId, newUnitId: unitId },
        "MQTT: Unit ID changed, old discovery entities might be orphaned",
      );
    }
    this.settingsRepo.setLastUnitId(unitId);

    // ID-to-Slug mapping for reliable cleanup
    const prevBoostMap = this.settingsRepo.getDiscoveredBoosts();
    const currentBoostMap: Record<number, string> = {};

    const modes = this.settingsRepo.getTimelineModes();
    let activeBoostCount = 0;

    // Process ALL modes: register boosts, explicitly delete non-boosts
    for (const m of modes) {
      const slug = this.slugify(m.name);

      if (m.isBoost) {
        currentBoostMap[m.id] = slug;
        activeBoostCount++;

        // Delete old slug topic if renamed
        if (prevBoostMap[m.id] && prevBoostMap[m.id] !== slug) {
          const oldSlug = prevBoostMap[m.id];
          await this.client.publishAsync(
            `${DISCOVERY_PREFIX}/button/luftuj_hru_${unitId}/boost_${oldSlug}/config`,
            "",
            { qos: 1, retain: true },
          );
        }

        const boostBtnPayload = {
          name: strings.boost_label.replace("{{name}}", m.name),
          unique_id: `luftuj_hru_${unitId}_boost_${m.id}`,
          command_topic: `${unitBaseTopic}/boost/${m.id}/start`,
          payload_press: "START",
          icon: "mdi:rocket-launch",
          device,
          availability,
        };
        await this.client.publishAsync(
          `${DISCOVERY_PREFIX}/button/luftuj_hru_${unitId}/boost_${slug}/config`,
          JSON.stringify(boostBtnPayload),
          { qos: 1, retain: true },
        );
      } else {
        // Mode exists but 'isBoost' is false - EXPLICITLY ensure no discovery button remains
        await this.client.publishAsync(
          `${DISCOVERY_PREFIX}/button/luftuj_hru_${unitId}/boost_${slug}/config`,
          "",
          { qos: 1, retain: true },
        );
      }
    }

    // Cleanup modes that were deleted from the DB entirely
    for (const modeIdStr of Object.keys(prevBoostMap)) {
      const modeId = parseInt(modeIdStr, 10);
      if (!currentBoostMap[modeId] && !modes.find((m) => m.id === modeId)) {
        const oldSlug = prevBoostMap[modeId];
        await this.client.publishAsync(
          `${DISCOVERY_PREFIX}/button/luftuj_hru_${unitId}/boost_${oldSlug}/config`,
          "",
          { qos: 1, retain: true },
        );
      }
    }

    // Finalize
    this.settingsRepo.setDiscoveredBoosts(currentBoostMap);
    await this.publishAvailability(unitId, "online");
    this.logger.info({ unitId, boostCount: activeBoostCount }, "MQTT: Discovery cycle complete");
  }

  private async publishAvailability(unitId: string, status: "online" | "offline") {
    if (!this.client) return;
    try {
      await this.client.publishAsync(`${BASE_TOPIC}/${unitId}/status`, status, {
        qos: 1,
        retain: true,
      });
    } catch {
      this.logger.warn({ unitId }, "MQTT: Failed to publish availability");
    }
  }
}
