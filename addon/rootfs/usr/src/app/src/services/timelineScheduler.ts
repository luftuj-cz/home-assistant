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
import type { SeasonalModesService } from "../features/seasonalModes/seasonalModes.service.js";

export type TimelineSource = "manual" | "schedule" | "boost";

export type HruWritePayload = Record<string, number | string | boolean>;

export type ModeValue = string | number | undefined;

export interface ActiveState {
  source: TimelineSource;
  modeName?: ModeValue;
}

export type ActivePayload = {
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

type ResolvedTimelineValues = {
  modeToSend: ModeValue;
  effectivePower: number | undefined;
  effectiveTemperature: number | undefined;
  effectiveLuftatorConfig: Record<string, number> | null | undefined;
  effectiveVariables: Record<string, number | string | boolean>;
};

export function resolveTimelineModeValues(
  foundMode: TimelineMode,
  current: ResolvedTimelineValues,
): ResolvedTimelineValues {
  const v = foundMode.variables ?? {};
  let modeToSend = current.modeToSend;
  let effectivePower = current.effectivePower;
  let effectiveTemperature = current.effectiveTemperature;
  const effectiveVariables = { ...current.effectiveVariables };

  if (typeof v.power === "number") effectivePower = v.power;
  if (typeof v.temperature === "number") effectiveTemperature = v.temperature;
  if (typeof v.mode === "number" || typeof v.mode === "string") modeToSend = v.mode;

  if (modeToSend === undefined && foundMode.nativeMode !== undefined) {
    modeToSend = foundMode.nativeMode;
  }
  if (effectivePower === undefined && foundMode.power !== undefined) {
    effectivePower = foundMode.power;
  }
  if (effectiveTemperature === undefined && foundMode.temperature !== undefined) {
    effectiveTemperature = foundMode.temperature;
  }

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

export function buildTimelineModePayload(
  mode: TimelineMode,
  source: TimelineSource,
): ActivePayload {
  const resolved = resolveTimelineModeValues(mode, {
    modeToSend: undefined,
    effectivePower: undefined,
    effectiveTemperature: undefined,
    effectiveLuftatorConfig: undefined,
    effectiveVariables: {},
  });

  const hruConfig: NonNullable<ActivePayload["hruConfig"]> = {};
  if (resolved.modeToSend !== undefined) hruConfig.mode = resolved.modeToSend;
  if (resolved.effectivePower !== undefined) hruConfig.power = resolved.effectivePower;
  if (resolved.effectiveTemperature !== undefined) {
    hruConfig.temperature = resolved.effectiveTemperature;
  }
  if (Object.keys(resolved.effectiveVariables).length > 0) {
    hruConfig.variables = resolved.effectiveVariables;
  }

  return {
    hruConfig: Object.keys(hruConfig).length > 0 ? hruConfig : undefined,
    luftatorConfig: resolved.effectiveLuftatorConfig,
    source,
    friendlyModeName: mode.name,
  };
}

function mergeHruConfigs(
  base: ActivePayload["hruConfig"],
  override: ActivePayload["hruConfig"],
): ActivePayload["hruConfig"] {
  if (!base && !override) return base;
  const result: NonNullable<ActivePayload["hruConfig"]> = { ...base };
  if (override?.mode !== undefined) result.mode = override.mode;
  if (override?.power !== undefined) result.power = override.power;
  if (override?.temperature !== undefined) result.temperature = override.temperature;
  const variables = { ...base?.variables, ...override?.variables };
  if (Object.keys(variables).length > 0) result.variables = variables;
  return result;
}

export function applySeasonalOverrideToPayload(
  payload: ActivePayload,
  override: NonNullable<ReturnType<SeasonalModesService["getActiveOverride"]>>,
): ActivePayload {
  const seasonalPayload = buildTimelineModePayload(override.baseMode, payload.source);
  const seasonalHruConfig = mergeHruConfigs(seasonalPayload.hruConfig, {
    power: override.power,
    temperature: override.temperature,
    variables: override.variables,
  });
  const hruConfig = mergeHruConfigs(payload.hruConfig, seasonalHruConfig);
  const seasonalLuftatorConfig = {
    ...seasonalPayload.luftatorConfig,
    ...override.luftatorConfig,
  };
  const luftatorConfig =
    Object.keys(seasonalLuftatorConfig).length > 0
      ? { ...payload.luftatorConfig, ...seasonalLuftatorConfig }
      : payload.luftatorConfig;

  return {
    ...payload,
    hruConfig,
    luftatorConfig,
    friendlyModeName: override.modeName,
  };
}

export class TimelineScheduler {
  private static readonly INFINITE_BOOST_DURATION = 999999;
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
    private readonly seasonalModesService?: SeasonalModesService,
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
    if (override.durationMinutes === TimelineScheduler.INFINITE_BOOST_DURATION) {
      return TimelineScheduler.INFINITE_BOOST_DURATION;
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
      this.lastActiveState = { source: "manual" };
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

  private applySeasonalOverride(
    payload: ActivePayload,
    currentUnitId: string | undefined,
  ): ActivePayload {
    if (!this.seasonalModesService) return payload;

    const override = this.seasonalModesService.getActiveOverride(new Date(), currentUnitId ?? null);
    if (!override) return payload;

    this.logger.debug(
      { season: override.season, baseModeId: override.baseModeId },
      "TimelineScheduler: applying seasonal override",
    );

    return applySeasonalOverrideToPayload(payload, override);
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

    const payload = this.buildScheduledEventPayload(event, currentUnitId);
    return this.applySeasonalOverride(payload, currentUnitId);
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
      return buildTimelineModePayload(mode, "boost");
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
    return resolveTimelineModeValues(foundMode, current);
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

    this.lastActiveState = {
      source,
      modeName,
    };

    const hasValves = luftatorConfig && Object.keys(luftatorConfig).length > 0;
    const hasHru = Boolean(hruConfig);

    if (!hasValves && !hasHru) {
      this.logger.debug({ source, id }, "TimelineScheduler: active state has no HRU/valve payload");
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
      firstApplyError = await this.applyValveUpdates(luftatorConfig, source);
    }

    if (hasHru && hruConfig) {
      firstApplyError ??= await this.applyHruUpdate(hruConfig, source, id);
    }

    if (throwOnApplyError && firstApplyError) {
      throw firstApplyError;
    }
  }
}
