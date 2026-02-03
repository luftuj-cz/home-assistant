import { Router } from "express";
import type { Request, Response } from "express";
import type { Logger } from "pino";
import {
  getAppSetting,
  setAppSetting,
  getTimelineEvents,
  upsertTimelineEvent,
  deleteTimelineEvent,
} from "../services/database";
import {
  TIMELINE_MODES_KEY,
  TIMELINE_OVERRIDE_KEY,
  HRU_SETTINGS_KEY,
  type TimelineMode,
  type TimelineOverride,
  type HruSettings,
} from "../types";

import type { TimelineScheduler } from "../services/timelineScheduler";
import type { HruService } from "../features/hru/hru.service";
import { validateRequest } from "../middleware/validateRequest";
import {
  timelineModeInputSchema,
  timelineEventInputSchema,
  boostOverrideInputSchema,
  type TimelineModeInput,
  type TimelineEventInput,
} from "../schemas/timeline";

export function createTimelineRouter(
  logger: Logger,
  timelineScheduler: TimelineScheduler,
  hruService: HruService,
) {
  const router = Router();

  function getTimelineModes(): TimelineMode[] {
    const raw = getAppSetting(TIMELINE_MODES_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(String(raw)) as TimelineMode[];
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }

  function saveTimelineModes(modes: TimelineMode[]) {
    setAppSetting(TIMELINE_MODES_KEY, JSON.stringify(modes));
  }

  function getHruMaxPower(): number {
    try {
      // Get current HRU settings to find which unit is selected
      const settingsRaw = getAppSetting(HRU_SETTINGS_KEY);
      if (!settingsRaw) {
        logger.warn("No HRU settings found, using default max power 100");
        return 100;
      }

      const settings = JSON.parse(String(settingsRaw)) as HruSettings;
      const unitId = settings.unit;

      if (!unitId) {
        logger.warn("No unit ID in HRU settings, using default max power 100");
        return 100;
      }

      // Get the unit definition from HRU service
      const units = hruService.getAllUnits();
      const currentUnit = units.find((u) => u.id === unitId);

      if (!currentUnit) {
        logger.warn({ unitId }, "Unit not found in HRU service, using default max power 100");
        return 100;
      }

      // Use maxPower override if unit is configurable, otherwise use unit's maxValue
      const maxPower =
        currentUnit.isConfigurable && settings.maxPower
          ? settings.maxPower
          : currentUnit.maxValue || 100;

      logger.info(
        {
          unitId,
          unitMaxValue: currentUnit.maxValue,
          settingsMaxPower: settings.maxPower,
          isConfigurable: currentUnit.isConfigurable,
          finalMaxPower: maxPower,
        },
        "Retrieved HRU max power for validation",
      );

      return maxPower;
    } catch (error) {
      logger.warn({ error }, "Failed to get HRU max power, using default");
      return 100;
    }
  }

  function validatePowerAndValves(payload: TimelineModeInput, response: Response): boolean {
    const maxPower = getHruMaxPower();

    logger.info(
      { maxPower, payloadPower: payload.power, valves: payload.luftatorConfig },
      "Validating timeline mode power and valves",
    );

    if (payload.power !== undefined && payload.power > maxPower) {
      response.status(400).json({
        detail: `Power must be between 0 and ${maxPower}`,
      });
      return false;
    }

    if (payload.luftatorConfig) {
      for (const [valve, value] of Object.entries(payload.luftatorConfig)) {
        if (value > maxPower) {
          response.status(400).json({
            detail: `Valve ${valve} opening must be between 0 and ${maxPower}`,
          });
          return false;
        }
      }
    }

    return true;
  }

  // Timeline Modes
  router.get("/modes", (_request: Request, response: Response) => {
    response.json({ modes: getTimelineModes() });
  });

  router.post(
    "/modes",
    validateRequest(timelineModeInputSchema),
    (request: Request, response: Response) => {
      const payload = request.body as TimelineModeInput;

      // Validate against HRU max power
      if (!validatePowerAndValves(payload, response)) {
        return;
      }

      const modes = getTimelineModes();
      const nextId = modes.reduce((acc, m) => Math.max(acc, m.id), 0) + 1;
      const newMode: TimelineMode = {
        id: nextId,
        name: payload.name,
        color: payload.color,
        power: payload.power,
        temperature: payload.temperature,
        luftatorConfig: payload.luftatorConfig,
        isBoost: payload.isBoost ?? false,
      };
      modes.push(newMode);
      saveTimelineModes(modes);
      response.status(201).json(newMode);
    },
  );

  router.put(
    "/modes/:id",
    validateRequest(timelineModeInputSchema),
    (request: Request, response: Response) => {
      const id = Number.parseInt(request.params.id as string, 10);
      if (!Number.isFinite(id)) {
        response.status(400).json({ detail: "Invalid mode id" });
        return;
      }
      const payload = request.body as TimelineModeInput;

      // Validate against HRU max power
      if (!validatePowerAndValves(payload, response)) {
        return;
      }

      const modes = getTimelineModes();
      const idx = modes.findIndex((m) => m.id === id);
      if (idx === -1) {
        response.status(404).json({ detail: "Mode not found" });
        return;
      }
      const baseMode = modes[idx];
      if (!baseMode) {
        response.status(404).json({ detail: "Mode not found" });
        return;
      }
      const updated: TimelineMode = {
        ...baseMode,
        id: baseMode.id,
        name: payload.name,
        color: payload.color,
        power: payload.power,
        temperature: payload.temperature,
        luftatorConfig: payload.luftatorConfig,
        isBoost: payload.isBoost ?? false,
      };
      modes[idx] = updated;
      saveTimelineModes(modes);
      response.json(updated);
    },
  );

  router.delete("/modes/:id", (request: Request, response: Response) => {
    const id = Number.parseInt(request.params.id as string, 10);
    if (!Number.isFinite(id)) {
      response.status(400).json({ detail: "Invalid mode id" });
      return;
    }
    const modes = getTimelineModes();
    const filtered = modes.filter((m) => m.id !== id);
    if (filtered.length === modes.length) {
      response.status(404).json({ detail: "Mode not found" });
      return;
    }
    saveTimelineModes(filtered);
    response.status(204).end();
  });

  // Timeline Events
  router.get("/events", (_request: Request, response: Response) => {
    try {
      const events = getTimelineEvents();
      response.json(events);
    } catch (error) {
      logger.warn({ error }, "Failed to get timeline events");
      response.status(500).json({ detail: "Failed to retrieve timeline events" });
    }
  });

  router.post(
    "/events",
    validateRequest(timelineEventInputSchema),
    (request: Request, response: Response) => {
      const body = request.body as TimelineEventInput;

      // Validate HRU config against max power
      const maxPower = getHruMaxPower();
      if (body.hruConfig?.power !== undefined && body.hruConfig.power > maxPower) {
        response.status(400).json({
          detail: `Power must be between 0 and ${maxPower}`,
        });
        return;
      }

      // Validate luftator config against max power
      if (body.luftatorConfig) {
        for (const [valve, value] of Object.entries(body.luftatorConfig)) {
          if (value > maxPower) {
            response.status(400).json({
              detail: `Valve ${valve} opening must be between 0 and ${maxPower}`,
            });
            return;
          }
        }
      }

      try {
        const event = upsertTimelineEvent({
          id: body.id,
          startTime: body.startTime,
          endTime: body.endTime,
          dayOfWeek: body.dayOfWeek,
          hruConfig: body.hruConfig,
          luftatorConfig: body.luftatorConfig,
          enabled: body.enabled ?? true,
          priority: body.priority ?? 0,
        });
        response.json(event);
      } catch (error) {
        logger.warn({ error }, "Failed to save timeline event");
        response.status(500).json({ detail: "Failed to save timeline event" });
      }
    },
  );

  router.delete("/events/:id", (request: Request, response: Response) => {
    const id = Number.parseInt(request.params.id as string, 10);
    if (!Number.isFinite(id)) {
      response.status(400).json({ detail: "Invalid event ID" });
      return;
    }

    try {
      deleteTimelineEvent(id);
      response.status(204).end();
    } catch (error) {
      logger.warn({ error, id }, "Failed to delete timeline event");
      response.status(500).json({ detail: "Failed to delete timeline event" });
    }
  });

  // Boost Overrides
  router.get("/boost", (_request: Request, response: Response) => {
    const raw = getAppSetting(TIMELINE_OVERRIDE_KEY);
    if (!raw) return response.json({ active: null });
    try {
      const parsed = JSON.parse(raw) as TimelineOverride;
      // Filter out expired boosts
      if (parsed && new Date(parsed.endTime) < new Date()) {
        setAppSetting(TIMELINE_OVERRIDE_KEY, "null");
        return response.json({ active: null });
      }
      response.json({ active: parsed });
    } catch {
      response.json({ active: null });
    }
  });

  router.post(
    "/boost",
    validateRequest(boostOverrideInputSchema),
    async (request: Request, response: Response) => {
      const { modeId, durationMinutes } = request.body as {
        modeId: number;
        durationMinutes: number;
      };

      const modes = getTimelineModes();
      const mode = modes.find((m) => m.id === modeId);
      if (!mode) return response.status(404).json({ detail: "Mode not found" });

      const endTime = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
      const override: TimelineOverride = { modeId, endTime, durationMinutes };

      setAppSetting(TIMELINE_OVERRIDE_KEY, JSON.stringify(override));
      logger.info({ modeId, durationMinutes, endTime }, "Timeline boost activated");

      // Trigger immediate execution
      await timelineScheduler.executeScheduledEvent();

      response.json({ active: override });
    },
  );

  router.delete("/boost", async (_request: Request, response: Response) => {
    setAppSetting(TIMELINE_OVERRIDE_KEY, "null");
    logger.info("Timeline boost cancelled");

    // Trigger immediate execution
    await timelineScheduler.executeScheduledEvent();

    response.status(204).end();
  });

  return router;
}
