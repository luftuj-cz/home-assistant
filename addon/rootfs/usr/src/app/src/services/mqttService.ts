import mqtt from "mqtt";
import { EventEmitter } from "events";
import type { Logger } from "pino";
import type { AppConfig } from "../config/options";
import type { HeatRecoveryUnit, RegulationCapabilities } from "../features/hru/hru.definitions";
import { type MqttSettings, type TimelineOverride } from "../types";
import type { SettingsRepository } from "../features/settings/settings.repository";
import type { TimelineScheduler } from "./timelineScheduler";

const DISCOVERY_PREFIX = "homeassistant";
const BASE_TOPIC = "luftuj/hru";
const STATIC_CLIENT_ID_PREFIX = "luftuj-addon-client";

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
    level_unit: string;
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

export class MqttService extends EventEmitter {
  private client: mqtt.MqttClient | null = null;
  private connected = false;
  private lastSuccessAt = 0;

  private cachedDiscoveryUnit: HeatRecoveryUnit | null = null;
  private cachedCapabilities: RegulationCapabilities | null = null;
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
    const instanceId = Math.random().toString(16).slice(2, 6);
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
      this.client = mqtt.connect({
        host: config.host,
        port: config.port,
        protocol: "mqtt",
        username: config.user ?? undefined,
        password: config.password ?? undefined,
        clientId,
        clean: true,
        keepalive: 60,
        protocolVersion: 5,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        // Force IPv4 to prevent "Happy Eyeballs" race condition
        // where multiple IPv6 addresses are tried and cause unstable connections
        family: 4,
      } as mqtt.IClientOptions & { family?: 4 | 6 });

