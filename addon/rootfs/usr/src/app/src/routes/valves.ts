import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import type { ValveController } from "../core/valveManager.js";
import { validateParams, validateRequest } from "../middleware/validateRequest.js";
import {
  type ValveUpdateBody,
  valveUpdateBodySchema,
  type ValveUpdateParams,
  valveUpdateParamsSchema,
} from "../schemas/valves.js";
import { ApiError } from "../shared/errors/apiErrors.js";

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

  router.post("/refresh", async (_request: Request, response: Response, next: NextFunction) => {
    try {
      logger.info("Manual valve snapshot refresh requested");
      await valveManager.refresh();
      response.status(204).end();
    } catch (error) {
      logger.error({ error }, "Failed to refresh valves snapshot");
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
        // Typed ApiError (UnknownValveError 404, OfflineModeError 503) carries its
        // own status + code; let the error handler format it. Only unexpected
        // errors are logged as errors here.
        if (error instanceof ApiError) {
          logger.warn({ entityId, code: error.code }, "Valve value update rejected");
          return next(error);
        }
        logger.error({ error, entityId, value: numericValue }, "Valve value update failed");
        next(error);
      }
    },
  );

  return router;
}
