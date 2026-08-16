import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "pino";
import {
  ensureSeasons,
  getAppSetting,
  getSeasons,
  getTimelineEvents,
  getTimelineModes,
  resolveActiveSeason,
  type SeasonKey,
  updateSeason,
} from "../services/database.js";
import {
  disableSeasonsFeature,
  enableSeasonsFeature,
  getDisableImpact,
  isSeasonsFeatureEnabled,
} from "../services/db/seasonsFeature.js";
import {
  seasonKeySchema,
  seasonsDisableInputSchema,
  seasonsEnableInputSchema,
  seasonUpdateInputSchema,
} from "../schemas/seasons.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { ApiError, BadRequestError, ConflictError } from "../shared/errors/apiErrors.js";
import { HRU_SETTINGS_KEY, type HruSettings } from "../types/index.js";
import type { HruService } from "../features/hru/hru.service.js";
import type { TimelineScheduler } from "../services/timelineScheduler.js";

export function createSeasonsRouter(
  logger: Logger,
  hruService: HruService,
  timelineScheduler: TimelineScheduler,
) {
  const router = Router();

  /** Mirrors the timeline router: an explicit unit wins, else the configured one. */
  function getCurrentUnitId(unitIdOverride?: string): string | null {
    try {
      if (unitIdOverride) return unitIdOverride;
      const raw = getAppSetting(HRU_SETTINGS_KEY);
      const settings = raw ? (JSON.parse(raw) as HruSettings) : null;
      if (settings?.unit) return settings.unit;
      return hruService.getAllUnits()[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Seasons plus everything the Settings section needs to render without a
   * second round trip: which one is active, and where the outstanding work is.
   */
  router.get("/", (request: Request, response: Response, next: NextFunction) => {
    try {
      const hruId = getCurrentUnitId(request.query.unitId as string);
      const featureEnabled = isSeasonsFeatureEnabled();

      // Only materialise the four rows once the feature is on. Creating them on
      // a read left a feature-off install holding four seasons with none
      // enabled: it broke the "feature off means one timeline row" invariant
      // the disable flow works to preserve, and the scheduler then reported
      // "no season is enabled" on every tick of a perfectly normal install.
      const seasons = featureEnabled ? ensureSeasons(hruId) : getSeasons(hruId);
      const active = resolveActiveSeason(hruId);

      const summary = seasons.map((season) => {
        const modes = getTimelineModes(hruId ?? undefined, season.id);
        return {
          ...season,
          isActive: season.id === active?.id,
          unconfiguredModes: modes.filter((mode) => mode.configured === false).length,
          enabledEvents: getTimelineEvents(hruId, season.id).filter((event) => event.enabled)
            .length,
        };
      });

      response.json({
        featureEnabled,
        activeSeasonId: active?.id ?? null,
        seasons: summary,
      });
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      logger.error({ error }, "Failed to list seasons");
      next(error);
    }
  });

  /** Dry run for the disable confirmation: what would be deleted, per season. */
  router.get("/disable-impact", (request: Request, response: Response, next: NextFunction) => {
    try {
      const hruId = getCurrentUnitId(request.query.unitId as string);
      // An unvalidated key marks every season as "not kept", so the dialog
      // would list the season that actually survives among the parked ones.
      const parsed = seasonKeySchema.safeParse(request.query.keepSeasonKey);
      const keep: SeasonKey = parsed.success ? parsed.data : "spring";
      response.json({ keepSeasonKey: keep, seasons: getDisableImpact(hruId, keep) });
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      logger.error({ error }, "Failed to compute disable impact");
      next(error);
    }
  });

  /**
   * Enable/disable a season or move its boundary. Both go through the partition
   * validator server-side, not only in the drag UI: this endpoint is reachable
   * directly, and a partition with no enabled season would leave the unit with
   * no schedule on any day of the year.
   */
  router.patch(
    "/:key",
    validateRequest(seasonUpdateInputSchema),
    (request: Request, response: Response, next: NextFunction) => {
      try {
        const key = request.params.key as SeasonKey;
        const hruId = getCurrentUnitId(request.query.unitId as string);
        const { enabled, spanStart } = request.body as { enabled?: boolean; spanStart?: string };

        ensureSeasons(hruId);
        let seasons = getSeasons(hruId);
        if (!seasons.some((season) => season.seasonKey === key)) {
          return next(new BadRequestError(`Unknown season "${key}"`, "UNKNOWN_SEASON"));
        }

        try {
          // Both parts go through one validation and one transaction: applying
          // them separately left a rejected request with the boundary already
          // moved while the client had rolled its own state back.
          seasons = updateSeason(hruId, key, { spanStart, enabled });
        } catch (validationError) {
          return next(
            new ConflictError(
              validationError instanceof Error ? validationError.message : "Invalid season change",
              "INVALID_SEASON_PARTITION",
            ),
          );
        }

        // The active season may have moved under the scheduler.
        timelineScheduler.restart();
        response.json({ seasons });
      } catch (error) {
        if (error instanceof ApiError) return next(error);
        logger.error({ error }, "Failed to update season");
        next(error);
      }
    },
  );

  router.post(
    "/enable",
    validateRequest(seasonsEnableInputSchema),
    (request: Request, response: Response, next: NextFunction) => {
      try {
        const hruId = getCurrentUnitId(request.query.unitId as string);
        const { cloneCurrent } = request.body as { cloneCurrent: boolean };

        const seasons = enableSeasonsFeature(hruId, cloneCurrent);
        timelineScheduler.restart();

        logger.info({ hruId, cloneCurrent }, "Seasons enabled");
        response.json({ featureEnabled: true, seasons });
      } catch (error) {
        if (error instanceof ApiError) return next(error);
        logger.error({ error }, "Failed to enable seasons");
        next(error);
      }
    },
  );

  router.post(
    "/disable",
    validateRequest(seasonsDisableInputSchema),
    (request: Request, response: Response, next: NextFunction) => {
      try {
        const hruId = getCurrentUnitId(request.query.unitId as string);
        const { keepSeasonKey } = request.body as { keepSeasonKey: SeasonKey };

        disableSeasonsFeature(hruId, keepSeasonKey);
        timelineScheduler.restart();

        logger.info({ hruId, keepSeasonKey }, "Seasons disabled, collapsed to one season");
        response.json({ featureEnabled: false, seasons: getSeasons(hruId) });
      } catch (error) {
        if (error instanceof ApiError) return next(error);
        logger.error({ error }, "Failed to disable seasons");
        next(error);
      }
    },
  );

  return router;
}
