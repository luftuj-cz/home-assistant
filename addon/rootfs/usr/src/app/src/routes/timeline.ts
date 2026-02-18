import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import {
  getAppSetting,
  setAppSetting,
  getTimelineEvents,
  upsertTimelineEvent,
  deleteTimelineEvent,
  deleteTimelineEventsByMode,
  getTimelineModes,
  getTimelineMode,
  upsertTimelineMode,
  deleteTimelineMode,
  assignLegacyEventsToUnit,
} from "../services/database";
import {
  TIMELINE_OVERRIDE_KEY,
  HRU_SETTINGS_KEY,
  type TimelineMode,
  type TimelineOverride,
  type HruSettings,
} from "../types";

import type { TimelineScheduler } from "../services/timelineScheduler";
import type { HruService } from "../features/hru/hru.service";
import type { MqttService } from "../services/mqttService";
import { validateRequest } from "../middleware/validateRequest";
import {
  timelineModeInputSchema,
  timelineEventInputSchema,
  boostOverrideInputSchema,
  testOverrideInputSchema,
  type TimelineModeInput,
  type TimelineEventInput,
  type TestOverrideInput,
} from "../schemas/timeline";
import {
  ApiError,
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../shared/errors/apiErrors";

export function createTimelineRouter(
  logger: Logger,
  timelineScheduler: TimelineScheduler,
  hruService: HruService,
  mqttService: MqttService,
) {
  const router = Router();

  function getCurrentUnitId(unitIdOverride?: string): string | null {
    try {
      if (unitIdOverride) return unitIdOverride;

      const raw = getAppSetting(HRU_SETTINGS_KEY);
      const settings = raw ? (JSON.parse(raw) as HruSettings) : null;
      if (settings?.unit) return settings.unit;

      // Fallback to first available unit if none selected, matches frontend fallback
      const units = hruService.getAllUnits();
      return units[0]?.id || null;
    } catch {
      return null;
    }
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

    return true;
  }

  router.get("/modes", (request: Request, response: Response) => {
    const currentUnitId = getCurrentUnitId(request.query.unitId as string) || "";
    // Pass unit ID to DB fetching so we get global AND unit specific modes
    const allModes = getTimelineModes(currentUnitId);

    // Migration logic removed from GET - migration is now handled by DB service on startup
    // We just return filtered modes
    const filteredModes = allModes.filter((m) => m.hruId === currentUnitId || !m.hruId);
    logger.debug(
      { count: filteredModes.length, unitId: currentUnitId },
      "Retrieved timeline modes",
    );
    response.json({ modes: filteredModes });
  });

  router.post(
    "/modes",
    validateRequest(timelineModeInputSchema),
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const payload = request.body as TimelineModeInput;
        const currentUnitId = getCurrentUnitId();

        // Validate against HRU max power
        if (!validatePowerAndValves(payload, response)) {
          return;
        }

        const newMode: TimelineMode = {
          // ID is auto-generated by DB if creating
          id: 0, // Placeholder, DB ignores/overwrites
          name: payload.name,
          color: payload.color,
          power: payload.power,
          temperature: payload.temperature,
          luftatorConfig: payload.luftatorConfig,
          isBoost: payload.isBoost ?? false,
          hruId: currentUnitId || "",
          nativeMode: payload.nativeMode,
        };

        // We need to pass undefined ID for creation, but type expects number.
        // upsertTimelineMode handles null/undefined ID for creation logic.
        const created = upsertTimelineMode({ ...newMode, id: undefined as unknown as number });

        // Trigger MQTT discovery refresh to publish new boost buttons if needed
        mqttService.refreshDiscovery().catch((error) => {
          logger.warn({ error }, "Failed to refresh MQTT discovery after mode creation");
        });

        logger.info({ id: created.id, name: created.name }, "Timeline mode created");
        response.status(201).json(created);
      } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
          return next(
            new ConflictError("Mode name already exists for this unit", "DUPLICATE_MODE_NAME"),
          );
        }
        logger.error({ error }, "Failed to create timeline mode");
        next(error);
      }
    },
  );

  router.put(
    "/modes/:id",
    validateRequest(timelineModeInputSchema),
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const id = Number.parseInt(request.params.id as string, 10);
        if (!Number.isFinite(id)) {
          return next(new BadRequestError("Invalid mode id", "INVALID_MODE_ID"));
        }
        const payload = request.body as TimelineModeInput;

        // Validate against HRU max power
        if (!validatePowerAndValves(payload, response)) {
          return;
        }

        const original = getTimelineMode(id);
        if (!original) {
          return next(new NotFoundError("Mode not found", "MODE_NOT_FOUND"));
        }

        const updated: TimelineMode = {
          id: id,
          name: payload.name,
          color: payload.color,
          power: payload.power,
          temperature: payload.temperature,
          luftatorConfig: payload.luftatorConfig,
          isBoost: payload.isBoost ?? false,
          hruId: original.hruId || getCurrentUnitId() || "",
          nativeMode: payload.nativeMode,
        };

        const saved = upsertTimelineMode(updated);

        // Trigger MQTT discovery refresh to update boost buttons
        mqttService.refreshDiscovery().catch((error) => {
          logger.warn({ error }, "Failed to refresh MQTT discovery after mode update");
        });

        logger.info({ id: saved.id, name: saved.name }, "Timeline mode updated");
        response.json(saved);
      } catch (error) {
        if (error instanceof ApiError) return next(error);
        if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
          return next(
            new ConflictError("Mode name already exists for this unit", "DUPLICATE_MODE_NAME"),
          );
        }
        logger.error({ error }, "Failed to update timeline mode");
        next(error);
      }
    },
  );

  router.delete("/modes/:id", (request: Request, response: Response, next: NextFunction) => {
    try {
      const id = Number.parseInt(request.params.id as string, 10);
      if (!Number.isFinite(id)) {
        return next(new BadRequestError("Invalid mode id", "INVALID_MODE_ID"));
      }

      try {
        // Cascade: delete events using this mode
        deleteTimelineEventsByMode(id);
      } catch (error) {
        logger.error({ error, id }, "Failed to delete associated timeline events");
      }

      // Cascade: clear boost if it uses this mode
      try {
        const rawOverride = getAppSetting(TIMELINE_OVERRIDE_KEY);
        if (rawOverride && rawOverride !== "null") {
          const override = JSON.parse(rawOverride) as TimelineOverride;
          if (override?.modeId === id) {
            setAppSetting(TIMELINE_OVERRIDE_KEY, "null");
            logger.info({ id }, "Cleared active boost because its mode was deleted");
          }
        }
      } catch (error) {
        logger.warn({ error }, "Failed to check/clear boost during mode deletion");
      }

      deleteTimelineMode(id);

      // Trigger MQTT discovery refresh to remove buttons for deleted mode
      mqttService.refreshDiscovery().catch((error) => {
        logger.warn({ error }, "Failed to refresh MQTT discovery after mode deletion");
      });

      logger.info({ id }, "Timeline mode deleted");
      response.status(204).send();
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      logger.error({ error }, "Failed to delete timeline mode");
      next(error);
    }
  });

  // Timeline Events
  router.get("/events", (request: Request, response: Response, next: NextFunction) => {
    try {
      const hruId = getCurrentUnitId(request.query.unitId as string);
      if (hruId) {
        // Adopt legacy events if any exist (lazy migration)
        try {
          assignLegacyEventsToUnit(hruId);
        } catch (error) {
          logger.warn({ error }, "Failed to assign legacy events during fetch");
        }
      }

      const events = getTimelineEvents(hruId);

      // Self-healing: purge orphaned events (referencing non-existent modes)
      const modes = getTimelineModes(hruId || undefined);
      const modeIds = new Set(modes.map((m) => m.id));
      const orphanedIds = events
        .filter((e) => {
          const hruConfig = e.hruConfig as { mode?: number | string } | null;
          const modeId = hruConfig?.mode;
          if (modeId === undefined) return false;
          return !modeIds.has(Number(modeId));
        })
        .filter((e) => typeof e.id === "number")
        .map((e) => e.id as number);

      if (orphanedIds.length > 0) {
        logger.info({ count: orphanedIds.length }, "Purging orphaned timeline events");
        for (const id of orphanedIds) {
          try {
            deleteTimelineEvent(id);
          } catch (error) {
            logger.warn({ error, id }, "Failed to purge orphaned event");
          }
        }
        // Return filtered list to UI immediately
        const orphanSet = new Set(orphanedIds);
        response.json(events.filter((e) => e.id === undefined || !orphanSet.has(e.id as number)));
      } else {
        logger.debug({ count: events.length }, "Retrieved timeline events");
        response.json(events);
      }
    } catch (error) {
      logger.error({ error }, "Failed to get timeline events");
      next(error);
    }
  });

  router.post(
    "/events",
    validateRequest(timelineEventInputSchema),
    (request: Request, response: Response, next: NextFunction) => {
      try {
        const body = request.body as TimelineEventInput;

        // Validate HRU config against max power
        const maxPower = getHruMaxPower();
        if (body.hruConfig?.power !== undefined && body.hruConfig.power > maxPower) {
          return next(
            new BadRequestError(
              `Power must be between 0 and ${maxPower}`,
              "POWER_LIMIT_EXCEEDED",
            ),
          );
        }

        const hruId = getCurrentUnitId(request.query.unitId as string);
        const event = upsertTimelineEvent({
          id: body.id,
          startTime: body.startTime,
          dayOfWeek: body.dayOfWeek,
          hruConfig: body.hruConfig,
          luftatorConfig: body.luftatorConfig,
          enabled: body.enabled ?? true,
          priority: body.priority ?? 0,
          hruId: hruId,
        });
        logger.info(
          { id: event.id, day: event.dayOfWeek, time: event.startTime },
          "Timeline event saved",
        );
        response.json(event);
      } catch (error) {
        if (error instanceof ApiError) return next(error);
        logger.error({ error }, "Failed to save timeline event");
        next(error);
      }
    },
  );

  router.delete("/events/:id", (request: Request, response: Response, next: NextFunction) => {
    try {
      const id = Number.parseInt(request.params.id as string, 10);
      if (!Number.isFinite(id)) {
        return next(new BadRequestError("Invalid event ID", "INVALID_EVENT_ID"));
      }

      deleteTimelineEvent(id);
      logger.info({ id }, "Timeline event deleted");
      response.status(204).end();
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      logger.error({ error }, "Failed to delete timeline event");
      next(error);
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
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const { modeId, durationMinutes } = request.body as {
          modeId: number;
          durationMinutes: number;
        };

        const unitId = request.query.unitId as string | undefined;
        const hruId = getCurrentUnitId(unitId);

        const modes = getTimelineModes(hruId || undefined);
        const mode = modes.find((m) => m.id === modeId);
        if (!mode) return next(new NotFoundError("Mode not found", "MODE_NOT_FOUND"));

        const endTime = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
        const override: TimelineOverride = { modeId, endTime, durationMinutes };

        setAppSetting(TIMELINE_OVERRIDE_KEY, JSON.stringify(override));
        logger.info({ modeId, durationMinutes, endTime }, "Timeline boost activated");

        // Trigger immediate execution
        await timelineScheduler.executeScheduledEvent();

        response.json({ active: override });
      } catch (error) {
        if (error instanceof ApiError) return next(error);
        logger.error({ error }, "Failed to activate boost");
        next(error);
      }
    },
  );

  router.delete("/boost", async (_request: Request, response: Response, next: NextFunction) => {
    try {
      setAppSetting(TIMELINE_OVERRIDE_KEY, "null");
      logger.info("Timeline boost cancelled");

      // Trigger immediate execution
      await timelineScheduler.executeScheduledEvent();

      response.status(204).end();
    } catch (error) {
      logger.error({ error }, "Failed to cancel boost");
      next(error);
    }
  });

  router.post(
    "/test",
    validateRequest(testOverrideInputSchema),
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const { durationMinutes, config } = request.body as TestOverrideInput;

        // Validate max power just like regular creation
        if (!validatePowerAndValves(config, response)) {
          return;
        }

        // Add 5s buffer to account for network latency and timer drift
        // This ensures the frontend timer finishes (reverting UI) before the backend actually reverts the mode
        const endTime = new Date(Date.now() + durationMinutes * 60 * 1000 + 5000).toISOString();
        const override: TimelineOverride = {
          modeId: undefined,
          customConfig: {
            nativeMode: config.nativeMode,
            power: config.power,
            temperature: config.temperature,
            luftatorConfig: config.luftatorConfig,
          },
          endTime,
          durationMinutes,
        };

        setAppSetting(TIMELINE_OVERRIDE_KEY, JSON.stringify(override));
        logger.info({ durationMinutes, endTime }, "Timeline test mode activated");

        // Trigger immediate execution
        await timelineScheduler.executeScheduledEvent();

        response.json({ active: override });
      } catch (error) {
        logger.error({ error }, "Failed to activate test mode");
        next(error);
      }
    },
  );

  return router;
}
