import type { Logger } from "pino";
import type { ValveController } from "../core/valveManager.js";
import { getAppSetting, getTimelineModes } from "./database.js";
import { mapTodayToTimelineDay, pickActiveEvent, timeToMinutes } from "./timeline/eventPicker.js";

import type { HruService } from "../features/hru/hru.service.js";
import { HRU_SETTINGS_KEY, type HruSettings, LANGUAGE_SETTING_KEY } from "../types/index.js";
import type { SettingsRepository } from "../features/settings/settings.repository.js";

export type TimelineSource = "manual" | "schedule" | "boost";

export type HruWritePayload = Record<string, number | string | boolean>;

export interface ActiveState {
  source: TimelineSource;
  modeName?: string | number;
}

export class TimelineScheduler {
  private schedulerTimer: NodeJS.Timeout | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private lastActiveState: ActiveState | null = null;

  constructor(
    private readonly valveManager: ValveController,
    private readonly hruService: HruService,
    private readonly settingsRepo: SettingsRepository,
    private readonly logger: Logger,
  ) {
  }

  public start(): void {
    if (this.schedulerTimer) return;
    this.logger.info("TimelineScheduler: Starting scheduler service");
    void this.executeScheduledEvent().finally(() => this.scheduleNextTick());
    this.runKeepAliveLoop();
  }

  public stop(): void {
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.keepAliveTimer) {
      clearTimeout(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  public restart(): void {
    this.logger.info("TimelineScheduler: Restarting scheduler service");
    this.stop();
    this.start();
    this.logger.info("TimelineScheduler: Scheduler service successfully restarted");
  }

  // noinspection JSUnusedGlobalSymbols
  public getActiveState(): ActiveState | null {
    return this.lastActiveState;
  }

  public getFormattedActiveMode(): string {
    const state = this.lastActiveState;
    if (!state) return "?";

    const lang = getAppSetting(LANGUAGE_SETTING_KEY) || "en";
    const isCs = lang === "cs";

    if (state.source === "manual") {
      return isCs ? "Manuální" : "Manual";
    }

    let prefix: string;
    if (state.source === "boost") {
      prefix = isCs ? "Manuální režim" : "Boost";
    } else {
      prefix = isCs ? "Plán" : "Schedule";
    }

    return `${prefix}: ${state.modeName || "?"}`;
  }

  public getBoostRemainingMinutes(): number {
    const override = this.settingsRepo.getTimelineOverride();
    if (!override?.endTime) return 0;
    if (override.durationMinutes === 999999) return 999999;
    const diff = new Date(override.endTime).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 60000));
  }

  public getActiveBoostName(): string | null {
    const state = this.lastActiveState;
    if (state?.source === "boost" && state.modeName !== undefined) {
      if (state.modeName === "Test Mode") return "Test Mode";
      return String(state.modeName);
    }
    return null;
  }

  public async executeScheduledEvent(): Promise<void> {
    try {
      await this.reportValveStates();

      const activePayload = await this.resolveActiveEvent();

      if (!activePayload) {
        this.logger.debug("TimelineScheduler: no active event or boost for current time");
        this.lastActiveState = { source: "manual" };
        return;
      }

      await this.applyEventValues(activePayload);
    } catch (criticalError) {
      this.logger.error(
        { criticalError },
        "CRITICAL: TimelineScheduler encountered an unhandled error",
      );
    }
  }

