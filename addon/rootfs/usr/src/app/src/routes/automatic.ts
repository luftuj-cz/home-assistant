import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "pino";
import { validateParams, validateRequest } from "../middleware/validateRequest.js";
import {
  journalQuerySchema,
  type RoomGroupParams,
  roomGroupParamsSchema,
  type RoomIdParams,
  roomIdParamsSchema,
  type RoomInputBody,
  roomInputSchema,
} from "../schemas/automatic.js";
import {
  addGroupToRoom,
  createRoom,
  deleteRoom,
  getRoom,
  listRooms,
  RoomConflictError,
  updateRoom,
} from "../services/db/rooms.js";
import { sensorCandidates } from "../services/automatic/candidates.js";
import { engineDefaults, parameterProblems } from "../services/automatic/engineParams.js";
import {
  getEffectiveParameters,
  getMaxReadingAgeSeconds,
  getParameterOverrides,
  parametersInputSchema,
  setMaxReadingAgeSeconds,
  setParameterOverrides,
} from "../services/automatic/parameters.js";
import type { PowerScale } from "../services/automatic/powerScale.js";
import { DEFAULT_MAX_READING_AGE_SECONDS } from "../services/automatic/readings.js";
import type { AutomaticStatus } from "../services/automatic/runner.js";
import { appendJournal, readJournal } from "../services/db/automaticJournal.js";
import type { HassState } from "../services/homeAssistantClient.js";
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from "../shared/errors/apiErrors.js";

export interface AutomaticRouterDeps {
  logger: Logger;
  /** Called after every room write, so the sensor store and the runner can rebuild. */
  onRoomsChanged?: () => void;
  /** Called after the parameters change, so the running engine takes them. */
  onParametersChanged?: () => void;
  /** The current unit's power conversion, for unit equivalents; null when there is none. */
  powerScale?: () => PowerScale | null;
  /** The runner's status; absent, the status reports automatic control as not running. */
  status?: () => AutomaticStatus;
  /** The source that applies now and its display name, from the scheduler. */
  activeSource?: () => { source: string | null; name: string };
  /** Home Assistant, for the sensor picker; null when the backend runs without it. */
  homeAssistant?: { fetchAllStates(): Promise<HassState[]> } | null;
}

function conflict(error: RoomConflictError): ConflictError {
  const code = {
    name: "ROOM_NAME_TAKEN",
    valve: "ROOM_VALVE_TAKEN",
    sensor: "ROOM_SENSOR_TAKEN",
  }[error.kind];
  return new ConflictError(error.message, code);
}

