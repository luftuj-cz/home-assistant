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
  type TimelineMode,
  type TimelineOverride,
} from "../types";

import type { TimelineScheduler } from "../services/timelineScheduler";

export function createTimelineRouter(logger: Logger, timelineScheduler: TimelineScheduler) {
  const router = Router();

  type TimelineModeBody = {
    name?: string;
    color?: string;
    power?: number;
    temperature?: number;
    luftatorConfig?: Record<string, number>;
    isBoost?: boolean;
  };

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

  function validateModeInput(
    body: TimelineModeBody,
    response: Response,
    valveMax: number,
  ): (TimelineModeBody & { name: string }) | null {
    const trimmed = (body.name ?? "").toString().trim();
    if (!trimmed) {
      response.status(400).json({ detail: "Mode name is required" });
      return null;
    }
    if (
      body.power !== undefined &&
      (Number.isNaN(body.power) || body.power < 0 || body.power > 90)
    ) {
      response.status(400).json({ detail: "Power must be between 0 and 90" });
      return null;
    }
    if (
      body.temperature !== undefined &&
      (Number.isNaN(body.temperature) || body.temperature < -50 || body.temperature > 100)
    ) {
      response.status(400).json({ detail: "Temperature must be between -50 and 100" });
      return null;
    }
    if (body.luftatorConfig !== undefined) {
      if (typeof body.luftatorConfig !== "object" || Array.isArray(body.luftatorConfig)) {
        response
          .status(400)
          .json({ detail: "luftatorConfig must be an object of valve->percentage" });
        return null;
      }
      for (const [key, value] of Object.entries(body.luftatorConfig)) {
        if (value === null || value === undefined) {
          continue;
        }
        if (Number.isNaN(Number(value)) || Number(value) < 0 || Number(value) > valveMax) {
          response.status(400).json({
            detail: `Invalid opening for valve ${key}. Must be 0-${valveMax}.`,
          });
          return null;
        }
      }
    }

    const normalizedLuftatorConfig = body.luftatorConfig
      ? Object.fromEntries(
          Object.entries(body.luftatorConfig)
            .filter(([, v]) => v !== undefined && v !== null && !Number.isNaN(Number(v)))
            .map(([k, v]) => [k, Number(v)]),
        )
      : undefined;

    return {
      ...body,
      name: trimmed,
      color: body.color || undefined,
      isBoost: !!body.isBoost,
      luftatorConfig: normalizedLuftatorConfig,
    };
  }

  // Timeline Modes
  router.get("/modes", (_request: Request, response: Response) => {
    response.json({ modes: getTimelineModes() });
  });

  router.post("/modes", (request: Request, response: Response) => {
    const payload = validateModeInput(request.body as TimelineModeBody, response, 90);
    if (!payload) return;

    const modes = getTimelineModes();
    const nextId = modes.reduce((acc, m) => Math.max(acc, m.id), 0) + 1;
    const newMode: TimelineMode = {
      id: nextId,
      name: payload.name,
      color: payload.color,
      power: payload.power,
      temperature: payload.temperature,
      luftatorConfig: payload.luftatorConfig,
      isBoost: payload.isBoost,
    };
    modes.push(newMode);
    saveTimelineModes(modes);
    response.status(201).json(newMode);
  });

  router.put("/modes/:id", (request: Request, response: Response) => {
    const id = Number.parseInt(request.params.id as string, 10);
    if (!Number.isFinite(id)) {
      response.status(400).json({ detail: "Invalid mode id" });
      return;
    }
    const payload = validateModeInput(request.body as TimelineModeBody, response, 100);
    if (!payload) return;

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
      isBoost: payload.isBoost,
    };
    modes[idx] = updated;
    saveTimelineModes(modes);
    response.json(updated);
  });

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

  router.post("/events", (request: Request, response: Response) => {
    const body = request.body as {
      id?: number;
      startTime?: string;
      endTime?: string;
      dayOfWeek?: number | null;
      hruConfig?: {
        mode?: string;
        power?: number;
        temperature?: number;
      } | null;
      luftatorConfig?: Record<string, number> | null;
      enabled?: boolean;
      priority?: number;
    };

    // Validation
    if (!body.startTime || !body.endTime) {
      response.status(400).json({ detail: "Start time and end time are required" });
      return;
    }

    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(body.startTime) || !timeRegex.test(body.endTime)) {
      response.status(400).json({ detail: "Times must be in HH:MM format" });
      return;
    }

    if (
      body.dayOfWeek !== undefined &&
      body.dayOfWeek !== null &&
      (body.dayOfWeek < 0 || body.dayOfWeek > 6)
    ) {
      response.status(400).json({ detail: "Day of week must be 0-6 or null for all days" });
      return;
    }

    if (body.priority !== undefined && (body.priority < 0 || body.priority > 100)) {
      response.status(400).json({ detail: "Priority must be 0-100" });
      return;
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
  });

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

  router.post("/boost", async (request: Request, response: Response) => {
    const { modeId, durationMinutes } = request.body as {
      modeId: number;
      durationMinutes: number;
    };
    if (!modeId || !durationMinutes || durationMinutes <= 0) {
      return response.status(400).json({ detail: "modeId and positive durationMinutes required" });
    }

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
  });

  router.delete("/boost", async (_request: Request, response: Response) => {
    setAppSetting(TIMELINE_OVERRIDE_KEY, "null");
    logger.info("Timeline boost cancelled");

    // Trigger immediate execution
    await timelineScheduler.executeScheduledEvent();

    response.status(204).end();
  });

  return router;
}
