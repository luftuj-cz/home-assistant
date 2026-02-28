import mqtt from "mqtt";
import { EventEmitter } from "events";
import type { Logger } from "pino";
import type { AppConfig } from "../config/options";
import type { HeatRecoveryUnit, LocalizedText } from "../features/hru/hru.definitions";
import type { MqttSettings, TimelineOverride } from "../types";
import { LANGUAGE_SETTING_KEY } from "../types";
import { getAppSetting } from "./database";
import type { SettingsRepository } from "../features/settings/settings.repository";
import type { TimelineScheduler } from "./timelineScheduler";

const DISCOVERY_PREFIX = "homeassistant";
const BASE_TOPIC = "luftuj/hru";
const STATIC_CLIENT_ID_PREFIX = "luftuj-addon-client";
const PUBLISH_DELAY_MS = 30;

type LocalizedStrings = {
  power: string;
  temperature: string;
  mode: string;
  native_mode: string;
  boost_duration: string;
  cancel_boost: string;
  boost_label: string;
  boost_remaining: string;
  boost_mode: string;
  level_unit: string;
};

const LOCALIZED_STRINGS: Record<string, LocalizedStrings> = {
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
    level_unit: "level",
  },
  cs: {
    power: "Požadovaný výkon",
    temperature: "Požadovaná teplota",
    mode: "Režim",
    native_mode: "Režim rekuperační jednotky",
    boost_duration: "Doba manuálního režimu",
    cancel_boost: "Zrušit manuální režim",
    boost_label: "Manuální režim: {{name}}",
    boost_remaining: "Zbývající čas manuálního režimu",
    boost_mode: "Aktivní manuální režim",
    level_unit: "stupeň",
  },
};

const MODE_LABELS: Record<string, Record<string, string>> = {
  en: {
    "hru.modes.off": "Off",
    "hru.modes.ventilation": "Ventilation",
    "hru.modes.circulationWithVentilation": "Circulation with ventilation",
    "hru.modes.circulation": "Circulation",
    "hru.modes.bypass": "Bypass",
    "hru.modes.disbalance": "Disbalance",
    "hru.modes.overpressure": "Overpressure",
  },
  cs: {
    "hru.modes.off": "Vypnuto",
    "hru.modes.ventilation": "Větrání",
    "hru.modes.circulationWithVentilation": "Cirkulace s větráním",
    "hru.modes.circulation": "Cirkulace",
    "hru.modes.bypass": "Bypass",
    "hru.modes.disbalance": "Disbalance",
    "hru.modes.overpressure": "Přetlak",
  },
};

export class MqttService extends EventEmitter {
  private client: mqtt.MqttClient | null = null;
  private connected = false;
  private isProcessingSequence = false;
  private isProcessingDiscovery = false;
  private lastSuccessAt = 0;
  private publishQueue: Promise<void> = Promise.resolve();

