import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { SeasonalModesRepository } from "./seasonalModes.repository.js";
import { SeasonalModesService } from "./seasonalModes.service.js";
import { seasonalModeInputSchema } from "../../schemas/seasonalModes.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { getTimelineMode } from "../../services/db/timeline.js";
import type { SettingsRepository } from "../settings/settings.repository.js";
import type { Season } from "../../services/db/seasonalModes.js";
import { BadRequestError } from "../../shared/errors/apiErrors.js";

const SEASONS: ReadonlySet<string> = new Set(["spring", "summer", "autumn", "winter"]);

function parseSeason(value: string | undefined): Season {
  if (!value || !SEASONS.has(value)) {
    throw new BadRequestError(`Invalid season: ${value}`, "INVALID_SEASON");
  }
  return value as Season;
}

export function createSeasonalModesRouter(settingsRepository: SettingsRepository): Router {
  const router = Router();
  const repo = new SeasonalModesRepository();
  const timeline = { getTimelineMode };
  const service = new SeasonalModesService(repo, settingsRepository, timeline);

  function getHruId(query: Request["query"]): string | null {
    const raw = query.hruId;
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  }

  router.get("/", (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(repo.list(getHruId(req.query)));
    } catch (err) {
      next(err);
    }
  });

  router.put(
    "/:season",
    validateRequest(seasonalModeInputSchema),
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const season = parseSeason(req.params.season as string);
        const hruId = getHruId(req.query);
        const body = req.body;
        service.upsert({ season, hruId, ...body });
        res.json(repo.get(season, hruId));
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete("/:season", (req: Request, res: Response, next: NextFunction) => {
    try {
      const season = parseSeason(req.params.season as string);
      const hruId = getHruId(req.query);
      repo.remove(season, hruId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
