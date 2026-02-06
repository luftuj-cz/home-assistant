import type { Logger } from "pino";
import type { ValveController } from "../core/valveManager";
import {
  getTimelineEvents,
  getAppSetting,
  setAppSetting,
  getTimelineModes,
  assignLegacyEventsToUnit,
  migrateLegacyEventsForUnit,
} from "./database";

import type { HruService } from "../features/hru/hru.service";
import {
  TIMELINE_OVERRIDE_KEY,
  HRU_SETTINGS_KEY,
  type TimelineOverride,
  type HruSettings,
} from "../types";

export interface ActiveState {
  source: "manual" | "schedule" | "boost";
  modeName?: string | number;
}

export class TimelineScheduler {
  private schedulerTimer: NodeJS.Timeout | null = null;
  private lastActiveState: ActiveState | null = null;

  constructor(
    private readonly valveManager: ValveController,
    private readonly hruService: HruService,
    private readonly logger: Logger,
  ) {}

  public start(): void {
    void this.executeScheduledEvent().finally(() => this.scheduleNextTick());
  }

  public stop(): void {
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  private mapTodayToTimelineDay(): number {
    const jsDay = new Date().getDay();
    return jsDay === 0 ? 6 : jsDay - 1;
  }

  private timeToMinutes(value: string): number {
    const parts = value.split(":");
    const h = Number.parseInt(parts[0] ?? "0", 10);
    const m = Number.parseInt(parts[1] ?? "0", 10);
    const hh = Number.isFinite(h) ? h : 0;
    const mm = Number.isFinite(m) ? m : 0;
    return hh * 60 + mm;
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
    } catch {
      this.logger.warn(
        "TimelineScheduler: failed to parse HRU settings, treating as global/no unit",
      );
    }
    return undefined;
  }

  private pickActiveEvent(): ReturnType<typeof getTimelineEvents>[number] | null {
    const nowMinutes = this.timeToMinutes(
      `${new Date().getHours().toString().padStart(2, "0")}:${new Date().getMinutes().toString().padStart(2, "0")}`,
    );
    const today = this.mapTodayToTimelineDay();

    // Get current HRU unit ID to scope events
    const currentUnitId = this.getCurrentUnitId();

    if (currentUnitId) {
      try {
        assignLegacyEventsToUnit(currentUnitId);
        migrateLegacyEventsForUnit(currentUnitId);
      } catch (err) {
        this.logger.warn({ err }, "TimelineScheduler: failed to migrate legacy events");
      }
    }

    const allEvents = getTimelineEvents(currentUnitId);

    for (let d = 0; d < 7; d++) {
      const targetDay = (today - d + 7) % 7;
      const dayCandidates = allEvents.filter(
        (e) => e.enabled && (e.dayOfWeek === null || e.dayOfWeek === targetDay),
      );

      const modes = getTimelineModes(currentUnitId);
      const modeIdSet = new Set(modes.map((m) => m.id));

      let filtered = dayCandidates.filter((e) => {
        const modeId = e.hruConfig?.mode;
        if (modeId && /^\d+$/.test(String(modeId))) {
          return modeIdSet.has(parseInt(String(modeId), 10));
        }
        return true;
      });

      if (d === 0) {
        filtered = filtered.filter((e) => this.timeToMinutes(e.startTime) <= nowMinutes);
      }

      if (filtered.length > 0) {
        filtered.sort((a, b) => {
          const timeA = this.timeToMinutes(a.startTime);
          const timeB = this.timeToMinutes(b.startTime);
          if (timeB !== timeA) return timeB - timeA;
          return (b.priority ?? 0) - (a.priority ?? 0);
        });
        return filtered[0] ?? null;
      }
    }

    return null;
  }

  public getActiveState(): ActiveState | null {
    return this.lastActiveState;
  }

  public getFormattedActiveMode(): string {
    const state = this.lastActiveState;
    if (!state || state.source === "manual") return "Manual";

    const prefix = state.source.charAt(0).toUpperCase() + state.source.slice(1);
    return `${prefix}: ${state.modeName || "?"}`;
  }

  public getBoostRemainingMinutes(): number {
    const overrideRaw = getAppSetting(TIMELINE_OVERRIDE_KEY);
    if (!overrideRaw) return 0;
    try {
      const override = JSON.parse(overrideRaw) as TimelineOverride;
      if (!override || !override.endTime) return 0;
      const diff = new Date(override.endTime).getTime() - Date.now();
      return Math.max(0, Math.ceil(diff / 60000));
    } catch {
      return 0;
    }
  }

  public getActiveBoostName(): string | null {
    const state = this.lastActiveState;
    if (state?.source === "boost" && state.modeName !== undefined) {
      return String(state.modeName);
    }
    return null;
  }