/** Automatic control (LUFTaTOR Algo CO2): rooms, status, parameters and journal. */
export function createAutomaticRouter(deps: AutomaticRouterDeps) {
  const { logger } = deps;
  const router = Router();

  function changed(action: string, room: { id: number; name?: string }): void {
    try {
      appendJournal("rooms", { action, id: room.id, name: room.name ?? null });
    } catch (error) {
      logger.warn({ error }, "Automatic control: could not journal a room change");
    }
    try {
      deps.onRoomsChanged?.();
    } catch (error) {
      logger.error({ error }, "Automatic control: reacting to a room change failed");
    }
  }

  function handleRoomError(error: unknown, next: NextFunction): void {
    if (error instanceof RoomConflictError) {
      next(conflict(error));
      return;
    }
    next(error);
  }

  router.get("/rooms", (_request: Request, response: Response, next: NextFunction) => {
    try {
      response.json(listRooms());
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/rooms",
    validateRequest(roomInputSchema),
    (request: Request, response: Response, next: NextFunction) => {
      try {
        const room = createRoom(request.body as RoomInputBody);
        logger.info({ id: room.id, name: room.name }, "Automatic control: room created");
        changed("created", room);
        response.status(201).json(room);
      } catch (error) {
        handleRoomError(error, next);
      }
    },
  );

  router.put(
    "/rooms/:id",
    validateParams(roomIdParamsSchema),
    validateRequest(roomInputSchema),
    (request: Request, response: Response, next: NextFunction) => {
      const id = Number((request.params as RoomIdParams).id);
      try {
        const body = request.body as RoomInputBody;
        const existing = getRoom(id);
        if (!existing) return next(new NotFoundError("Room not found", "ROOM_NOT_FOUND"));
        const room = updateRoom(id, { ...body, sortOrder: body.sortOrder ?? existing.sortOrder });
        logger.info({ id, name: body.name }, "Automatic control: room updated");
        changed("updated", { id, name: body.name });
        response.json(room);
      } catch (error) {
        handleRoomError(error, next);
      }
    },
  );

  router.delete(
    "/rooms/:id",
    validateParams(roomIdParamsSchema),
    (request: Request, response: Response, next: NextFunction) => {
      const id = Number((request.params as RoomIdParams).id);
      try {
        if (!deleteRoom(id)) return next(new NotFoundError("Room not found", "ROOM_NOT_FOUND"));
        logger.info({ id }, "Automatic control: room deleted");
        changed("deleted", { id });
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/rooms/:id/groups/:groupId",
    validateParams(roomGroupParamsSchema),
    (request: Request, response: Response, next: NextFunction) => {
      const params = request.params as RoomGroupParams;
      try {
        const room = addGroupToRoom(Number(params.id), Number(params.groupId));
        if (!room) {
          return next(new NotFoundError("Room or valve group not found", "ROOM_NOT_FOUND"));
        }
        logger.info({ id: room.id, groupId: params.groupId }, "Automatic control: group added");
        changed("groupAdded", room);
        response.json(room);
      } catch (error) {
        handleRoomError(error, next);
      }
    },
  );

  function parametersPayload() {
    const values = getEffectiveParameters();
    const scale = deps.powerScale?.() ?? null;
    const step = scale ? scale.effectiveStep(values.hruPowerStep) : null;
    return {
      values,
      defaults: engineDefaults(),
      overrides: getParameterOverrides(),
      problems: parameterProblems(values),
      maxReadingAgeSeconds: getMaxReadingAgeSeconds(),
      defaultMaxReadingAgeSeconds: DEFAULT_MAX_READING_AGE_SECONDS,
      power: scale
        ? {
            variable: scale.variable,
            unit: scale.unit,
            min: scale.min,
            max: scale.max,
            step: scale.step,
            effectiveStep: step,
            equivalents: {
              hruMinPower: scale.toUnit(values.hruMinPower),
              hruMaxPowerDay: scale.toUnit(values.hruMaxPowerDay),
              hruMaxPowerNight: scale.toUnit(values.hruMaxPowerNight),
              hruMovePower: scale.toUnit(values.hruMovePower),
              hruPowerStep: Number((((step ?? 0) / 10) * scale.max).toFixed(2)),
            },
          }
        : null,
    };
  }

  router.get("/parameters", (_request: Request, response: Response, next: NextFunction) => {
    try {
      response.json(parametersPayload());
    } catch (error) {
      next(error);
    }
  });

  router.put(
    "/parameters",
    validateRequest(parametersInputSchema),
    (request: Request, response: Response, next: NextFunction) => {
      try {
        const body = request.body as {
          overrides: Parameters<typeof setParameterOverrides>[0];
          maxReadingAgeSeconds?: number | null;
        };
        const stored = setParameterOverrides(body.overrides);
        if (body.maxReadingAgeSeconds !== undefined) {
          setMaxReadingAgeSeconds(body.maxReadingAgeSeconds);
        }
        logger.info({ overrides: stored }, "Automatic control: parameters changed");
        try {
          appendJournal("parameters", {
            overrides: stored,
            maxReadingAgeSeconds: getMaxReadingAgeSeconds(),
          });
        } catch (error) {
          logger.warn({ error }, "Automatic control: could not journal a parameter change");
        }
        try {
          deps.onParametersChanged?.();
        } catch (error) {
          logger.error({ error }, "Automatic control: applying parameters failed");
        }
        response.json(parametersPayload());
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/status", (_request: Request, response: Response, next: NextFunction) => {
    try {
      const status: AutomaticStatus = deps.status?.() ?? {
        active: false,
        reason: null,
        startedAt: null,
        lastRunAt: null,
        engineTime: null,
        branch: null,
        fluctuationActive: false,
        powerReview: null,
        power: null,
        rooms: [],
        lockedValves: [],
      };
      const active = deps.activeSource?.() ?? { source: null, name: "?" };
      response.json({ ...status, source: active.source, sourceName: active.name });
    } catch (error) {
      next(error);
    }
  });

  router.get("/journal", (request: Request, response: Response, next: NextFunction) => {
    const parsed = journalQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ detail: "Invalid query", errors: parsed.error.issues });
      return;
    }
    try {
      response.json(readJournal(parsed.data.limit));
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/sensor-candidates",
    async (_request: Request, response: Response, next: NextFunction) => {
      if (!deps.homeAssistant) {
        return next(new ServiceUnavailableError("Home Assistant is not connected", "HA_OFFLINE"));
      }
      try {
        response.json(sensorCandidates(await deps.homeAssistant.fetchAllStates()));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
