import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "pino";
import {
  assignLegacyEventsToUnit,
  deleteTimelineEvent,
  deleteTimelineEventsByMode,
  deleteTimelineMode,
  getAppSetting,
  getTimelineEvents,
  getTimelineMode,
  getTimelineModes,
  setAppSetting,
  upsertTimelineEvent,
  upsertTimelineMode,
} from "../services/database.js";
import {
  HRU_SETTINGS_KEY,
  type HruSettings,
  TIMELINE_OVERRIDE_KEY,
  type TimelineMode,
  type TimelineOverride,
} from "../types/index.js";

import type { TimelineScheduler } from "../services/timelineScheduler.js";
import type { HruService } from "../features/hru/hru.service.js";
import type { MqttService } from "../services/mqttService.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  type BoostOverrideInput,
  boostOverrideInputSchema,
  type TestOverrideInput,
  testOverrideInputSchema,
  type TimelineEventInput,
  timelineEventInputSchema,
  type TimelineModeInput,
  timelineModeInputSchema,
} from "../schemas/timeline.js";
import {
  findTimelineModeByReference,
  hasResolvableTimelineModeReference,
} from "../services/timeline/modeReference.js";
import {
  ApiError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from "../shared/errors/apiErrors.js";

type HruValue = number | string | boolean;

function buildHruPayload(config: {
  nativeMode?: string | number;
  power?: number;
  temperature?: number;
  variables?: Record<string, HruValue>;
}): Record<string, HruValue> {
  const payload: Record<string, HruValue> = {};
  if (config.nativeMode !== undefined) payload.mode = config.nativeMode;
  if (config.power !== undefined) payload.power = config.power;
  if (config.temperature !== undefined) payload.temperature = config.temperature;
  if (config.variables) {
    for (const [key, value] of Object.entries(config.variables)) {
      if (value !== undefined && value !== null) payload[key] = value;
    }
  }
  return payload;
}

function buildDirectEventHruPayload(
  config?: {
    power?: number;
    temperature?: number;
    variables?: Record<string, HruValue>;
  } | null,
): Record<string, HruValue> {
  if (!config) return {};

  const payload: Record<string, HruValue> = {};
  if (config.power !== undefined) payload.power = config.power;
  if (config.temperature !== undefined) payload.temperature = config.temperature;
  if (config.variables) {
    for (const [key, value] of Object.entries(config.variables)) {
      if (value !== undefined && value !== null) payload[key] = value;
    }
  }
  return payload;
}

function mapTimelineModeInput(payload: TimelineModeInput): Omit<TimelineMode, "id" | "hruId"> {
  return {
    name: payload.name,
    color: payload.color,
    variables: payload.variables,
    power: payload.power,
    temperature: payload.temperature,
    luftatorConfig: payload.luftatorConfig,
    isBoost: payload.isBoost ?? false,
    nativeMode: payload.nativeMode,
    scriptEntityIds: payload.scriptEntityIds,
  };
}

function eventsOverlapByDay(
  firstDay: number | null | undefined,
  secondDay: number | null | undefined,
): boolean {
  if (firstDay === null || firstDay === undefined) return true;
  if (secondDay === null || secondDay === undefined) return true;
  return firstDay === secondDay;
}

function hasTimeConflict(event: TimelineEventInput, hruId: string | null): boolean {
  const existingEvents = getTimelineEvents(hruId);

  return existingEvents.some((existingEvent) => {
    if (existingEvent.id === event.id) {
      return false;
    }

    if (existingEvent.startTime !== event.startTime) {
      return false;
    }

    return eventsOverlapByDay(existingEvent.dayOfWeek, event.dayOfWeek);
  });
}

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

  function getHruMaxPower(unitIdOverride?: string | null): number {
    try {
      let settings: HruSettings | null = null;
      const settingsRaw = getAppSetting(HRU_SETTINGS_KEY);
      if (settingsRaw) {
        settings = JSON.parse(String(settingsRaw)) as HruSettings;
      }
      const unitId = unitIdOverride ?? settings?.unit;

      if (!unitId) {
        logger.warn("No unit ID available for HRU power validation, using default max power 100");
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
      const powerVar = currentUnit.variables.find((v) => v.class === "power");
      const isConfigurable = powerVar?.maxConfigurable ?? false;
      const unitMaxValue = powerVar?.max;
      const unitMaxDefault = powerVar?.maxDefault;

      const configuredMaxPower = settings?.unit === unitId ? settings?.maxPower : undefined;
      const maxPower = isConfigurable
        ? (configuredMaxPower ?? unitMaxDefault ?? unitMaxValue ?? 100)
        : unitMaxValue || 100;

      logger.info(
        {
          unitId,
          unitMaxValue,
          unitMaxDefault,
          settingsMaxPower: configuredMaxPower,
          isConfigurable,
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

  function validatePowerAndValves(
    payload: TimelineModeInput,
    response: Response,
    unitIdOverride?: string | null,
  ): boolean {
    const maxPower = getHruMaxPower(unitIdOverride);
    let payloadPower: number | undefined;
    if (typeof payload.power === "number") {
      payloadPower = payload.power;
    } else if (typeof payload.variables?.power === "number") {
      payloadPower = payload.variables.power;
    } else {
      payloadPower = undefined;
    }

    logger.info(
      { maxPower, payloadPower, valves: payload.luftatorConfig },
      "Validating timeline mode power and valves",
    );

    if (payloadPower !== undefined && payloadPower > maxPower) {
      response.status(400).json({
        detail: `Power must be between 0 and ${maxPower}`,
      });
      return false;
    }

    return true;
  }

  function validateModeHruPayload(payload: TimelineModeInput, unitId: string | null): void {
    const hruPayload = buildHruPayload(payload);
    if (Object.keys(hruPayload).length === 0) return;
    hruService.validateWriteValues(hruPayload, unitId || undefined);
  }

  function validateEventHruPayload(payload: TimelineEventInput, unitId: string | null): void {
    if (payload.hruConfig?.mode !== undefined) {
      const modes = getTimelineModes(unitId || undefined);
      const referencedMode = findTimelineModeByReference(modes, payload.hruConfig.mode);
      if (!referencedMode) {
        throw new NotFoundError("Referenced timeline mode not found", "MODE_NOT_FOUND");
      }
    }

    const hruPayload = buildDirectEventHruPayload(payload.hruConfig);
    if (Object.keys(hruPayload).length === 0) return;
    hruService.validateWriteValues(hruPayload, unitId || undefined);
  }

  async function rollbackTimelineOverride(
    previousOverrideRaw: string,
    action: string,
    originalError: unknown,
  ): Promise<never> {
    setAppSetting(TIMELINE_OVERRIDE_KEY, previousOverrideRaw);

    try {
      await timelineScheduler.executeScheduledEventOrThrow();
    } catch (rollbackError) {
      logger.error(
        { rollbackError, originalError, action },
        "Failed to rollback timeline state after apply failure",
      );
      throw new ServiceUnavailableError(
        "Timeline change failed and previous state could not be restored",
        "TIMELINE_ROLLBACK_FAILED",
      );
    }

    if (originalError instanceof Error) {
      throw originalError;
    }
    if (
      typeof originalError === "object" &&
      originalError !== null &&
      "statusCode" in originalError &&
      "message" in originalError
    ) {
      const err = originalError as { statusCode: number; message: string; code?: string };
      throw new ApiError(err.statusCode, String(err.message), err.code);
    }
    throw new Error(String(originalError));
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
        const currentUnitId = getCurrentUnitId(request.query.unitId as string);
        const modeData = mapTimelineModeInput(payload);

        // Validate against HRU max power
        if (!validatePowerAndValves(payload, response, currentUnitId)) {
          return;
        }
        validateModeHruPayload(payload, currentUnitId);

        const newMode: TimelineMode = {
          // ID is auto-generated by DB if creating
          id: 0, // Placeholder, DB ignores/overwrites
          ...modeData,
          hruId: currentUnitId || "",
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
        const original = getTimelineMode(id);
        if (!original) {
          return next(new NotFoundError("Mode not found", "MODE_NOT_FOUND"));
        }
        const payload = request.body as TimelineModeInput;
        const modeData = mapTimelineModeInput(payload);
        const modeUnitId = original.hruId || getCurrentUnitId() || "";

        // Validate against HRU max power
        if (!validatePowerAndValves(payload, response, modeUnitId)) {
          return;
        }
        validateModeHruPayload(payload, modeUnitId);

        const updated: TimelineMode = {
          id: id,
          ...modeData,
          hruId: modeUnitId,
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

      const original = getTimelineMode(id);
      if (!original) {
        return next(new NotFoundError("Mode not found", "MODE_NOT_FOUND"));
      }

      try {
        // Cascade: delete events using this mode
        deleteTimelineEventsByMode(id, original.name);
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
      const orphanedIds = events
        .filter((e) => {
          const modeReference = e.hruConfig?.mode;
          return !hasResolvableTimelineModeReference(modes, modeReference);
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
        response.json(events.filter((e) => e.id === undefined || !orphanSet.has(e.id)));
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
        const hruId = getCurrentUnitId(request.query.unitId as string);

        validateEventHruPayload(body, hruId);

        if (hasTimeConflict(body, hruId)) {
          return next(
            new ConflictError(
              "An event already exists at this time for the selected day",
              "DUPLICATE_EVENT_TIME",
            ),
          );
        }

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
    async (
      request: Request<Record<string, unknown>, Record<string, unknown>, BoostOverrideInput>,
      response: Response,
      next: NextFunction,
    ) => {
      try {
        const { modeId, durationMinutes } = request.body;
        const currentOverrideRaw = getAppSetting(TIMELINE_OVERRIDE_KEY) ?? "null";

        const unitId = request.query.unitId as string | undefined;
        const hruId = getCurrentUnitId(unitId);

        const modes = getTimelineModes(hruId || undefined);
        const modeExists = modes.some((m) => m.id === modeId);
        if (!modeExists) return next(new NotFoundError("Mode not found", "MODE_NOT_FOUND"));

        const endTime = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
        const override: TimelineOverride = { modeId, endTime, durationMinutes };

        setAppSetting(TIMELINE_OVERRIDE_KEY, JSON.stringify(override));
        logger.info({ modeId, durationMinutes, endTime }, "Timeline boost activated");

        try {
          await timelineScheduler.executeScheduledEventOrThrow();
        } catch (error) {
          await rollbackTimelineOverride(currentOverrideRaw, "boost", error);
        }

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
      const currentOverrideRaw = getAppSetting(TIMELINE_OVERRIDE_KEY) ?? "null";
      setAppSetting(TIMELINE_OVERRIDE_KEY, "null");
      logger.info("Timeline boost cancelled");

      try {
        await timelineScheduler.executeScheduledEventOrThrow();
      } catch (error) {
        await rollbackTimelineOverride(currentOverrideRaw, "cancel_boost", error);
      }

      response.status(204).end();
    } catch (error) {
      logger.error({ error }, "Failed to cancel boost");
      next(error);
    }
  });

  router.post(
    "/override/stop",
    async (_request: Request, response: Response, next: NextFunction) => {
      try {
        const currentOverrideRaw = getAppSetting(TIMELINE_OVERRIDE_KEY) ?? "null";
        setAppSetting(TIMELINE_OVERRIDE_KEY, "null");
        logger.info("Timeline override stopped via debug/manual command");

        try {
          await timelineScheduler.executeScheduledEventOrThrow();
        } catch (error) {
          await rollbackTimelineOverride(currentOverrideRaw, "stop_override", error);
        }

        response.status(204).end();
      } catch (error) {
        logger.error({ error }, "Failed to stop timeline override");
        next(error);
      }
    },
  );

  router.post("/scheduler/restart", (_request: Request, response: Response) => {
    logger.info("Timeline scheduler restart requested via Debug Page");
    timelineScheduler.restart();
    response.status(204).end();
  });

  router.post(
    "/test",
    validateRequest(testOverrideInputSchema),
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const { durationMinutes, config } = request.body as TestOverrideInput;
        const currentOverrideRaw = getAppSetting(TIMELINE_OVERRIDE_KEY) ?? "null";
        const currentUnitId = getCurrentUnitId();

        // Validate max power just like regular creation
        if (!validatePowerAndValves(config, response, currentUnitId)) {
          return;
        }
        validateModeHruPayload(config, currentUnitId);

        // Add 5s buffer to account for network latency and timer drift
        // This ensures the frontend timer finishes (reverting UI) before the backend actually reverts the mode
        const endTime = new Date(Date.now() + durationMinutes * 60 * 1000 + 5000).toISOString();
        const override: TimelineOverride = {
          modeId: undefined,
          customConfig: {
            nativeMode: config.nativeMode,
            power: config.power,
            temperature: config.temperature,
            variables: config.variables,
            luftatorConfig: config.luftatorConfig,
            scriptEntityIds: config.scriptEntityIds,
          },
          endTime,
          durationMinutes,
        };

        setAppSetting(TIMELINE_OVERRIDE_KEY, JSON.stringify(override));
        logger.info({ durationMinutes, endTime }, "Timeline test mode activated");

        try {
          await timelineScheduler.executeScheduledEventOrThrow();
        } catch (error) {
          await rollbackTimelineOverride(currentOverrideRaw, "test_mode", error);
        }

        response.json({ active: override });
      } catch (error) {
        logger.error({ error }, "Failed to activate test mode");
        next(error);
      }
    },
  );

  return router;
}