  public async executeScheduledEvent(): Promise<void> {
    try {
      // Periodic State Reporting
      try {
        const snapshot = await this.valveManager.getSnapshot();
        const states = snapshot.reduce(
          (acc, v) => ({ ...acc, [v.entity_id]: v.state }),
          {} as Record<string, string>,
        );
        this.logger.info({ states }, "TimelineScheduler: Current valve states");
      } catch (err) {
        this.logger.warn({ err }, "Failed to report valve states");
      }

      const overrideRaw = getAppSetting(TIMELINE_OVERRIDE_KEY);
      let activePayload: {
        hruConfig?: { mode?: string | number; power?: number; temperature?: number } | null;
        luftatorConfig?: Record<string, number> | null;
        source: "manual" | "schedule" | "boost";
        id?: number;
      } | null = null;

      if (overrideRaw) {
        try {
          const override = JSON.parse(overrideRaw) as TimelineOverride;
          if (override && new Date(override.endTime) > new Date()) {
            const currentUnitId = this.getCurrentUnitId();
            const modes = getTimelineModes(currentUnitId);
            const mode = modes.find((m) => m.id === override.modeId);
            if (mode) {
              activePayload = {
                hruConfig: {
                  mode: mode.nativeMode ?? mode.name,
                  power: mode.power,
                  temperature: mode.temperature,
                },
                luftatorConfig: mode.luftatorConfig,
                source: "boost",
              };
            } else {
              this.logger.warn(
                { modeId: override.modeId },
                "TimelineScheduler: boost mode not found, skipping",
              );
              setAppSetting(TIMELINE_OVERRIDE_KEY, "null");
            }
          } else if (override) {
            setAppSetting(TIMELINE_OVERRIDE_KEY, "null");
          }
        } catch (err) {
          this.logger.warn({ err }, "TimelineScheduler: failed to parse boost override");
        }
      }

      if (!activePayload) {
        const event = this.pickActiveEvent();
        if (event) {
          let displayModeName = event.hruConfig?.mode;
          let effectivePower = event.hruConfig?.power;
          let effectiveTemperature = event.hruConfig?.temperature;
          let effectiveLuftatorConfig = event.luftatorConfig;

          let modeToSend: string | number | undefined = event.hruConfig?.mode;
          let isValidEvent = true;

          if (displayModeName) {
            const currentUnitId = this.getCurrentUnitId();
            const modes = getTimelineModes(currentUnitId);
            let foundMode;

            if (typeof displayModeName === "number" || /^\d+$/.test(displayModeName)) {
              const modeId = parseInt(String(displayModeName), 10);
              foundMode = modes.find((m) => m.id === modeId);
            } else {
              foundMode = modes.find((m) => m.name === displayModeName);
            }

            if (foundMode) {
              displayModeName = foundMode.name;
              modeToSend = foundMode.nativeMode ?? foundMode.name;

              if (foundMode.power !== undefined) effectivePower = foundMode.power;
              if (foundMode.temperature !== undefined) effectiveTemperature = foundMode.temperature;
              if (foundMode.luftatorConfig) effectiveLuftatorConfig = foundMode.luftatorConfig;
            } else {
              isValidEvent = false;
              this.logger.warn(
                { mode: displayModeName, eventId: event.id },
                "TimelineScheduler: event mode not found, skipping",
              );
            }
          }

          if (isValidEvent) {
            activePayload = {
              hruConfig: event.hruConfig
                ? {
                    ...event.hruConfig,
                    mode: modeToSend,
                    power: effectivePower,
                    temperature: effectiveTemperature,
                  }
                : event.hruConfig,
              luftatorConfig: effectiveLuftatorConfig,
              source: "schedule",
              id: event.id,
            };
          }
        }
      }

      if (!activePayload) {
        this.logger.debug("TimelineScheduler: no active event or boost for current time");
        this.lastActiveState = { source: "manual" };
        return;
      }

      const { hruConfig, luftatorConfig, source, id } = activePayload;

      let modeName: string | number | undefined;
      if (source === "boost" || source === "schedule") {
        modeName = hruConfig?.mode;
        this.logger.info(
          { source, id, modeName, hruConfig },
          "TimelineScheduler: extracted mode name",
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
          schedulerTime: `${new Date().getHours()}:${new Date().getMinutes()}`, // Log scheduler's view of time
          activeModeName: modeName, // Log the mode name it resolved
        },
        "TimelineScheduler: applying active state",
      );

      if (hasValves && luftatorConfig) {
        for (const [entityId, opening] of Object.entries(luftatorConfig)) {
          if (opening === undefined || opening === null) continue;
          try {
            const result = await this.valveManager.setValue(entityId, opening);
            // Verification: Log success if no error thrown
            this.logger.info(
              { entityId, target: opening, actual: result.state },
              "TimelineScheduler: VERIFIED valve move command executed",
            );
          } catch (err) {
            this.logger.warn(
              { entityId, err, source },
              "TimelineScheduler: VERIFICATION FAILED - could not move valve",
            );
          }
        }
      }

      if (hasHru && hruConfig) {
        try {
          await this.hruService.writeValues({
            power: hruConfig.power,
            temperature: hruConfig.temperature,
            mode: hruConfig.mode,
          });
          this.logger.info({ source, id, hruConfig }, "TimelineScheduler: applied HRU settings");
        } catch (err) {
          this.logger.warn({ err, source }, "Failed to apply HRU settings from timeline scheduler");
        }
      }
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
}
