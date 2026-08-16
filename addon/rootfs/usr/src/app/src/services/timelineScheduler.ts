import type { Logger } from "pino";
import type { ValveController } from "../core/valveManager.js";
import type { HomeAssistantClient } from "./homeAssistantClient.js";
import {
  getActiveSeasonId,
  getAppSetting,
  getSeasons,
  getTimelineEvents,
  getTimelineModes,
  type Season,
  type TimelineEvent,
} from "./database.js";
import { mapTodayToTimelineDay, pickActiveEvent, timeToMinutes } from "./timeline/eventPicker.js";
import { findTimelineModeByReference } from "./timeline/modeReference.js";

import type { HruService } from "../features/hru/hru.service.js";
import {
  HRU_SETTINGS_KEY,
  type HruSettings,
  LANGUAGE_SETTING_KEY,
  SEASONS_ENABLED_KEY,
  type TimelineMode,
  type TimelineOverride,
} from "../types/index.js";
import type { SettingsRepository } from "../features/settings/settings.repository.js";
import { INFINITE_BOOST_DURATION_MINUTES } from "../constants.js";

/**
 * "fallback" is the automatic safe state: distinct from "manual" so the
 * dashboard and MQTT never present an automatic low state as user control.
 */
export type TimelineSource = "manual" | "schedule" | "boost" | "fallback";

/** Setpoint written by the safe state, clamped into the unit's declared range. */
export const SAFE_STATE_TEMPERATURE_C = 20;

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
  scriptEntityIds?: string[];
  // Uniquely identifies a single activation instance, so scripts fire once per
  // real activation but re-fire when the user re-triggers the same mode.
  activationToken?: string;
};

export class TimelineScheduler {
  private static readonly TRANSLATIONS = {
    cs: {
      manual: "Manuální",
      boost: "Manuální režim",
      schedule: "Plán",
      fallback: "Bezpečný režim",
    },
    en: {
      manual: "Manual",
      boost: "Boost",
      schedule: "Schedule",
      fallback: "Safe state",
    },
  };
  /**
   * Whether the safe state has already been written for the current no-event
   * condition. Cleared as soon as anything else applies, so leaving and
   * re-entering the condition writes it again.
   */
  private safeStateApplied = false;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private lastActiveState: ActiveState | null = null;
  // In-memory (deliberately NOT persisted): resets on process restart so the
  // active mode's scripts re-fire after an add-on restart, re-syncing the
  // external hardware to the current scene.
  private lastScriptActivationKey: string | null = null;

