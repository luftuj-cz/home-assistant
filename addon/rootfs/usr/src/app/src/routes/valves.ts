import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import type { ValveController } from "../core/valveManager";
import { validateParams, validateRequest } from "../middleware/validateRequest";
import {
  type ValveUpdateBody,
  valveUpdateBodySchema,
  type ValveUpdateParams,
  valveUpdateParamsSchema,
} from "../schemas/valves";
import { ApiError, NotFoundError } from "../shared/errors/apiErrors";

export function createValvesRouter(valveManager: ValveController, logger: Logger) {
  const router = Router();

  router.get("/", async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const snapshot = await valveManager.getSnapshot();
      logger.debug({ count: Object.keys(snapshot).length }, "Retrieved valves snapshot");
      response.json(snapshot);
    } catch (error) {
      logger.error({ error }, "Failed to get valves snapshot");
      next(error);
    }
  });

  router.post(
    "/:entityId",
    validateParams(valveUpdateParamsSchema),
    validateRequest(valveUpdateBodySchema),
    async (request: Request, response: Response, next: NextFunction) => {
      const { entityId } = request.params as unknown as ValveUpdateParams;
      const body = request.body as unknown as ValveUpdateBody;
      const numericValue = body.value;

      try {
        logger.debug({ entityId, value: numericValue }, "Valve value POST received");
        const result = await valveManager.setValue(entityId, numericValue);
        logger.info({ entityId, value: numericValue }, "Valve value updated via API");
        response.json(result);
      } catch (error) {
        if (error instanceof Error) {
          if (/Unknown valve/.test(error.message)) {
            logger.warn({ entityId }, "Valve value update failed: unknown valve");
            return next(new NotFoundError(error.message, "UNKNOWN_VALVE"));
          }
          if (/Offline mode/.test(error.message)) {
            logger.warn({ entityId }, "Valve value update rejected: offline mode");
            return next(new ApiError(503, error.message, "OFFLINE_MODE"));
          }
        }
        logger.error({ error, entityId, value: numericValue }, "Valve value update failed");
        next(error);
      }
    },
  );

  return router;
}
