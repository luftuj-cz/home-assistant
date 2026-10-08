import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "pino";
import type { HruService } from "../features/hru/hru.service.js";
import { validateRequest } from "../middleware/validateRequest.js";
import {
  customOverrideInputSchema,
  customTimelineCreateInputSchema,
  customTimelineEventInputSchema,
  customTimelineFillInputSchema,
  customTimelineRenameInputSchema,
  type CustomOverrideInput,
  type CustomTimelineEventInput,
} from "../schemas/customTimelines.js";
import {
  countEnabledCustomEvents,
  createCustomTimeline,
  CustomTimelineNameTakenError,
  deleteCustomTimeline,
  deleteCustomTimelineEvent,
  getCustomTimeline,
  getCustomTimelineEvent,
  getCustomTimelineEvents,
  getCustomTimelines,
  renameCustomTimeline,
  replaceCustomTimelineEvents,
  toTimelineEvent,
  upsertCustomTimelineEvent,
  type CustomTimeline,
  type CustomTimelineEvent,
} from "../services/db/customTimelines.js";
import {
  activateCustomOverride,
  CustomOverrideRejectedError,
  endCustomOverride,
  isOverridingTimeline,
  overridePhase,
  readCustomOverride,
} from "../services/timeline/customOverride.js";
import {
  findModesMissingInEnabledSeasons,
  findPlanNameConflict,
} from "../services/timeline/customTimelineRules.js";
import type { TimelineScheduler } from "../services/timelineScheduler.js";
import type { MqttService } from "../services/mqttService.js";
import { resolveCurrentUnitId } from "../services/unitResolution.js";
import {
  ApiError,
  BadRequestError,
  ConflictError,
  DetailedConflictError,
  NotFoundError,
} from "../shared/errors/apiErrors.js";