  constructor(
    private readonly valveManager: ValveController,
    private readonly hruService: HruService,
    private readonly settingsRepo: SettingsRepository,
    private readonly logger: Logger,
    private readonly haClient: HomeAssistantClient | null = null,
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
    // Never render the automatic safe state as user control.
    if (state.source === "fallback") {
      return translations.fallback;
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
      // Nothing active: clear the fired-activation marker so the next real
      // activation always runs its scripts.
      this.lastScriptActivationKey = null;
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
    if (!event) {
      return this.resolveNoEventPayload(currentUnitId);
    }

    return this.buildScheduledEventPayload(event, currentUnitId);
  }

  /**
   * Nothing is scheduled. Rather than leaving the unit on whatever was last
   * written - which can go unnoticed for months - drive it to a defined low
   * state. Gated on seasons being enabled: without them "no applicable event"
   * has always meant "write nothing", and changing that for existing installs
   * would be a hardware-visible change on update.
   */
  private resolveNoEventPayload(currentUnitId: string | undefined): ActivePayload | null {
    const seasons = getSeasons(currentUnitId ?? null);
    const enabled = seasons.filter((season) => season.enabled);

    if (seasons.length > 0 && enabled.length === 0) {
      this.logger.error(
        { unitId: currentUnitId },
        "TimelineScheduler: no season is enabled - no schedule can apply on any day",
      );
      this.safeStateApplied = false;
      return null;
    }

    if (!this.isSeasonsFeatureEnabled(enabled)) {
      this.logger.debug("TimelineScheduler: no active event or boost for current time");
      this.safeStateApplied = false;
      return null;
    }

    if (!this.hasEverHadEnabledEvent()) {
      // A never-configured install is still running whatever the user set
      // before the add-on existed. Turning it down on install day would be the
      // add-on overwriting a working configuration.
      this.logger.debug("TimelineScheduler: no schedule has ever existed, leaving the unit alone");
      this.safeStateApplied = false;
      return null;
    }

    const values = this.buildSafeStateValues(currentUnitId);
    if (Object.keys(values).length === 0) {
      this.logger.warn(
        { unitId: currentUnitId },
        "TimelineScheduler: safe state has nothing to write for this unit",
      );
      this.safeStateApplied = false;
      return null;
    }

    // Written on entry into the no-event condition and not re-asserted after
    // that: applyEventValues writes on every tick, and an automatic low state
    // that reappears ten seconds after every manual adjustment is indisting-
    // uishable, to the user, from broken hardware. The flag re-arms as soon as
    // any other source applies, so leaving and re-entering writes it again.
    const alreadyApplied = this.safeStateApplied;
    this.safeStateApplied = true;

    if (alreadyApplied) {
      this.logger.debug(
        { unitId: currentUnitId },
        "TimelineScheduler: safe state already applied, leaving the unit alone",
      );
      return {
        hruConfig: null,
        luftatorConfig: null,
        source: "fallback",
        friendlyModeName: undefined,
        scriptEntityIds: [],
        activationToken: "fallback|safe-state",
      };
    }

    this.logger.warn(
      { unitId: currentUnitId, values },
      "TimelineScheduler: active season has no applicable event, applying safe state",
    );

    return {
      hruConfig: { variables: values },
      luftatorConfig: null,
      source: "fallback",
      friendlyModeName: undefined,
      scriptEntityIds: [],
      activationToken: "fallback|safe-state",
    };
  }

  /** True once seasons are in play, i.e. the feature has been switched on. */
  private isSeasonsFeatureEnabled(enabledSeasons: Season[]): boolean {
    return enabledSeasons.length > 1 || getAppSetting(SEASONS_ENABLED_KEY) === "true";
  }

  private hasEverHadEnabledEvent(): boolean {
    try {
      return getTimelineEvents(this.getCurrentUnitId()).some((event) => event.enabled);
    } catch {
      return false;
    }
  }

  /**
   * Every numeric HRU variable at its declared minimum, with the temperature
   * setpoint at a sane default clamped into range. Valves are deliberately
   * untouched: they are a separate physical system and a user may have
   * positioned them on purpose.
   */
  private buildSafeStateValues(currentUnitId: string | undefined): HruWritePayload {
    const values: HruWritePayload = {};
    const unit = this.hruService
      .getAllUnits()
      .find((candidate) => candidate.id === currentUnitId) as
      | {
          variables?: Array<{
            name: string;
            type: string;
            editable: boolean;
            min?: number;
            max?: number;
          }>;
        }
      | undefined;

    for (const variable of unit?.variables ?? []) {
      if (variable.type !== "number" || !variable.editable) continue;
      if (variable.name === "temperature") {
        // Clamp into the declared range, but an absent bound must not become
        // the default itself: with `max ?? 20`, a unit declaring min 22 and no
        // max was driven to 20, below its own minimum, and the write rejected.
        const min = variable.min ?? Number.NEGATIVE_INFINITY;
        const max = variable.max ?? Number.POSITIVE_INFINITY;
        values.temperature = Math.min(Math.max(SAFE_STATE_TEMPERATURE_C, min), max);
        continue;
      }
      if (variable.min !== undefined) {
        values[variable.name] = variable.min;
      }
    }
    return values;
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
      const modes = getTimelineModes(currentUnitId, getActiveSeasonId(currentUnitId ?? null));
      const mode = modes.find((m) => m.id === override.modeId);
      if (!mode) {
        this.logger.warn(
          { modeId: override.modeId },
          "TimelineScheduler: boost mode not found, skipping",
        );
        this.settingsRepo.setTimelineOverride(null);
        return undefined;
      }

      // Values frozen at boost start win over a live lookup, so a boost that
      // crosses a season boundary keeps the behaviour it began with instead of
      // silently switching to the new season's values mid-run. An override
      // written by an older build carries no snapshot and resolves live.
      const frozen = override.customConfig;

      // A mode with no values for the active season would build an empty
      // payload: the write would be skipped while the dashboard still claimed a
      // boost was running. Refuse loudly instead - but only when there is no
      // snapshot to fall back on. A boost that started in a season where the
      // mode WAS configured keeps running on the values it captured, even once
      // a boundary moves it into a season where the mode has none; cancelling
      // it there would end the boost early for a reason the user never sees.
      if (!frozen && mode.configured === false) {
        this.logger.error(
          { modeId: override.modeId, mode: mode.name },
          "TimelineScheduler: boost mode not configured for the active season, cancelling boost",
        );
        this.settingsRepo.setTimelineOverride(null);
        return undefined;
      }

      const variables = frozen ? frozen.variables : mode.variables;
      const modeVariables = variables ?? {};
      const nativeMode =
        typeof modeVariables.mode === "number" || typeof modeVariables.mode === "string"
          ? modeVariables.mode
          : (frozen?.nativeMode ?? mode.nativeMode);

      return {
        hruConfig: {
          mode: nativeMode,
          power: frozen ? frozen.power : mode.power,
          temperature: frozen ? frozen.temperature : mode.temperature,
          variables,
        },
        luftatorConfig: frozen ? frozen.luftatorConfig : mode.luftatorConfig,
        source: "boost",
        friendlyModeName: mode.name,
        scriptEntityIds: frozen ? frozen.scriptEntityIds : mode.scriptEntityIds,
        // endTime is recomputed on every POST /boost, so re-pressing the same
        // mode yields a new token and re-runs the scripts.
        activationToken: `boost|${override.modeId}|${override.endTime}`,
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
        scriptEntityIds: override.customConfig.scriptEntityIds,
        activationToken: `test|${override.endTime}`,
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
      const modes = getTimelineModes(currentUnitId, getActiveSeasonId(currentUnitId ?? null));
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
      scriptEntityIds: foundMode?.scriptEntityIds,
      // One activation per scheduled slot; a different slot/mode re-fires.
      // Fall back to day+time when the event has no id (id-less events would
      // otherwise all collide under "undefined").
      activationToken: `schedule|${event.timelineId ?? "none"}|${event.id ?? "x"}|${event.dayOfWeek ?? "all"}|${event.startTime}`,
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

  /**
   * Runs the HA scripts attached to the activated mode via `script.turn_on`.
   * Fires once per real activation, keyed on a per-activation token that is
   * persisted, so it does NOT re-fire on every 10s re-tick nor on a process
   * re-tick, but DOES re-fire when the user re-triggers the mode (a new token)
   * and after an add-on restart (the in-memory key resets). Runs on activation
   * transition regardless of the HRU/valve write result, since the scripts
   * drive separate hardware that must follow the scene even if the ventilation
   * write fails.
   */
  private maybeRunActivationScripts(activePayload: ActivePayload, source: TimelineSource): void {
    // Key on the activation instance only (not the script list): editing a
    // mode's scripts mid-activation must not re-run them until re-activation.
    const activationKey = activePayload.activationToken ?? source;
    if (activationKey === this.lastScriptActivationKey) {
      return;
    }
    // Record this activation as the new baseline BEFORE the empty-scripts check.
    // Even a scriptless activation (e.g. a plain boost) must consume the dedup
    // slot, otherwise returning from it to a scripted plan whose token equals
    // the pre-boost baseline would be wrongly suppressed and never re-fire.
    // Setting before firing also stops a concurrent re-tick from double-firing.
    this.lastScriptActivationKey = activationKey;

    const scripts = activePayload.scriptEntityIds ?? [];
    if (scripts.length === 0) {
      return;
    }

    if (!this.haClient) {
      this.logger.warn(
        { scripts },
        "TimelineScheduler: cannot run activation scripts, no Home Assistant client",
      );
      return;
    }

    this.logger.info(
      { scripts, source, mode: activePayload.friendlyModeName },
      "TimelineScheduler: running activation scripts",
    );
    void this.haClient.callService("script", "turn_on", { entity_id: scripts }).catch((err) => {
      this.logger.error({ err, scripts }, "TimelineScheduler: activation script.turn_on failed");
    });
  }

  private async applyEventValues(
    activePayload: ActivePayload,
    throwOnApplyError = false,
  ): Promise<void> {
    const { hruConfig, luftatorConfig, source, id } = activePayload;
    let firstApplyError: Error | null = null;

    // Anything else taking over re-arms the safe state, so entering the
    // no-event condition again writes it rather than assuming it still holds.
    if (source !== "fallback") {
      this.safeStateApplied = false;
    }

    let modeName: ModeValue;
    if (source === "boost" || source === "schedule") {
      modeName = activePayload.friendlyModeName || hruConfig?.mode;
      this.logger.info(
        { source, id, modeName, hruConfig },
        "TimelineScheduler: resolved friendly mode name",
      );
    }

    // Fire on the activation transition itself, independent of the HRU/valve
    // apply below: the scripts drive separate hardware that must follow the
    // scene even if the ventilation write fails. Deduped once-per-activation.
    this.maybeRunActivationScripts(activePayload, source);

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
