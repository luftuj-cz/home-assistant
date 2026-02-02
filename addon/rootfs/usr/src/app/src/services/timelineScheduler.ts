import type { Logger } from "pino";
import type { ValveController } from "../core/valveManager";
import { getTimelineEvents, getAppSetting, setAppSetting } from "./database";
import { withTempModbusClient } from "../shared/modbus/client";
import { SettingsRepository } from "../features/settings/settings.repository";
import { getUnitById } from "../features/hru/hru.definitions";
import { applyWriteDefinition, resolveModeValue } from "../utils/hruWrite";
import {
  TIMELINE_MODES_KEY,
  TIMELINE_OVERRIDE_KEY,
  type TimelineMode,
  type TimelineOverride,
} from "../types";

export class TimelineScheduler {
  private schedulerTimer: NodeJS.Timeout | null = null;
  private readonly settingsRepo = new SettingsRepository();

  constructor(
    private readonly valveManager: ValveController,
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
    const events = getTimelineEvents();

    const candidates = events
      .filter((e) => e.enabled && (e.dayOfWeek ?? today) === today)
      .filter(
        (e) =>
          this.timeToMinutes(e.startTime) <= nowMinutes &&
          nowMinutes < this.timeToMinutes(e.endTime),
      );

    this.logger.debug(
      { today, nowMinutes, candidates: candidates.length },
      "TimelineScheduler: candidate events for current time",
    );

    if (candidates.length === 0) return null;

    // Highest priority, then latest start time
    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return this.timeToMinutes(b.startTime) - this.timeToMinutes(a.startTime);
    });

    return candidates[0] ?? null;
  }

  public async executeScheduledEvent(): Promise<void> {
    const overrideRaw = getAppSetting(TIMELINE_OVERRIDE_KEY);
    let activePayload: {
      hruConfig?: { mode?: string; power?: number; temperature?: number } | null;
      luftatorConfig?: Record<string, number> | null;
      source: string;
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
        activePayload = {
          hruConfig: event.hruConfig,
          luftatorConfig: event.luftatorConfig,
          source: "schedule",
          id: event.id,
        };
      }
    }

    if (!activePayload) {
      this.logger.debug("TimelineScheduler: no active event or boost for current time");
      return;
    }

    const { hruConfig, luftatorConfig, source, id } = activePayload;
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

    // Apply HRU settings if available
    if (hasHru && hruConfig) {
      const settings = this.settingsRepo.getHruSettings();
      if (settings?.unit) {
        const def = getUnitById(settings.unit);

        if (def) {
          const { power, temperature, mode } = hruConfig;
          this.logger.info(
            {
              source,
              id,
              power,
              temperature,
              mode,
            },
            "TimelineScheduler: applying HRU settings",
          );
          try {
            await withTempModbusClient(
              { host: settings.host, port: settings.port, unitId: settings.unitId },
              this.logger,
              async (mb) => {
                if (typeof power === "number" && Number.isFinite(power)) {
                  const writeDef = def.registers.write?.power;
                  if (!writeDef) {
                    this.logger.warn(
                      "TimelineScheduler: power write not supported by HRU definition",
                    );
                  } else {
                    await applyWriteDefinition(mb, writeDef, power);
                  }
                }
                if (typeof temperature === "number" && Number.isFinite(temperature)) {
                  const writeDef = def.registers.write?.temperature;
                  if (!writeDef) {
                    this.logger.warn(
                      "TimelineScheduler: temperature write not supported by HRU definition",
                    );
                  } else {
                    await applyWriteDefinition(mb, writeDef, temperature);
                  }
                }
                if (mode !== undefined && mode !== null) {
                  const writeDef = def.registers.write?.mode;
                  if (!writeDef) {
                    this.logger.warn(
                      "TimelineScheduler: mode write not supported by HRU definition",
                    );
                  } else {
                    const rawMode = resolveModeValue(def.registers.read.mode.values, mode);
                    await applyWriteDefinition(mb, writeDef, rawMode);
                  }
                }
              },
            );
          } catch (err) {
            this.logger.warn(
              { err, source },
              "Failed to apply HRU settings from timeline scheduler",
            );
          }
        }
      }
    }
  }

  private scheduleNextTick(): void {
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
    }
    const now = new Date();
    const msUntilNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
    this.schedulerTimer = setTimeout(() => {
      void this.executeScheduledEvent().finally(() => {
        this.scheduleNextTick();
      });
    }, msUntilNextMinute);
  }
}
