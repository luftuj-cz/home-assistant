import type { Logger } from "pino";
import type { ValveController } from "../core/valveManager";
import { getTimelineEvents, getAppSetting, setAppSetting } from "./database";
import { SettingsRepository } from "../features/settings/settings.repository";
import type { HruService } from "../features/hru/hru.service";
import {
  TIMELINE_MODES_KEY,
  TIMELINE_OVERRIDE_KEY,
  type TimelineMode,
  type TimelineOverride,
} from "../types";

export interface ActiveState {
  source: "manual" | "schedule" | "boost";
  modeName?: string;
}

export class TimelineScheduler {
  private schedulerTimer: NodeJS.Timeout | null = null;
  private readonly settingsRepo = new SettingsRepository();
  private lastActiveState: ActiveState | null = null;

  constructor(
    private readonly valveManager: ValveController,
    private readonly hruService: HruService,
    private readonly logger: Logger,
  ) {}

  public start(): void {
    // Run immediately on startup then align to minute boundary
    void this.executeScheduledEvent().finally(() => this.scheduleNextTick());
  }

  public stop(): void {
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  private mapTodayToTimelineDay(): number {
    // UI uses Monday = 0 ... Sunday = 6
    const jsDay = new Date().getDay(); // Sunday = 0
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

  private pickActiveEvent(): ReturnType<typeof getTimelineEvents>[number] | null {
    const nowMinutes = this.timeToMinutes(
      `${new Date().getHours().toString().padStart(2, "0")}:${new Date().getMinutes().toString().padStart(2, "0")}`,
    );
    const today = this.mapTodayToTimelineDay();
    const allEvents = getTimelineEvents();

    // Check today, then yesterday, then the day before... up to 7 days
    for (let d = 0; d < 7; d++) {
      const targetDay = (today - d + 7) % 7;
      const dayCandidates = allEvents.filter(
        (e) => e.enabled && (e.dayOfWeek === null || e.dayOfWeek === targetDay),
      );

      let filtered = dayCandidates;
      if (d === 0) {
        // For today, only consider events that have already started
        filtered = dayCandidates.filter((e) => this.timeToMinutes(e.startTime) <= nowMinutes);
      }

      if (filtered.length > 0) {
        // Pick latest start time on this specific day, then highest priority
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

  public async executeScheduledEvent(): Promise<void> {
    const overrideRaw = getAppSetting(TIMELINE_OVERRIDE_KEY);
    let activePayload: {
      hruConfig?: { mode?: string; power?: number; temperature?: number } | null;
      luftatorConfig?: Record<string, number> | null;
      source: "manual" | "schedule" | "boost";
      id?: number;
    } | null = null;

    if (overrideRaw) {
      try {
        const override = JSON.parse(overrideRaw) as TimelineOverride;
        if (override && new Date(override.endTime) > new Date()) {
          const modesRaw = getAppSetting(TIMELINE_MODES_KEY);
          const modes = modesRaw ? (JSON.parse(modesRaw) as TimelineMode[]) : [];
          const mode = modes.find((m) => m.id === override.modeId);
          if (mode) {
            activePayload = {
              hruConfig: {
                mode: mode.name,
                power: mode.power,
                temperature: mode.temperature,
              },
              luftatorConfig: mode.luftatorConfig,
              source: "boost",
            };
          }
        } else if (override) {
          // Expired
          setAppSetting(TIMELINE_OVERRIDE_KEY, "null");
        }
      } catch (err) {
        this.logger.warn({ err }, "TimelineScheduler: failed to parse boost override");
      }
    }

    if (!activePayload) {
      const event = this.pickActiveEvent();
      if (event) {
        // Look up the mode name if hruConfig.mode contains an ID
        let displayModeName = event.hruConfig?.mode;

        // If mode looks like a number (mode ID), try to look up the actual mode name
        if (displayModeName && /^\d+$/.test(displayModeName)) {
          try {
            const modesRaw = getAppSetting(TIMELINE_MODES_KEY);
            if (modesRaw) {
              const modes = JSON.parse(modesRaw) as TimelineMode[];
              const modeId = parseInt(displayModeName, 10);
              const foundMode = modes.find((m) => m.id === modeId);
              if (foundMode) {
                displayModeName = foundMode.name;
              }
            }
          } catch {
            // If lookup fails, use the original value
          }
        }

        activePayload = {
          hruConfig: event.hruConfig
            ? {
                ...event.hruConfig,
                mode: displayModeName,
              }
            : event.hruConfig,
          luftatorConfig: event.luftatorConfig,
          source: "schedule",
          id: event.id,
        };
      }
    }

    if (!activePayload) {
      this.logger.debug("TimelineScheduler: no active event or boost for current time");
      this.lastActiveState = { source: "manual" };
      return;
    }

    const { hruConfig, luftatorConfig, source, id } = activePayload;

    // Extract mode name for display
    let modeName: string | undefined;
    if (source === "boost" || source === "schedule") {
      modeName = hruConfig?.mode;
      this.logger.info(
        { source, id, modeName, hruConfig },
        "TimelineScheduler: extracted mode name",
      );
    }

    // Update active state
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
      },
      "TimelineScheduler: applying active state",
    );

    if (hasValves && luftatorConfig) {
      for (const [entityId, opening] of Object.entries(luftatorConfig)) {
        if (opening === undefined || opening === null) continue;
        try {
          await this.valveManager.setValue(entityId, opening);
        } catch (err) {
          this.logger.warn(
            { entityId, err, source },
            "Failed to apply valve opening from timeline scheduler",
          );
        }
      }
    }

    // Apply HRU settings
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
  }

  private scheduleNextTick(): void {
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
    }
    // Run every 30 seconds for more responsive boost expiration and schedule transitions
    this.schedulerTimer = setTimeout(() => {
      void this.executeScheduledEvent().finally(() => {
        this.scheduleNextTick();
      });
    }, 30_000);
  }
}
