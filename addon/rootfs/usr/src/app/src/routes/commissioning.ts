import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "pino";
import { z } from "zod";
import { getTimelineModes, getActiveSeasonId } from "../services/database.js";
import { resolveCurrentUnitId } from "../services/unitResolution.js";
import type { CommissioningRunner } from "../services/commissioningRunner.js";
import type { HruService } from "../features/hru/hru.service.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { BadRequestError } from "../shared/errors/apiErrors.js";

const startCommissioningSchema = z.object({
  intervalSeconds: z.number().int().min(10).max(300).default(45),
  modeIds: z.array(z.number().int().positive()).min(1).optional(),
});

export function createCommissioningRouter(
  commissioningRunner: CommissioningRunner,
  hruService: HruService,
  logger: Logger,
) {
  const router = Router();

  router.get("/run", (_request: Request, response: Response) => {
    response.json(commissioningRunner.getStatus());
  });

  router.post(
    "/run",
    validateRequest(startCommissioningSchema),
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const { intervalSeconds, modeIds } = request.body as z.infer<
          typeof startCommissioningSchema
        >;
        const unitId = resolveCurrentUnitId(hruService) ?? undefined;
        const allModes = getTimelineModes(unitId, getActiveSeasonId(unitId ?? null));

        const candidates = modeIds ? allModes.filter((m) => modeIds.includes(m.id)) : allModes;

        const modes = candidates.map((m) => ({ id: m.id, name: m.name }));

        if (modes.length === 0) {
          return next(new BadRequestError("No modes available for commissioning run"));
        }

        logger.info(
          { modeCount: modes.length, intervalSeconds },
          "Commissioning: Starting commissioning run",
        );

        await commissioningRunner.start(modes, intervalSeconds);
        response.json(commissioningRunner.getStatus());
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete("/run", async (_request: Request, response: Response, next: NextFunction) => {
    try {
      commissioningRunner.stop();
      response.json(commissioningRunner.getStatus());
    } catch (err) {
      next(err);
    }
  });

  return router;
}