function parseId(raw: unknown): number | null {
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function modeRuleError(missing: ReturnType<typeof findModesMissingInEnabledSeasons>): ApiError {
  if (missing.some((entry) => entry.modeName === null)) {
    return new BadRequestError("Unknown mode for this unit", "UNKNOWN_MODE");
  }
  return new DetailedConflictError(
    "The mode is not configured in every enabled season",
    "MODE_NOT_CONFIGURED_IN_ALL_SEASONS",
    { missing },
  );
}

function rejectionToApiError(error: CustomOverrideRejectedError): ApiError {
  switch (error.code) {
    case "CUSTOM_TIMELINE_NOT_FOUND":
      return new NotFoundError(error.message, error.code);
    case "OVERRIDE_END_BEFORE_START":
      return new BadRequestError(error.message, error.code);
    case "MODE_NOT_CONFIGURED_IN_ALL_SEASONS":
      return new DetailedConflictError(error.message, error.code, { missing: error.missing });
    default:
      return new ConflictError(error.message, error.code);
  }
}

function sameDay(first: number | null, second: number | null): boolean {
  return first === null || second === null || first === second;
}

/** What the dashboard and Settings show about the override. */
function describeCustomOverride(currentUnitId: string | null) {
  const override = readCustomOverride();
  if (!override) return null;
  const phase = overridePhase(override);
  if (phase === "expired") return null;
  const timeline = getCustomTimeline(override.customTimelineId);
  return {
    ...override,
    phase,
    name: timeline?.name ?? null,
    appliesToCurrentUnit: timeline !== null && timeline.hruId === currentUnitId,
  };
}

function assertNameFree(hruId: string, name: string, selfId?: number): void {
  const conflict = findPlanNameConflict(
    hruId,
    name,
    selfId === undefined ? undefined : { kind: "custom", id: selfId },
  );
  if (conflict) {
    throw new DetailedConflictError(
      `The name "${conflict.name}" is already used`,
      "PLAN_NAME_TAKEN",
      { conflict },
    );
  }
}

function assertEventAllowed(timeline: CustomTimeline, event: CustomTimelineEvent): void {
  const clash = getCustomTimelineEvents(timeline.id).some(
    (existing) =>
      existing.id !== event.id &&
      existing.startTime === event.startTime &&
      sameDay(existing.dayOfWeek, event.dayOfWeek),
  );
  if (clash) {
    throw new ConflictError(
      "An event already exists at this time for the selected day",
      "DUPLICATE_EVENT_TIME",
    );
  }
  if (event.enabled) {
    const missing = findModesMissingInEnabledSeasons(timeline.hruId, [event.modeId]);
    if (missing.length > 0) throw modeRuleError(missing);
  }
}

/**
 * The overriding timeline must keep at least one enabled event, or the
 * override would silently stop applying. Checked against the state after the
 * change.
 */
function assertKeepsAnEvent(timeline: CustomTimeline, enabledAfter: number): void {
  if (enabledAfter === 0 && isOverridingTimeline(timeline.id)) {
    throw new ConflictError(
      "The last enabled event of the overriding timeline cannot be removed; end the override first",
      "CUSTOM_TIMELINE_LAST_EVENT",
    );
  }
}

/** Narrows a lookup result to a timeline of the unit in scope. */
function belongsTo(
  timeline: CustomTimeline | null,
  hruId: string | null,
): timeline is CustomTimeline {
  return timeline?.hruId === hruId;
}

export function createCustomTimelinesRouter(
  logger: Logger,
  hruService: HruService,
  timelineScheduler: TimelineScheduler,
  mqttService: Pick<MqttService, "refreshDiscovery" | "publishCustomOverrideState">,
) {
  const router = Router();

  function currentUnitId(request: Request): string | null {
    return resolveCurrentUnitId(hruService, request.query.unitId as string | undefined);
  }

  /** The override as the dashboard shows it, including whether it is actually applying. */
  function overrideView(hruId: string | null) {
    const override = describeCustomOverride(hruId);
    if (!override) return null;
    return {
      ...override,
      degraded: override.phase === "active" && timelineScheduler.isCustomOverrideDegraded(),
    };
  }

  function refreshDiscovery(reason: string): void {
    mqttService.refreshDiscovery().catch((error) => {
      logger.warn({ error }, `Failed to refresh MQTT discovery after ${reason}`);
    });
  }

  function publishOverrideState(): void {
    mqttService.publishCustomOverrideState().catch((error) => {
      logger.warn({ error }, "Failed to publish custom override state");
    });
  }

  /** The timeline named in the path, if it belongs to the unit in scope. */
  function timelineInScope(request: Request): CustomTimeline {
    const id = parseId(request.params.id);
    if (id === null) throw new BadRequestError("Invalid custom timeline ID", "INVALID_ID");
    const timeline = getCustomTimeline(id);
    if (!belongsTo(timeline, currentUnitId(request))) {
      throw new NotFoundError("Custom timeline not found", "CUSTOM_TIMELINE_NOT_FOUND");
    }
    return timeline;
  }

  function handle(
    action: string,
    run: (request: Request, response: Response) => void | Promise<void>,
  ) {
    return async (request: Request, response: Response, next: NextFunction) => {
      try {
        await run(request, response);
      } catch (error) {
        if (error instanceof ApiError) return next(error);
        if (error instanceof CustomOverrideRejectedError) return next(rejectionToApiError(error));
        if (error instanceof CustomTimelineNameTakenError) {
          return next(new ConflictError(error.message, "PLAN_NAME_TAKEN"));
        }
        logger.error({ error }, `Failed to ${action}`);
        next(error);
      }
    };
  }

  // ---------------------------------------------------------------- override
  // Registered before the `/:id` routes so "override" is never read as an id.

  router.get(
    "/override",
    handle("read custom override", (request, response) => {
      response.json({ override: overrideView(currentUnitId(request)) });
    }),
  );

  router.put(
    "/override",
    validateRequest(customOverrideInputSchema),
    handle("activate custom override", async (request, response) => {
      const body = request.body as CustomOverrideInput;
      const hruId = currentUnitId(request);
      await activateCustomOverride(body, hruId, timelineScheduler, logger);
      publishOverrideState();
      response.json({ override: overrideView(hruId) });
    }),
  );

  router.delete(
    "/override",
    handle("end custom override", async (_request, response) => {
      await endCustomOverride(timelineScheduler, logger);
      publishOverrideState();
      response.status(204).end();
    }),
  );

  // --------------------------------------------------------------- timelines

  router.get(
    "/",
    handle("list custom timelines", (request, response) => {
      const hruId = currentUnitId(request);
      const override = overrideView(hruId);
      const timelines = hruId
        ? getCustomTimelines(hruId).map((timeline) => ({
            ...timeline,
            overridePhase: override?.customTimelineId === timeline.id ? override.phase : null,
          }))
        : [];
      response.json({ timelines, override });
    }),
  );

  router.post(
    "/",
    validateRequest(customTimelineCreateInputSchema),
    handle("create custom timeline", (request, response) => {
      const hruId = currentUnitId(request);
      if (!hruId) {
        throw new BadRequestError(
          "Select an HRU unit before creating a custom timeline",
          "HRU_UNIT_REQUIRED",
        );
      }
      const { name } = request.body as { name: string };
      assertNameFree(hruId, name);
      const created = createCustomTimeline(hruId, name);
      logger.info({ id: created.id, name }, "Custom timeline created");
      refreshDiscovery("creating a custom timeline");
      response.status(201).json(created);
    }),
  );

  router.patch(
    "/:id",
    validateRequest(customTimelineRenameInputSchema),
    handle("rename custom timeline", (request, response) => {
      const timeline = timelineInScope(request);
      const { name } = request.body as { name: string };
      assertNameFree(timeline.hruId, name, timeline.id);
      const renamed = renameCustomTimeline(timeline.id, name);
      logger.info({ id: timeline.id, from: timeline.name, to: name }, "Custom timeline renamed");
      refreshDiscovery("renaming a custom timeline");
      publishOverrideState();
      response.json(renamed);
    }),
  );

  router.delete(
    "/:id",
    handle("delete custom timeline", (request, response) => {
      const timeline = timelineInScope(request);
      if (isOverridingTimeline(timeline.id)) {
        throw new ConflictError(
          "This timeline is the active or scheduled override; end the override first",
          "CUSTOM_TIMELINE_OVERRIDING",
        );
      }
      deleteCustomTimeline(timeline.id);
      logger.info({ id: timeline.id, name: timeline.name }, "Custom timeline deleted");
      refreshDiscovery("deleting a custom timeline");
      response.status(204).end();
    }),
  );

  // ------------------------------------------------------------------ events

  router.get(
    "/:id/events",
    handle("list custom timeline events", (request, response) => {
      const timeline = timelineInScope(request);
      const events = getCustomTimelineEvents(timeline.id).map((event) =>
        toTimelineEvent(event, timeline.hruId),
      );
      response.json({ events });
    }),
  );

  router.post(
    "/:id/events",
    validateRequest(customTimelineEventInputSchema),
    handle("create custom timeline event", (request, response) => {
      const timeline = timelineInScope(request);
      const event = {
        ...(request.body as CustomTimelineEventInput),
        customTimelineId: timeline.id,
      };
      assertEventAllowed(timeline, event);
      const saved = upsertCustomTimelineEvent(event);
      logger.info({ timelineId: timeline.id, id: saved.id }, "Custom timeline event created");
      response.status(201).json(toTimelineEvent(saved, timeline.hruId));
    }),
  );

  router.put(
    "/:id/events/:eventId",
    validateRequest(customTimelineEventInputSchema),
    handle("update custom timeline event", (request, response) => {
      const timeline = timelineInScope(request);
      const eventId = parseId(request.params.eventId);
      const existing = eventId === null ? null : getCustomTimelineEvent(timeline.id, eventId);
      if (!existing) throw new NotFoundError("Event not found", "EVENT_NOT_FOUND");

      const event = {
        ...(request.body as CustomTimelineEventInput),
        id: existing.id,
        customTimelineId: timeline.id,
      };
      assertEventAllowed(timeline, event);
      const enabledAfter =
        countEnabledCustomEvents(timeline.id) -
        (existing.enabled ? 1 : 0) +
        (event.enabled ? 1 : 0);
      assertKeepsAnEvent(timeline, enabledAfter);

      const saved = upsertCustomTimelineEvent(event);
      logger.info({ timelineId: timeline.id, id: saved.id }, "Custom timeline event updated");
      response.json(toTimelineEvent(saved, timeline.hruId));
    }),
  );

  router.delete(
    "/:id/events/:eventId",
    handle("delete custom timeline event", (request, response) => {
      const timeline = timelineInScope(request);
      const eventId = parseId(request.params.eventId);
      const existing = eventId === null ? null : getCustomTimelineEvent(timeline.id, eventId);
      if (!existing) throw new NotFoundError("Event not found", "EVENT_NOT_FOUND");

      assertKeepsAnEvent(
        timeline,
        countEnabledCustomEvents(timeline.id) - (existing.enabled ? 1 : 0),
      );
      deleteCustomTimelineEvent(timeline.id, existing.id!);
      logger.info({ timelineId: timeline.id, id: existing.id }, "Custom timeline event deleted");
      response.status(204).end();
    }),
  );

  /**
   * Replaces the whole week with the mode at 00:00 on every day: "run X all the
   * time". One event per weekday rather than a single every-day event, because
   * the week editor shows each day's own events.
   */
  router.post(
    "/:id/fill",
    validateRequest(customTimelineFillInputSchema),
    handle("fill custom timeline", (request, response) => {
      const timeline = timelineInScope(request);
      const { modeId } = request.body as { modeId: number };
      const missing = findModesMissingInEnabledSeasons(timeline.hruId, [modeId]);
      if (missing.length > 0) throw modeRuleError(missing);

      const events = replaceCustomTimelineEvents(
        timeline.id,
        [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          modeId,
          dayOfWeek,
          startTime: "00:00",
          enabled: true,
          priority: 0,
        })),
      );
      logger.info({ timelineId: timeline.id, modeId }, "Custom timeline filled with one mode");
      response.json({ events: events.map((event) => toTimelineEvent(event, timeline.hruId)) });
    }),
  );

  return router;
}
