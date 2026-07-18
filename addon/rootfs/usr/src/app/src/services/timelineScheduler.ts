import type { Logger } from "pino";
import type { ValveController } from "../core/valveManager.js";
import { getAppSetting, getTimelineModes, type TimelineEvent } from "./database.js";
import { mapTodayToTimelineDay, pickActiveEvent, timeToMinutes } from "./timeline/eventPicker.js";
import { findTimelineModeByReference } from "./timeline/modeReference.js";

import type { HruService } from "../features/hru/hru.service.js";
import {
  HRU_SETTINGS_KEY,
  type HruSettings,
  LANGUAGE_SETTING_KEY,
  type TimelineMode,
  type TimelineOverride,
} from "../types/index.js";
import type { SettingsRepository } from "../features/settings/settings.repository.js";
import { INFINITE_BOOST_DURATION_MINUTES } from "../constants.js";

export type TimelineSource = "manual" | "schedule" | "boost";

export type HruWritePayload = Record<string, number | string | boolean>;

type ModeValue = string | number | undefined;

export interface ActiveState {
  source: TimelineSource;
  modeName: ModeValue;
}

type ActivePayload = {
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
};

export class TimelineScheduler {
  private static readonly TRANSLATIONS = {
    cs: {
      manual: "Manuální",
      boost: "Manuální režim",
      schedule: "Plán",
    },
    en: {
      manual: "Manual",
      boost: "Boost",
      schedule: "Schedule",
    },
  };
  private schedulerTimer: NodeJS.Timeout | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private lastActiveState: ActiveState | null = null;

  constructor(
    private readonly valveManager: ValveController,
    private readonly hruService: HruService,
    private readonly settingsRepo: SettingsRepository,
    private readonly logger: Logger,
  ) {}

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
    const translations =
      TimelineScheduler.TRANSLATIONS[lang as keyof typeof TimelineScheduler.TRANSLATIONS] ||
      TimelineScheduler.TRANSLATIONS.en;

    if (state.source === "manual") {
      return translations.manual;
    }