  private scheduleNextTick(): void {
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
    }
    this.schedulerTimer = setTimeout(() => {
      void this.executeScheduledEvent().finally(() => {
        this.scheduleNextTick();
      });
    }, 10_000);
  }

  private runKeepAliveLoop(): void {
    if (this.keepAliveTimer) {
      clearTimeout(this.keepAliveTimer);
    }

    void this.hruService.executeKeepAlive().then((period) => {
      if (period) {
        this.keepAliveTimer = setTimeout(() => this.runKeepAliveLoop(), period);
      } else {
        // Retry later if no keep-alive is currently configured/needed
        this.keepAliveTimer = setTimeout(() => this.runKeepAliveLoop(), 60_000);
      }
    });
  }

  private buildHruWriteValues(config?: {
    mode?: string | number;
    power?: number;
    temperature?: number;
    variables?: HruWritePayload;
  }): HruWritePayload {
    const values: HruWritePayload = {};

    if (config?.mode !== undefined) values.mode = config.mode;
    if (config?.power !== undefined) values.power = config.power;
    if (config?.temperature !== undefined) values.temperature = config.temperature;
    if (config?.variables) {
      for (const [key, value] of Object.entries(config.variables)) {
        if (value !== undefined && value !== null) {
          values[key] = value;
        }
      }
    }

    return values;
  }

  private async applyHruConfig(config?: {
    mode?: string | number;
    power?: number;
    temperature?: number;
    variables?: HruWritePayload;
  }): Promise<void> {
    const payload = this.buildHruWriteValues(config);

    if (Object.keys(payload).length === 0) return;

    try {
      await this.hruService.writeValues(payload);
    } catch (err) {
      this.logger.error({ err, payload }, "TimelineScheduler: Failed to apply HRU config");
    }
  }

  private getCurrentUnitId(): string | undefined {
    try {
      const rawSettings = getAppSetting(HRU_SETTINGS_KEY);
      if (rawSettings) {
        const settings = JSON.parse(rawSettings) as HruSettings;
        if (settings.unit) {
          return settings.unit;
        }
      }
    } catch (err) {
      this.logger.error(
        { err },
        "TimelineScheduler: failed to parse HRU settings, treating as global/no unit",
      );
    }

    // Fallback: use first available unit if specific setting is missing
    const units = this.hruService.getAllUnits();
    return units[0]?.id;
  }

  private async reportValveStates(): Promise<void> {
    try {
      const snapshot = await this.valveManager.getSnapshot();
      const states = snapshot.reduce(
        (acc, v) => ({ ...acc, [v.entity_id]: v.state }),
        {} as Record<string, string>,
      );
      this.logger.info({ states }, "TimelineScheduler: Periodic valve state report successful");
    } catch (err) {
      this.logger.error({ err }, "TimelineScheduler: Failed to report valve states");
    }
  }

  private async resolveActiveEvent(): Promise<{
    hruConfig?: {
      mode?: string | number;
      power?: number;
      temperature?: number;
      variables?: HruWritePayload;
    } | null;
    luftatorConfig?: Record<string, number> | null;
    source: TimelineSource;
    id?: number;
    friendlyModeName?: string;
  } | null> {
    const override = this.settingsRepo.getTimelineOverride();
    const currentUnitId = this.getCurrentUnitId();

    if (override) {
      if (new Date(override.endTime) > new Date()) {
        if (override.modeId) {
          const modes = getTimelineModes(currentUnitId);
          const mode = modes.find((m) => m.id === override.modeId);
          if (mode) {
            return {
              hruConfig: {
                mode: mode.nativeMode ?? mode.name,
                power: mode.power,
                temperature: mode.temperature,
                variables: mode.variables,
              },
              luftatorConfig: mode.luftatorConfig,
              source: "boost",
              friendlyModeName: mode.name,
            };
          } else {
            this.logger.warn(
              { modeId: override.modeId },
              "TimelineScheduler: boost mode not found, skipping",
            );
            this.settingsRepo.setTimelineOverride(null);
          }
        } else if (override.customConfig) {
          return {
            hruConfig: {
              mode: override.customConfig.nativeMode,
              power: override.customConfig.power,
              temperature: override.customConfig.temperature,
            },
            luftatorConfig: override.customConfig.luftatorConfig,
            source: "boost",
            friendlyModeName: "Test Mode",
          };
        }
      } else {
        this.settingsRepo.setTimelineOverride(null);
        this.logger.info("TimelineScheduler: Boost override expired, cleared");
      }
    }

    const nowMinutes = timeToMinutes(
      `${new Date().getHours().toString().padStart(2, "0")}:${new Date().getMinutes().toString().padStart(2, "0")}`,
    );
    const today = mapTodayToTimelineDay();

    const event = pickActiveEvent(currentUnitId, nowMinutes, today);
    if (!event) return null;

    let displayModeName = event.hruConfig?.mode;
    let effectivePower = event.hruConfig?.power;
    let effectiveTemperature = event.hruConfig?.temperature;
    let effectiveLuftatorConfig = event.luftatorConfig;
    const effectiveVariables = { ...event.hruConfig?.variables } as Record<
      string,
      number | string | boolean
    >;

    let modeToSend: string | number | undefined =
      typeof event.hruConfig?.mode === "number" || typeof event.hruConfig?.mode === "string"
        ? event.hruConfig.mode
        : undefined;

    let foundMode;
    if (displayModeName) {
      const modes = getTimelineModes(currentUnitId);

      if (typeof displayModeName === "number" || /^\d+$/.test(displayModeName)) {
        const modeId = Number.parseInt(String(displayModeName), 10);
        foundMode = modes.find((m) => m.id === modeId);
      } else {
        foundMode = modes.find((m) => m.name === displayModeName);
      }

      if (foundMode) {
        displayModeName = foundMode.name;

        // New schema: prefer variables map first
        const v = foundMode.variables ?? {};
        if (typeof v.power === "number") effectivePower = v.power;
        if (typeof v.temperature === "number") effectiveTemperature = v.temperature;
        if (typeof v.mode === "number" || typeof v.mode === "string") modeToSend = v.mode;

        // Fallbacks: use explicit nativeMode/power/temperature fields if variables map doesn't carry them
        if (modeToSend === undefined && foundMode.nativeMode !== undefined) {
          modeToSend = foundMode.nativeMode;
        }
        if (effectivePower === undefined && foundMode.power !== undefined) {
          effectivePower = foundMode.power;
        }
        if (effectiveTemperature === undefined && foundMode.temperature !== undefined) {
          effectiveTemperature = foundMode.temperature;
        }

        // Merge any additional variables from mode
        for (const [key, value] of Object.entries(v)) {
          if (value !== undefined) effectiveVariables[key] = value;
        }

        // If variables map did not provide mode, fall back to event payload (no legacy mapping)
        if (modeToSend === undefined) {
          const m = event.hruConfig?.mode;
          if (typeof m === "number" || typeof m === "string") modeToSend = m;
        }

        if (foundMode.luftatorConfig) effectiveLuftatorConfig = foundMode.luftatorConfig;
      } else {
        this.logger.warn(
          { mode: displayModeName, eventId: event.id },
          "TimelineScheduler: event mode not found, applying raw config",
        );
      }
    }

    return {
      hruConfig: event.hruConfig
        ? {
          ...event.hruConfig,
          mode: modeToSend,
          power: effectivePower,
          temperature: effectiveTemperature,
          variables: Object.keys(effectiveVariables).length
            ? effectiveVariables
            : event.hruConfig.variables,
        }
        : event.hruConfig,
      luftatorConfig: effectiveLuftatorConfig,
      source: "schedule",
      id: event.id,
      friendlyModeName: foundMode?.name,
    };
  }

  private async applyEventValues(activePayload: {
    hruConfig?: {
      mode?: string | number;
      power?: number;
      temperature?: number;
      variables?: HruWritePayload;
    } | null;
    luftatorConfig?: Record<string, number> | null;
    source: TimelineSource;
    id?: number;
    friendlyModeName?: string;
  }): Promise<void> {
    const { hruConfig, luftatorConfig, source, id } = activePayload;

    // Apply HRU settings immediately
    await this.applyHruConfig(hruConfig ?? undefined);

    let modeName: string | number | undefined;
    if (source === "boost" || source === "schedule") {
      modeName = activePayload.friendlyModeName || hruConfig?.mode;
      this.logger.info(
        { source, id, modeName, hruConfig },
        "TimelineScheduler: resolved friendly mode name",
      );
    }

    this.lastActiveState = {
      source,
      modeName,
    };

    const hasValves = luftatorConfig && Object.keys(luftatorConfig).length > 0;
    const hasHru = Boolean(hruConfig);

    if (!hasValves && !hasHru) {
      this.logger.debug(
        { source, id },
        "TimelineScheduler: active state has no HRU/valve payload",
      );
      return;
    }

    this.logger.info(
      {
        source,
        id,
        hasValves,
        hasHru,
        luftatorConfig,
        schedulerTime: `${new Date().getHours()}:${new Date().getMinutes()}`,
        activeModeName: modeName,
      },
      "TimelineScheduler: applying active state",
    );

    if (hasValves && luftatorConfig) {
      for (const [entityId, opening] of Object.entries(luftatorConfig)) {
        if (opening === undefined || opening === null) continue;
        try {
          const result = await this.valveManager.setValue(entityId, opening);
          this.logger.info(
            { entityId, target: opening, actual: result.state },
            "TimelineScheduler: VALVE MOVE COMMAND EXECUTED AND VERIFIED",
          );
        } catch (err) {
          this.logger.error(
            { entityId, err, source },
            "TimelineScheduler: CRITICAL ERROR - could not move valve",
          );
        }
      }
    }

    if (hasHru && hruConfig) {
      try {
        const values = this.buildHruWriteValues(hruConfig);

        if (Object.keys(values).length > 0) {
          await this.hruService.writeValues(values);
          this.logger.info(
            { source, id, hruConfig },
            "TimelineScheduler: applied HRU settings successfully",
          );
        }
      } catch (err) {
        this.logger.error({ err, source }, "TimelineScheduler: Failed to apply HRU settings");
      }
    }
  }
}