  private cachedDiscoveryUnit: HeatRecoveryUnit | null = null;
  private messageQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly envConfig: AppConfig["mqtt"],
    private readonly settingsRepo: SettingsRepository,
    private readonly timelineScheduler: TimelineScheduler,
    private readonly logger: Logger,
  ) {
    super();
  }

  public isConnected(): boolean {
    return !!this.client && this.connected;
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
    const savedUnitIdForId = this.settingsRepo.getLastUnitId();
    const instanceId = savedUnitIdForId
      ? String(savedUnitIdForId)
      : Math.random().toString(16).slice(2, 6);
    const clientId = `${STATIC_CLIENT_ID_PREFIX}-${instanceId}`;

    this.logger.info(
      {
        brokerUrl,
        clientId,
        user: config.user,
      },
      "MQTT: Initializing service (v5)",
    );

    try {
      // Use explicit host/port instead of URL to ensure family option is applied
      // URL-based connections may not properly forward socket options
      // Attempt to provide a more stable session with LWT and shorter keepalive
      const lastUnitId = savedUnitIdForId;
      const will = lastUnitId
        ? {
            topic: `${BASE_TOPIC}/${lastUnitId}/status`,
            payload: "offline",
            qos: 1,
            retain: true,
          }
        : undefined;

      this.client = mqtt.connect({
        host: config.host,
        port: config.port,
        protocol: "mqtt",
        username: config.user ?? undefined,
        password: config.password ?? undefined,
        clientId,
        clean: false,
        keepalive: 60,
        protocolVersion: 5,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        will,
        family: 4,
      } as mqtt.IClientOptions & { family?: 4 | 6 });

      this.setupEventListeners();
      this.logger.info("MQTT: Client initialized successfully");
    } catch (err) {
      this.logger.error({ err }, "MQTT: Failed to initialize client");
      this.client = null;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      this.logger.info("MQTT: Disconnecting...");
      try {
        await this.client.endAsync(true);
        this.logger.info("MQTT: Disconnected successfully");
      } catch (err) {
        this.logger.error({ err }, "MQTT: Error during disconnect");
      }
      this.client = null;
      this.connected = false;
    }
  }

  public async publishDiscovery(unit: HeatRecoveryUnit): Promise<boolean> {
    this.logger.info(
      { unitCode: unit.code, unitName: unit.name, connected: this.connected },
      "MQTT: publishDiscovery called",
    );

    const oldUnitId = this.cachedDiscoveryUnit
      ? this.slugify(this.cachedDiscoveryUnit.code || this.cachedDiscoveryUnit.name)
      : null;

    this.cachedDiscoveryUnit = unit;

    if (this.connected) {
      const newUnitId = this.slugify(unit.code || unit.name);

      if (oldUnitId && oldUnitId !== newUnitId) {
        this.logger.info(
          { oldUnitId, newUnitId },
          "MQTT: Unit changed, updating command subscriptions",
        );
        await this.unsubscribeFromCommands(oldUnitId);
        await this.subscribeToCommands(newUnitId);
      }

      await this.runDiscoveryCycle();
      this.logger.info({ unitId: newUnitId }, "MQTT: Discovery published successfully");
    } else {
      this.logger.info("MQTT: Not connected, discovery cached for later");
    }

    return true;
  }

  private async unsubscribeFromCommands(unitId: string) {
    if (!this.client) return;
    const unitBaseTopic = `${BASE_TOPIC}/${unitId}`;
    try {
      await this.client.unsubscribeAsync(`${unitBaseTopic}/boost_duration/set`);
      await this.client.unsubscribeAsync(`${unitBaseTopic}/boost/cancel`);
      await this.client.unsubscribeAsync(`${unitBaseTopic}/boost/+/start`);
      await this.client.unsubscribeAsync(`${unitBaseTopic}/boost/+/start_infinite`);
      this.logger.info({ unitId }, "MQTT: Unsubscribed from old unit commands successfully");
    } catch (err) {
      this.logger.error({ err, unitId }, "MQTT: Failed to unsubscribe from commands");
    }
  }

  /**
   * Manually trigger a discovery refresh (e.g. after mode changes)
   */
  public async refreshDiscovery() {
    this.logger.info("MQTT: Manual discovery refresh triggered");
    try {
      await this.runDiscoveryCycle();
      this.logger.info("MQTT: Manual discovery refresh successful");
    } catch (err) {
      this.logger.error({ err }, "MQTT: Manual discovery refresh failed");
    }
  }

  public async publishState(state: {
    power?: number;
    temperature?: number;
    mode_formatted?: string;
    native_mode_formatted?: string;
    boost_remaining?: number;
    boost_name?: string;
  }): Promise<void> {
    if (!this.client) {
      this.logger.warn("MQTT: Cannot publish state - client not initialized");
      return;
    }
    if (!this.connected) {
      this.logger.warn("MQTT: Cannot publish state - not connected, waiting for reconnect...");
      return;
    }
    if (!this.cachedDiscoveryUnit) {
      this.logger.warn("MQTT: Cannot publish state - no discovery unit cached");
      return;
    }

    const unit = this.cachedDiscoveryUnit;
    const unitId = this.slugify(unit.code || unit.name);
    const topic = `${BASE_TOPIC}/${unitId}/state`;

    const modeVar = unit.variables.find((v) => v.class === "mode" || v.name === "mode");
    const modeOptions = modeVar?.options ?? [];

    const langRaw = getAppSetting(LANGUAGE_SETTING_KEY);
    const lang = typeof langRaw === "string" && langRaw ? (langRaw.split("-")[0] ?? "en") : "en";
    const modeStrings = MODE_LABELS[lang] ?? MODE_LABELS.en!;

    function resolveModeLabel(val?: string | number) {
      if (val === undefined || val === null) return undefined;
      const numeric = typeof val === "number" ? val : Number(val);
      const match = modeOptions.find((o) => o.value === numeric);
      if (match) {
        const label = match.label;
        const key = typeof label === "string" ? label : label?.text;
        if (key && modeStrings[key]) return modeStrings[key];
        if (key) return key;
      }
      if (typeof val === "string") return modeStrings[val] ?? val;
      return String(val);
    }

    const payload = JSON.stringify({
      ...state,
      mode_formatted: resolveModeLabel(state.mode_formatted) ?? state.mode_formatted,
      native_mode_formatted:
        resolveModeLabel(state.native_mode_formatted) ?? state.native_mode_formatted,
    });

    try {
      await this.client.publishAsync(topic, payload, { qos: 2, retain: true });
      this.lastSuccessAt = Date.now();
      this.logger.debug({ topic, state }, "MQTT: State published successfully");
    } catch (err) {
      this.logger.error({ err }, "MQTT: Failed to publish state");
    }
  }

  private async throttledPublish(
    topic: string,
    payload: string | Buffer,
    options?: mqtt.IClientPublishOptions,
  ): Promise<void> {
    if (!this.client || !this.connected) {
      this.logger.warn({ topic }, "MQTT: Skipping publish - not connected");
      return;
    }

    this.publishQueue = this.publishQueue.then(async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, PUBLISH_DELAY_MS));
        if (!this.client || !this.connected) {
          this.logger.warn({ topic }, "MQTT: Publish cancelled - connection lost mid-queue");
          return;
        }
        await this.client.publishAsync(topic, payload, options);
        this.lastSuccessAt = Date.now();
      } catch (err) {
        this.logger.error({ err, topic }, "MQTT: Failed to publish (throttled)");
        throw err;
      }
    });

    await this.publishQueue;
  }

  public async reloadConfig(): Promise<void> {
    this.logger.info("MQTT: reloadConfig() called, reconnecting...");
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
    const clientId = `luftuj-test-${Math.random().toString(16).slice(2, 8)}`;

    logger.info(
      { host: settings.host, port: settings.port, clientId },
      "MQTT: Testing connection (v5)",
    );

    return new Promise((resolve) => {
      const client = mqtt.connect({
        host: settings.host,
        port: settings.port,
        protocol: "mqtt",
        username: settings.user ?? undefined,
        password: settings.password ?? undefined,
        clientId,
        clean: true,
        protocolVersion: 5,
        connectTimeout: 5000,
        reconnectPeriod: 0,
        family: 4,
      } as mqtt.IClientOptions & { family?: 4 | 6 });

      let finished = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let errorMessage: string | undefined;

      function finish(ok: boolean, msg?: string) {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        client.end(true);
        resolve({ success: ok, message: msg });
      }

      client.on("connect", () => finish(true));

      client.on("error", (e) => {
        errorMessage = e.message;
      });

      client.on("close", () => {
        if (!finished) {
          finish(false, errorMessage || "Connection closed");
        }
      });

      timer = setTimeout(() => {
        if (!finished) {
          finish(false, errorMessage || "Connection timeout");
        }
      }, 6000);
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
      this.logger.info({ connack, clientId: this.client?.options?.clientId }, "MQTT: Connected");
      this.connected = true;
      this.lastSuccessAt = Date.now();

      // Sequence all operations to prevent flooding the broker
      // The broker has receiveMaximum limit (e.g., 20) that can be exceeded
      // if we fire all operations in parallel
      void this.handleConnectSequence();
    });

    // Register remaining event handlers
    this.setupEventListenersContinued();
  }

  private async handleConnectSequence(): Promise<void> {
    if (this.isProcessingSequence) {
      this.logger.debug("MQTT: Connect sequence already in progress, skipping");
      return;
    }
    this.isProcessingSequence = true;

    this.logger.info(
      { cachedUnit: !!this.cachedDiscoveryUnit, connected: this.connected },
      "MQTT: handleConnectSequence starting",
    );

    try {
      if (!this.cachedDiscoveryUnit) {
        this.logger.info("MQTT: No cached unit, emitting connect for HruMonitor to populate");
        this.emit("connect");
        return;
      }

      const unitId = this.slugify(this.cachedDiscoveryUnit.code || this.cachedDiscoveryUnit.name);

      try {
        this.logger.info({ unitId }, "MQTT: Step 1 - Subscribing to commands");
        await this.subscribeToCommands(unitId);

        this.logger.info({ unitId }, "MQTT: Step 2 - Publishing availability");
        await this.publishAvailability(unitId, "online");

        this.logger.info({ unitId }, "MQTT: Step 3 - Waiting 100ms");
        await new Promise((resolve) => setTimeout(resolve, 100));

        this.logger.info({ unitId }, "MQTT: Step 4 - Running discovery cycle");
        await this.runDiscoveryCycle();

        this.logger.info({ unitId }, "MQTT: Step 5 - Emitting connect event");
        this.emit("connect");
        this.logger.info({ unitId }, "MQTT: Connect sequence completed successfully");
      } catch (err) {
        this.logger.error({ err }, "MQTT: Connect sequence failed");
        this.emit("connect");
      }
    } finally {
      this.isProcessingSequence = false;
    }
  }

  private setupEventListenersContinued() {
    if (!this.client) return;

    this.client.on("reconnect", () => {
      this.logger.info("MQTT: Attempting reconnect...");
    });

    this.client.on("error", (err) => {
      this.logger.error(
        { err, code: err?.name, message: err?.message },
        "MQTT: Error event received",
      );
      this.connected = false;
      this.emit("disconnect");
    });

    this.client.on("close", () => {
      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected) {
        this.logger.warn(
          {
            lastSuccessAt: this.lastSuccessAt,
            secondsSinceSuccess: Math.round((Date.now() - this.lastSuccessAt) / 1000),
          },
          "MQTT: Connection closed unexpectedly",
        );
      }
      this.emit("disconnect");
    });

    this.client.on("offline", () => {
      this.logger.warn("MQTT: Client offline event received");
    });

    this.client.on("disconnect", (packet) => {
      this.logger.warn(
        { reasonCode: packet?.reasonCode, properties: packet?.properties },
        "MQTT: Disconnect packet received from broker",
      );
    });

    this.client.on("message", (topic, message) => {
      // Sequence message processing to prevent race conditions
      this.messageQueue = this.messageQueue
        .then(async () => {
          await this.handleIncomingMessage(topic, message.toString());
        })
        .catch((err) => {
          this.logger.error({ err }, "MQTT: Message processing error");
        });
    });
  }

  private async subscribeToCommands(unitId: string) {
    if (!this.client) return;
    const unitBaseTopic = `${BASE_TOPIC}/${unitId}`;
    try {
      await this.client.subscribeAsync(`${unitBaseTopic}/boost_duration/set`);
      await this.client.subscribeAsync(`${unitBaseTopic}/boost/cancel`);
      await this.client.subscribeAsync(`${unitBaseTopic}/boost/+/start`);
      await this.client.subscribeAsync(`${unitBaseTopic}/boost/+/start_infinite`);
      this.logger.info({ unitId }, "MQTT: Subscribed to unit commands successfully");
    } catch (err) {
      this.logger.error({ err, unitId }, "MQTT: Failed to subscribe to commands");
    }
  }

  private async handleIncomingMessage(topic: string, rawPayload: string) {
    try {
      if (!this.cachedDiscoveryUnit) {
        this.logger.warn({ topic }, "MQTT: Received message but no discovery unit cached");
        return;
      }

      const payload = rawPayload.trim();
      const unitId = this.slugify(this.cachedDiscoveryUnit.code || this.cachedDiscoveryUnit.name);
      const unitBaseTopic = `${BASE_TOPIC}/${unitId}`;

      this.logger.info({ topic, payload, unitBaseTopic }, "MQTT: Incoming message processing");

      // 1. Duration Set
      if (topic === `${unitBaseTopic}/boost_duration/set`) {
        const duration = parseInt(payload, 10);
        // Validate payload (5-480)
        if (!isNaN(duration) && duration >= 5 && duration <= 480) {
          this.logger.info({ duration }, "MQTT: Execute Boost Duration Set");
          this.settingsRepo.setBoostDuration(duration);
          await this.client?.publishAsync(
            `${unitBaseTopic}/boost_duration/state`,
            String(duration),
            {
              qos: 1,
              retain: true,
            },
          );
          this.logger.info({ duration }, "MQTT: Boost duration updated successfully");
        } else {
          this.logger.warn({ payload }, "MQTT: Invalid duration received (must be 5-480)");
        }
      }

      // 2. Cancel Boost
      if (topic === `${unitBaseTopic}/boost/cancel` && payload === "CANCEL") {
        this.logger.info("MQTT: Execute Boost Cancel");
        this.settingsRepo.setTimelineOverride(null);
        await this.timelineScheduler.executeScheduledEvent();
        this.emit("command-received");
        this.logger.info("MQTT: Boost cancelled successfully");
      }

      // 3. Start Boost
      const startBoostMatch = topic.match(
        new RegExp(`^${this.escapeRegExp(unitBaseTopic)}/boost/(\\d+)/start$`),
      );
      if (startBoostMatch && payload === "START") {
        const modeIdStr = startBoostMatch[1];
        if (!modeIdStr) {
          this.logger.warn("MQTT: Boost start matched but no ID found");
          return;
        }

        const modeId = parseInt(modeIdStr, 10);
        const duration = this.settingsRepo.getBoostDuration();

        const durationMinutes = duration;
        const endTime = new Date(Date.now() + duration * 60 * 1000).toISOString();

        const override: TimelineOverride = { modeId, endTime, durationMinutes };

        this.logger.info({ modeId, duration, override }, "MQTT: Execute Boost Start");

        this.settingsRepo.setTimelineOverride(override);
        await this.timelineScheduler.executeScheduledEvent();
        this.emit("command-received");

        this.logger.info("MQTT: Boost activated successfully");
      }

      // 4. Start Infinite Boost
      const startInfiniteBoostMatch = topic.match(
        new RegExp(`^${this.escapeRegExp(unitBaseTopic)}/boost/(\\d+)/start_infinite$`),
      );
      if (startInfiniteBoostMatch && payload === "START") {
        const modeIdStr = startInfiniteBoostMatch[1];
        if (!modeIdStr) {
          this.logger.warn("MQTT: Infinite Boost start matched but no ID found");
          return;
        }

        const modeId = parseInt(modeIdStr, 10);
        const durationMinutes = 999999;
        const endTime = new Date("9999-12-31T23:59:59.999Z").toISOString();

        const override: TimelineOverride = { modeId, endTime, durationMinutes };

        this.logger.info({ modeId, override }, "MQTT: Execute Infinite Boost Start");

        this.settingsRepo.setTimelineOverride(override);
        await this.timelineScheduler.executeScheduledEvent();
        this.emit("command-received");

        this.logger.info("MQTT: Infinite Boost activated successfully");
      }
    } catch (err) {
      this.logger.error({ err, topic }, "MQTT: Error handling incoming message");
    }
  }

  private slugify(text: string): string {
    return text
      .normalize("NFD") // Split accented chars
      .replace(/[\u0300-\u036f]/g, "") // Remove accents
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/(^_|_$)/g, ""); // Remove leading/trailing underscores
  }

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private async runDiscoveryCycle() {
    this.logger.info(
      { connected: this.connected, hasClient: !!this.client, hasUnit: !!this.cachedDiscoveryUnit },
      "MQTT: runDiscoveryCycle called",
    );

    if (!this.connected) {
      this.logger.warn("MQTT: runDiscoveryCycle skipped - not connected");
      return;
    }
    if (!this.client) {
      this.logger.warn("MQTT: runDiscoveryCycle skipped - no client");
      return;
    }
    if (!this.cachedDiscoveryUnit) {
      this.logger.warn("MQTT: runDiscoveryCycle skipped - no cached unit");
      return;
    }

    if (this.isProcessingDiscovery) {
      this.logger.debug("MQTT: Discovery already in progress, skipping");
      return;
    }
    this.isProcessingDiscovery = true;

    this.logger.info("MQTT: Starting discovery cycle...");

    try {
      await this.internalSendDiscovery(this.cachedDiscoveryUnit);
      this.lastSuccessAt = Date.now();
      this.logger.info("MQTT: Discovery cycle completed successfully");
    } catch (err) {
      this.logger.error({ err }, "MQTT: Discovery cycle failed");
    } finally {
      this.isProcessingDiscovery = false;
    }
  }

  private async internalSendDiscovery(unit: HeatRecoveryUnit) {
    if (!this.client || !this.connected) {
      this.logger.warn("MQTT: internalSendDiscovery called but not connected, skipping");
      return;
    }

    this.logger.info(
      { unitCode: unit.code, unitName: unit.name },
      "MQTT: internalSendDiscovery starting",
    );

    const stableId = this.slugify(unit.code || "default_hru");
    const unitId = this.slugify(unit.code || unit.name);

    const device = {
      identifiers: [`luftuj_hru_device_${stableId}`],
      name: `LUFTaTOR (${unit.name})`,
      manufacturer: "Luftuj s.r.o.",
      model: unit.code || "HRU",
    };

    const unitBaseTopic = `${BASE_TOPIC}/${unitId}`;
    const availability = [
      {
        topic: `${unitBaseTopic}/status`,
        payload_available: "online",
        payload_not_available: "offline",
      },
    ];

    const strings: LocalizedStrings =
      LOCALIZED_STRINGS[this.settingsRepo.getLanguage()] ?? LOCALIZED_STRINGS.en!;

    let entityCount = 0;
    this.logger.info({ unitId }, "MQTT: Starting discovery publishing...");

    // Dynamic variables
    for (const variable of unit.variables) {
      const label = this.getLocalizedText(variable.label);
      const unitOfMeasure = variable.unit ? this.getLocalizedText(variable.unit) : undefined;

      let deviceClass = undefined;
      let icon = "mdi:eye";

      if (variable.class === "temperature") {
        deviceClass = "temperature";
        icon = "mdi:thermometer";
      } else if (variable.class === "power") {
        if (unitOfMeasure === "%") deviceClass = "power_factor";
        icon = "mdi:fan";
      } else if (variable.class === "mode") {
        icon = "mdi:cog";
      }

      await this.publishSensor(
        unitId,
        variable.name,
        label,
        `{{ value_json.${variable.name} }}`,
        device,
        availability,
        icon,
        unitOfMeasure,
        deviceClass,
      );
      entityCount++;
      this.logger.debug(
        { unitId, sensor: variable.name },
        "MQTT: Published dynamic sensor discovery",
      );
    }

    // Standard sensors (computed)
    await this.publishSensor(
      unitId,
      "mode_standard",
      strings.mode,
      "{{ value_json.mode_formatted }}",
      device,
      availability,
      "mdi:fan",
    );
    entityCount++;

    await this.publishSensor(
      unitId,
      "boost_remaining",
      strings.boost_remaining,
      "{{ value_json.boost_remaining }}",
      device,
      availability,
      "mdi:timer-sand",
      "min",
    );
    entityCount++;

    await this.publishSensor(
      unitId,
      "boost_mode",
      strings.boost_mode,
      "{{ value_json.boost_name }}",
      device,
      availability,
      "mdi:rocket",
    );
    entityCount++;

    // Boost Duration Number Control
    await this.publishNumber(
      unitId,
      "boost_duration",
      strings.boost_duration,
      `${unitBaseTopic}/boost_duration/state`,
      `${unitBaseTopic}/boost_duration/set`,
      device,
      availability,
      5,
      480,
      5,
      "min",
      "mdi:clock-fast",
    );
    entityCount++;

    const currentDuration = this.settingsRepo.getBoostDuration();
    await this.throttledPublish(`${unitBaseTopic}/boost_duration/state`, String(currentDuration), {
      qos: 1,
      retain: true,
    });

    // Cancel Boost Button
    await this.publishButton(
      unitId,
      "cancel_boost",
      strings.cancel_boost,
      `${unitBaseTopic}/boost/cancel`,
      "CANCEL",
      device,
      availability,
      "mdi:stop-circle-outline",
    );
    entityCount++;

    const boostCount = await this.updateBoostDiscovery(unitId, unit, strings, device, availability);
    entityCount += boostCount;

    await this.publishAvailability(unitId, "online");
    this.logger.info({ unitId, stableId, entityCount }, "MQTT: Discovery cycle complete");
  }

  private getLocalizedText(text: LocalizedText): string {
    if (typeof text === "string") return text;
    // In the future we can use translate property and i18next if needed
    return text.text;
  }

  private async publishSensor(
    unitId: string,
    id: string,
    name: string,
    template: string,
    device: object,
    availability: object[],
    icon?: string,
    unit_of_measure?: string,
    device_class?: string,
  ) {
    if (!this.client || !this.connected) return;
    const payload = {
      name,
      unique_id: `luftuj_hru_${unitId}_${id}`,
      state_topic: `${BASE_TOPIC}/${unitId}/state`,
      value_template: template,
      device,
      availability,
      ...(icon ? { icon } : {}),
      ...(unit_of_measure ? { unit_of_measurement: unit_of_measure } : {}),
      ...(device_class ? { device_class } : {}),
    };
    await this.throttledPublish(
      `${DISCOVERY_PREFIX}/sensor/luftuj_hru_${unitId}/${id}/config`,
      JSON.stringify(payload),
      { qos: 1, retain: true },
    );
  }

  private async publishNumber(
    unitId: string,
    id: string,
    name: string,
    state_topic: string,
    command_topic: string,
    device: object,
    availability: object[],
    min: number,
    max: number,
    step: number,
    unit_of_measurement: string,
    icon: string,
  ) {
    if (!this.client || !this.connected) return;
    const payload = {
      name,
      unique_id: `luftuj_hru_${unitId}_${id}`,
      state_topic,
      command_topic,
      min,
      max,
      step,
      unit_of_measurement,
      icon,
      device,
      availability,
    };
    await this.throttledPublish(
      `${DISCOVERY_PREFIX}/number/luftuj_hru_${unitId}/${id}/config`,
      JSON.stringify(payload),
      { qos: 1, retain: true },
    );
  }

  private async publishButton(
    unitId: string,
    id: string,
    name: string,
    command_topic: string,
    payload_press: string,
    device: object,
    availability: object[],
    icon: string,
  ) {
    if (!this.client || !this.connected) return;
    const payload = {
      name,
      unique_id: `luftuj_hru_${unitId}_${id}`,
      command_topic,
      payload_press,
      icon,
      device,
      availability,
    };
    await this.throttledPublish(
      `${DISCOVERY_PREFIX}/button/luftuj_hru_${unitId}/${id}/config`,
      JSON.stringify(payload),
      { qos: 1, retain: true },
    );
  }

  private async removeDiscoveryEntity(unitId: string, outputType: string, id: string) {
    if (!this.client || !this.connected) return;
    await this.throttledPublish(
      `${DISCOVERY_PREFIX}/${outputType}/luftuj_hru_${unitId}/${id}/config`,
      "",
      { qos: 1, retain: true },
    );
  }

  private async updateBoostDiscovery(
    unitId: string,
    unit: HeatRecoveryUnit,
    strings: LocalizedStrings,
    device: object,
    availability: object[],
  ): Promise<number> {
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
    const currentBoostMap: Record<number, string> = { ...prevBoostMap };

    // Get unit ID for DB lookup - modes are stored with hruId from HRU settings, not unit.id
    // This aligns with how the API retrieves modes via getCurrentUnitId()
    const hruSettings = this.settingsRepo.getHruSettings();
    const settingsUnitId = hruSettings?.unit || unit.code;
    const modes = this.settingsRepo.getTimelineModes(settingsUnitId);
    let activeBoostCount = 0;

    // Debug: Log what we're working with
    const boostModes = modes.filter((m) => m.isBoost);
    this.logger.info(
      {
        settingsUnitId,
        unitId,
        totalModes: modes.length,
        boostModes: boostModes.length,
        prevBoostCount: Object.keys(prevBoostMap).length,
      },
      "MQTT: Boost discovery starting",
    );

    // Process ALL modes: register boosts, explicitly delete non-boosts OR modes from other units
    for (const m of modes) {
      const slug = this.slugify(m.name);
      // Compare m.hruId with settingsUnitId directly (no slugification needed)
      // Modes are stored with the raw settings unit ID, not slugified
      const isRelevantUnit = !m.hruId || m.hruId === settingsUnitId;

      if (!isRelevantUnit && m.isBoost) {
        // skip silent or debug log
      }

      if (m.isBoost && isRelevantUnit) {
        currentBoostMap[m.id] = slug;
        activeBoostCount++;

        // Delete old slug topic if renamed
        if (prevBoostMap[m.id] && prevBoostMap[m.id] !== slug) {
          const oldSlug = prevBoostMap[m.id];
          await this.removeDiscoveryEntity(unitId, "button", `boost_${oldSlug}`);
        }

        const boostBtnName = (strings.boost_label || "Boost: {{name}}").replace("{{name}}", m.name);
        await this.publishButton(
          unitId,
          `boost_${slug}`,
          boostBtnName,
          `${BASE_TOPIC}/${unitId}/boost/${m.id}/start`,
          "START",
          device,
          availability,
          "mdi:rocket-launch",
        );

        // Publish Infinite Boost Button
        await this.publishButton(
          unitId,
          `boost_${slug}_infinite`,
          `${boostBtnName} ∞`,
          `${BASE_TOPIC}/${unitId}/boost/${m.id}/start_infinite`,
          "START",
          device,
          availability,
          "mdi:all-inclusive",
        );
      } else {
        // Mode is NOT a boost anymore (or not relevant unit)

        // 1. Check if it was previously published as a boost (using tracked slug) and remove it
        if (prevBoostMap[m.id]) {
          const oldSlug = prevBoostMap[m.id];
          this.logger.info(
            { modeId: m.id, modeName: m.name, slug: oldSlug },
            "MQTT: Removing boost button (tracked)",
          );
          await this.removeDiscoveryEntity(unitId, "button", `boost_${oldSlug}`);
          await this.removeDiscoveryEntity(unitId, "button", `boost_${oldSlug}_infinite`);
          delete currentBoostMap[m.id];
        }

        // 2. FALLBACK: Always try to remove using the CURRENT name slug too
        // This handles cases where we lost track (prevBoostMap empty) but the button exists.
        await this.removeDiscoveryEntity(unitId, "button", `boost_${slug}`);
        await this.removeDiscoveryEntity(unitId, "button", `boost_${slug}_infinite`);
      }
    }

    // Cleanup modes that were deleted from DB entirely (present in prevBoostMap but not in modes)
    const modeIds = new Set(modes.map((m) => m.id));
    for (const modeIdStr of Object.keys(prevBoostMap)) {
      const modeId = parseInt(modeIdStr, 10);
      if (!modeIds.has(modeId)) {
        const oldSlug = prevBoostMap[modeId];
        this.logger.info(
          { modeId, slug: oldSlug },
          "MQTT: Removing boost button (mode was deleted)",
        );
        await this.removeDiscoveryEntity(unitId, "button", `boost_${oldSlug}`);
        await this.removeDiscoveryEntity(unitId, "button", `boost_${oldSlug}_infinite`);
        delete currentBoostMap[modeId];
      }
    }

    this.settingsRepo.setDiscoveredBoosts(currentBoostMap);
    this.logger.info({ count: activeBoostCount }, "MQTT: Boost discovery updated");
    return activeBoostCount * 2; // Each boost has 2 buttons (normal + infinite)
  }

  private async publishAvailability(unitId: string, status: "online" | "offline") {
    if (!this.client) return;
    try {
      await this.client.publishAsync(`${BASE_TOPIC}/${unitId}/status`, status, {
        qos: 1,
        retain: true,
      });
      this.logger.info({ unitId, status }, "MQTT: Availability published successfully");
    } catch (err) {
      this.logger.error({ err, unitId }, "MQTT: Failed to publish availability");
    }
  }
}