    const prefix = state.source === "boost" ? translations.boost : translations.schedule;
    return `${prefix}: ${state.modeName || "?"}`;
  }

  public getBoostRemainingMinutes(): number {
    const override = this.settingsRepo.getTimelineOverride();
    if (!override?.endTime) return 0;
    if (override.durationMinutes === INFINITE_BOOST_DURATION_MINUTES) {
      return INFINITE_BOOST_DURATION_MINUTES;
    }
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
      await this.executeScheduledEventInternal(false);
    } catch (criticalError) {
      this.logger.error(
        { criticalError },
        "CRITICAL: TimelineScheduler encountered an unhandled error",
      );
    }
  }

  public async executeScheduledEventOrThrow(): Promise<void> {
    await this.executeScheduledEventInternal(true);
  }

  private async executeScheduledEventInternal(throwOnApplyError: boolean): Promise<void> {
    await this.reportValveStates();

    const activePayload = await this.resolveActiveEvent();

    if (!activePayload) {
      this.logger.debug("TimelineScheduler: no active event or boost for current time");
      this.lastActiveState = { source: "manual", modeName: undefined };
      return;
    }

    await this.applyEventValues(activePayload, throwOnApplyError);
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

    void this.hruService
      .executeKeepAlive()
      .then((period) => {
        if (period) {
          this.keepAliveTimer = setTimeout(() => this.runKeepAliveLoop(), period);
        } else {
          // Retry later if no keep-alive is currently configured/needed
          this.keepAliveTimer = setTimeout(() => this.runKeepAliveLoop(), 60_000);
        }
      })
      .catch((err) => {
        this.logger.warn({ err }, "TimelineScheduler: KeepAlive loop unexpected error");
        this.keepAliveTimer = setTimeout(() => this.runKeepAliveLoop(), 60_000);
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

  private async resolveActiveEvent(): Promise<ActivePayload | null> {
    const override = this.settingsRepo.getTimelineOverride();
    const currentUnitId = this.getCurrentUnitId();

    if (override) {
      const boostPayload = this.resolveBoostPayload(override, currentUnitId);
      if (boostPayload !== undefined) return boostPayload;
    }

    const nowMinutes = timeToMinutes(
      `${new Date().getHours().toString().padStart(2, "0")}:${new Date().getMinutes().toString().padStart(2, "0")}`,
    );
    const today = mapTodayToTimelineDay();
    const event = pickActiveEvent(currentUnitId, nowMinutes, today);
    if (!event) return null;

    return this.buildScheduledEventPayload(event, currentUnitId);
  }

  private resolveBoostPayload(
    override: NonNullable<TimelineOverride>,
    currentUnitId: string | undefined,
  ): ActivePayload | undefined {
    if (new Date(override.endTime) <= new Date()) {
      this.settingsRepo.setTimelineOverride(null);
      this.logger.info("TimelineScheduler: Boost override expired, cleared");
      return undefined;
    }

    if (override.modeId) {
      const modes = getTimelineModes(currentUnitId);
      const mode = modes.find((m) => m.id === override.modeId);
      if (!mode) {
        this.logger.warn(
          { modeId: override.modeId },
          "TimelineScheduler: boost mode not found, skipping",
        );
        this.settingsRepo.setTimelineOverride(null);
        return undefined;
      }
      const modeVariables = mode.variables ?? {};
      const nativeMode =
        typeof modeVariables.mode === "number" || typeof modeVariables.mode === "string"
          ? modeVariables.mode
          : mode.nativeMode;
      return {
        hruConfig: {
          mode: nativeMode,
          power: mode.power,
          temperature: mode.temperature,
          variables: mode.variables,
        },
        luftatorConfig: mode.luftatorConfig,
        source: "boost",
        friendlyModeName: mode.name,
      };
    }

    if (override.customConfig) {
      return {
        hruConfig: {
          mode: override.customConfig.nativeMode,
          power: override.customConfig.power,
          temperature: override.customConfig.temperature,
          variables: override.customConfig.variables,
        },
        luftatorConfig: override.customConfig.luftatorConfig,
        source: "boost",
        friendlyModeName: "Test Mode",
      };
    }

    return undefined;
  }

  private applyFoundModeToValues(
    foundMode: TimelineMode,
    current: {
      modeToSend: ModeValue;
      effectivePower: number | undefined;
      effectiveTemperature: number | undefined;
      effectiveLuftatorConfig: Record<string, number> | null | undefined;
      effectiveVariables: Record<string, number | string | boolean>;
    },
  ) {
    // New schema: prefer variables map first
    const v = foundMode.variables ?? {};
    let modeToSend = current.modeToSend;
    let effectivePower = current.effectivePower;
    let effectiveTemperature = current.effectiveTemperature;
    const effectiveVariables = { ...current.effectiveVariables };

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

    return {
      modeToSend,
      effectivePower,
      effectiveTemperature,
      effectiveLuftatorConfig: foundMode.luftatorConfig ?? current.effectiveLuftatorConfig,
      effectiveVariables,
    };
  }

  private buildScheduledEventPayload(
    event: TimelineEvent,
    currentUnitId: string | undefined,
  ): ActivePayload {
    const initial = {
      modeToSend: undefined as ModeValue,
      effectivePower: event.hruConfig?.power,
      effectiveTemperature: event.hruConfig?.temperature,
      effectiveLuftatorConfig: event.luftatorConfig,
      effectiveVariables: { ...event.hruConfig?.variables } as Record<
        string,
        number | string | boolean
      >,
    };

    const displayModeName = event.hruConfig?.mode;
    let foundMode: TimelineMode | null = null;
    let resolved = initial;

    if (displayModeName) {
      const modes = getTimelineModes(currentUnitId);
      foundMode = findTimelineModeByReference(modes, displayModeName);
      if (foundMode) {
        resolved = this.applyFoundModeToValues(foundMode, initial);
      } else {
        this.logger.warn(
          { mode: displayModeName, eventId: event.id },
          "TimelineScheduler: event mode reference not found, skipping native mode write",
        );
      }
    }

    return {
      hruConfig: event.hruConfig
        ? {
            ...event.hruConfig,
            mode: resolved.modeToSend,
            power: resolved.effectivePower,
            temperature: resolved.effectiveTemperature,
            variables: Object.keys(resolved.effectiveVariables).length
              ? resolved.effectiveVariables
              : event.hruConfig.variables,
          }
        : event.hruConfig,
      luftatorConfig: resolved.effectiveLuftatorConfig,
      source: "schedule",
      id: event.id,
      friendlyModeName: foundMode?.name,
    };
  }

  private async applyValveUpdates(
    luftatorConfig: Record<string, number>,
    source: TimelineSource,
  ): Promise<Error | null> {
    let firstError: Error | null = null;
    const snapshot = await this.valveManager.getSnapshot();
    const activeEntityIds = new Set(snapshot.map((valve) => valve.entity_id));

    for (const [entityId, opening] of Object.entries(luftatorConfig)) {
      if (opening === undefined || opening === null) continue;
      if (!activeEntityIds.has(entityId)) {
        this.logger.warn(
          { entityId, source },
          "Skipping valve missing from the current snapshot; keeping its mode configuration",
        );
        continue;
      }
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
        firstError ??= err instanceof Error ? err : new Error(String(err));
      }
    }
    return firstError;
  }

  private async applyHruUpdate(
    hruConfig: NonNullable<ActivePayload["hruConfig"]>,
    source: TimelineSource,
    id: number | undefined,
  ): Promise<Error | null> {
    try {
      const values = this.buildHruWriteValues(hruConfig);
      if (Object.keys(values).length > 0) {
        await this.hruService.writeValues(values);
        this.logger.info(
          { source, id, hruConfig },
          "TimelineScheduler: applied HRU settings successfully",
        );
      }
      return null;
    } catch (err) {
      this.logger.error({ err, source }, "TimelineScheduler: Failed to apply HRU settings");
      return err instanceof Error ? err : new Error(String(err));
    }
  }

  private async applyEventValues(
    activePayload: ActivePayload,
    throwOnApplyError = false,
  ): Promise<void> {
    const { hruConfig, luftatorConfig, source, id } = activePayload;
    let firstApplyError: Error | null = null;

    let modeName: ModeValue;
    if (source === "boost" || source === "schedule") {
      modeName = activePayload.friendlyModeName || hruConfig?.mode;
      this.logger.info(
        { source, id, modeName, hruConfig },
        "TimelineScheduler: resolved friendly mode name",
      );
    }

    const hasValves = luftatorConfig && Object.keys(luftatorConfig).length > 0;
    const hasHru = Boolean(hruConfig);

    if (!hasValves && !hasHru) {
      this.logger.debug({ source, id }, "TimelineScheduler: active state has no HRU/valve payload");
      this.lastActiveState = { source, modeName };
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

    let valveApplyError: Error | null = null;
    let hruApplyError: Error | null = null;

    if (hasValves && luftatorConfig) {
      valveApplyError = await this.applyValveUpdates(luftatorConfig, source);
    }

    if (hasHru && hruConfig) {
      hruApplyError = await this.applyHruUpdate(hruConfig, source, id);
    }

    firstApplyError = valveApplyError ?? hruApplyError;

    // Only report the new mode/boost name once the HRU side is actually confirmed
    // applied - reporting it optimistically made the dashboard/MQTT claim a mode
    // change had happened while the physical HRU write kept failing underneath.
    // A partial valve failure (e.g. one valve out of several) doesn't gate this:
    // modeName describes the HRU mode/boost, not individual valve positions, so
    // it shouldn't stay stuck on the old value just because one valve lagged.
    if (!hasHru || !hruApplyError) {
      this.lastActiveState = { source, modeName };
    }

    if (throwOnApplyError && firstApplyError) {
      throw firstApplyError;
    }
  }
}