      this.setupEventListeners();
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
      } catch (err) {
        this.logger.warn({ err }, "MQTT: Error during disconnect");
      }
      this.client = null;
      this.connected = false;
    }
  }

  public async publishDiscovery(
    unit: HeatRecoveryUnit,
    capabilities: RegulationCapabilities,
  ): Promise<boolean> {
    this.cachedDiscoveryUnit = unit;
    this.cachedCapabilities = capabilities;

    // If already connected, run discovery immediately
    if (this.connected) {
      void this.runDiscoveryCycle();
    }

    return true;
  }

  /**
   * Manually trigger a discovery refresh (e.g. after mode changes)
   */
  public async refreshDiscovery() {
    this.logger.info("MQTT: Manual discovery refresh triggered");
    await this.runDiscoveryCycle();
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
        manualConnect: true,
        family: 4,
      } as mqtt.IClientOptions & { family?: 4 | 6 });

      let finished = false;
      let timer: NodeJS.Timeout | null = null;

      function finish(ok: boolean, msg?: string) {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
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

      timer = setTimeout(() => finish(false, "Timeout"), 6000);
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
    if (!this.cachedDiscoveryUnit) {
      // No unit cached, just emit connect
      this.emit("connect");
      return;
    }

    const unitId = this.slugify(this.cachedDiscoveryUnit.code || this.cachedDiscoveryUnit.name);

    try {
      // 1. Subscribe to commands first (3 subscriptions)
      await this.subscribeToCommands(unitId);

      // 2. Publish availability
      await this.publishAvailability(unitId, "online");

      // 3. Run discovery cycle (publishes many messages)
      await this.runDiscoveryCycle();

      // 4. Finally emit connect so HruMonitor can publish state
      this.emit("connect");
    } catch (err) {
      this.logger.warn({ err }, "MQTT: Connect sequence failed, emitting connect anyway");
      this.emit("connect");
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
      if (this.connected) {
        this.logger.warn("MQTT: Connection closed");
      }
      this.connected = false;
      this.emit("disconnect");
      // Note: Can't publish availability here - connection is already closed
      // The broker's LWT or clean session should handle this
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
      this.logger.debug({ unitId }, "MQTT: Subscribed to unit commands");
    } catch (err) {
      this.logger.warn({ err, unitId }, "MQTT: Failed to subscribe to commands");
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
        // Validate payload (5-240)
        if (!isNaN(duration) && duration >= 5 && duration <= 240) {
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
          this.logger.info({ duration }, "MQTT: Boost duration updated");
        } else {
          this.logger.warn({ payload }, "MQTT: Invalid duration received (must be 5-240)");
        }
      }

      // 2. Cancel Boost
      if (topic === `${unitBaseTopic}/boost/cancel` && payload === "CANCEL") {
        this.logger.info("MQTT: Execute Boost Cancel");
        this.settingsRepo.setTimelineOverride(null);
        await this.timelineScheduler.executeScheduledEvent();
        this.emit("command-received");
        this.logger.info("MQTT: Boost cancelled");
      }

      // 3. Start Boost
      const startBoostMatch = topic.match(new RegExp(`${unitBaseTopic}/boost/(\\d+)/start`));
      if (startBoostMatch && payload === "START") {
        const modeIdStr = startBoostMatch[1];
        if (!modeIdStr) {
          this.logger.warn("MQTT: Boost start matched but no ID found");
          return;
        }

        const modeId = parseInt(modeIdStr, 10);
        const duration = this.settingsRepo.getBoostDuration();
        const endTime = new Date(Date.now() + duration * 60 * 1000).toISOString();
        const override: TimelineOverride = { modeId, endTime, durationMinutes: duration };

        this.logger.info({ modeId, duration, override }, "MQTT: Execute Boost Start");

        this.settingsRepo.setTimelineOverride(override);
        await this.timelineScheduler.executeScheduledEvent();
        this.emit("command-received");

        this.logger.info("MQTT: Boost activated successfully");
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

  private async runDiscoveryCycle() {
    if (!this.connected || !this.client || !this.cachedDiscoveryUnit) {
      return;
    }

    try {
      await this.internalSendDiscovery(this.cachedDiscoveryUnit, this.cachedCapabilities);
      this.lastSuccessAt = Date.now();
    } catch (err) {
      this.logger.warn({ err }, "MQTT: Simple discovery cycle failed");
    }
  }

  private async internalSendDiscovery(
    unit: HeatRecoveryUnit,
    capabilities?: RegulationCapabilities | null,
  ) {
    if (!this.client || !this.connected) {
      this.logger.debug("MQTT: internalSendDiscovery called but not connected, skipping");
      return;
    }

    // Use stable ID if available, valid fallback otherwise
    // unit.id should be the database UUID
    const stableId = unit.id ? `${unit.id}` : this.slugify(unit.code || "default_hru");

    // Mutable name for display/topics
    const unitId = this.slugify(unit.code || unit.name);

    // Device Info - Identifiers MUST be stable and unique
    const device = {
      identifiers: [`luftuj_hru_device_${stableId}`],
      name: `Luftuj (${unit.name})`,
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

    // Note: Subscriptions are handled in subscribeToCommands() on connect
    // No need to re-subscribe here - duplicates can cause issues

    // Get strings
    const strings = LOCALIZED_STRINGS[this.settingsRepo.getLanguage()] || LOCALIZED_STRINGS.en;
    if (!strings) {
      this.logger.error("MQTT: Failed to load localization strings for discovery");
      return;
    }

    // --- 1. Sensors & Configuration ---

    const powerUnitRaw = unit.controlUnit || "%";
    const powerUnit = powerUnitRaw === "level" ? strings.level_unit || "level" : powerUnitRaw;
    const powerCls = powerUnitRaw === "%" ? "power_factor" : undefined;

    await this.publishSensor(
      unitId,
      "power",
      strings.power,
      "{{ value_json.power }}",
      device,
      availability,
      "mdi:fan",
      powerUnit,
      powerCls,
    );

    if (capabilities?.hasTemperatureControl !== false) {
      await this.publishSensor(
        unitId,
        "temperature",
        strings.temperature,
        "{{ value_json.temperature }}",
        device,
        availability,
        "mdi:thermometer",
        "°C",
        "temperature",
      );
    } else {
      await this.removeDiscoveryEntity(unitId, "sensor", "temperature");
    }

    await this.publishSensor(
      unitId,
      "mode",
      strings.mode,
      "{{ value_json.mode_formatted }}",
      device,
      availability,
      "mdi:fan",
    );

    if (capabilities?.hasModeControl !== false) {
      await this.publishSensor(
        unitId,
        "native_mode",
        strings.native_mode,
        "{{ value_json.native_mode_formatted }}",
        device,
        availability,
        "mdi:cog",
      );
    } else {
      await this.removeDiscoveryEntity(unitId, "sensor", "native_mode");
    }

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
    await this.publishSensor(
      unitId,
      "boost_mode",
      strings.boost_mode,
      "{{ value_json.boost_name }}",
      device,
      availability,
      "mdi:rocket",
    );

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
      240,
      5,
      "min",
      "mdi:clock-fast",
    );

    // Initial publish of boost duration
    const currentDuration = this.settingsRepo.getBoostDuration();
    await this.client.publishAsync(
      `${unitBaseTopic}/boost_duration/state`,
      String(currentDuration),
      { qos: 0, retain: true },
    );

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

    // --- 2. Boost Controls Lifecycle ---
    await this.updateBoostDiscovery(unitId, unit, strings, device, availability);

    // Finalize
    await this.publishAvailability(unitId, "online");
    this.logger.info({ unitId, stableId }, "MQTT: Discovery cycle complete (Optimized)");
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
    await this.client?.publishAsync(
      `${DISCOVERY_PREFIX}/sensor/luftuj_hru_${unitId}/${id}/config`,
      JSON.stringify(payload),
      { qos: 0, retain: true },
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
    await this.client?.publishAsync(
      `${DISCOVERY_PREFIX}/number/luftuj_hru_${unitId}/${id}/config`,
      JSON.stringify(payload),
      { qos: 0, retain: true },
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
    const payload = {
      name,
      unique_id: `luftuj_hru_${unitId}_${id}`,
      command_topic,
      payload_press,
      icon,
      device,
      availability,
    };
    await this.client?.publishAsync(
      `${DISCOVERY_PREFIX}/button/luftuj_hru_${unitId}/${id}/config`,
      JSON.stringify(payload),
      { qos: 0, retain: true },
    );
  }

  private async removeDiscoveryEntity(unitId: string, outputType: string, id: string) {
    await this.client?.publishAsync(
      `${DISCOVERY_PREFIX}/${outputType}/luftuj_hru_${unitId}/${id}/config`,
      "",
      { qos: 0, retain: true },
    );
  }

  private async updateBoostDiscovery(
    unitId: string,
    unit: HeatRecoveryUnit,
    strings: Record<string, string>,
    device: object,
    availability: object[],
  ) {
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
    const settingsUnitId = hruSettings?.unit || unit.id;
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
          delete currentBoostMap[m.id];
        }

        // 2. FALLBACK: Always try to remove using the CURRENT name slug too
        // This handles cases where we lost track (prevBoostMap empty) but the button exists.
        await this.removeDiscoveryEntity(unitId, "button", `boost_${slug}`);
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
        delete currentBoostMap[modeId];
      }
    }

    this.settingsRepo.setDiscoveredBoosts(currentBoostMap);
    this.logger.info({ count: activeBoostCount }, "MQTT: Boost discovery updated");
  }

  private async publishAvailability(unitId: string, status: "online" | "offline") {
    if (!this.client) return;
    try {
      await this.client.publishAsync(`${BASE_TOPIC}/${unitId}/status`, status, {
        qos: 0,
        retain: true,
      });
    } catch {
      this.logger.warn({ unitId }, "MQTT: Failed to publish availability");
    }
  }
}
