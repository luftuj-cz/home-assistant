import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "pino";
import {
  ensureSeasons,
  getDatabase,
  getEnabledSeasons,
  getSeasons,
  getTimelineEvents,
  getTimelineModes,
  renameSeason,
  resolveActiveSeason,
  seasonDisplayName,
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
import {
  ApiError,
  BadRequestError,
  ConflictError,
  DetailedConflictError,
} from "../shared/errors/apiErrors.js";
import {
  getCustomModeUsage,
  getModeIdsUsedByCustomTimelines,
} from "../services/db/customTimelines.js";
import {
  type CopiedModeValues,
  copyCustomTimelineModesInto,
  currentLanguage,
  enabledSeasonRefs,
  findModesMissingInSeasons,
  findPlanNameConflict,
  type MissingModeConfiguration,
  type SeasonRef,
  toSeasonRef,
} from "../services/timeline/customTimelineRules.js";
import type { HruService } from "../features/hru/hru.service.js";
import type { TimelineScheduler } from "../services/timelineScheduler.js";
import { resolveCurrentUnitId } from "../services/unitResolution.js";

/**
 * Modes used by custom timelines that would have no values in `seasons`. A
 * custom timeline borrows its values from whichever season is active, so every
 * enabled season has to be able to supply them.
 */
function customTimelineRuleViolation(
  hruId: string | null,
  seasons: SeasonRef[],
): DetailedConflictError | null {
  if (!hruId) return null;
  const missing: MissingModeConfiguration[] = findModesMissingInSeasons(
    hruId,
    getModeIdsUsedByCustomTimelines(hruId),
    seasons,
  );
  if (missing.length === 0) return null;
  const usedBy = missing.map((entry) => ({
    modeId: entry.modeId,
    customTimelines: getCustomModeUsage(hruId, entry.modeId).map((usage) => usage.name),
  }));
  return new DetailedConflictError(
    "Custom timelines use modes that would have no values in an enabled season",
    "MODE_NOT_CONFIGURED_FOR_CUSTOM_TIMELINES",
    { missing, usedBy },
  );
}

/**
 * Where a season being enabled borrows missing custom-timeline mode values
 * from: the active season first, then the other enabled ones.
 */
function copySources(hruId: string): SeasonRef[] {
  const active = resolveActiveSeason(hruId);
  const others = getEnabledSeasons(hruId).filter((season) => season.id !== active?.id);
  return [...(active ? [active] : []), ...others].map(toSeasonRef);
}

export function createSeasonsRouter(
  logger: Logger,
  hruService: HruService,
  timelineScheduler: TimelineScheduler,
) {
  const router = Router();

  function getCurrentUnitId(unitIdOverride?: string): string | null {
    return resolveCurrentUnitId(hruService, unitIdOverride);
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
      const lang = currentLanguage();

      const summary = seasons.map((season) => {
        const modes = getTimelineModes(hruId ?? undefined, season.id);
        return {
          ...season,
          displayName: seasonDisplayName(season, lang),
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
   *
   * Refused while the feature is off. The GET above deliberately does not
   * materialise season rows then, but this used to: a direct call (an
   * automation, a stale client) could enable a second, empty season on an
   * install whose UI said seasons were off - the scheduler then drove the unit
   * to the safe state for half the year with nothing visible to explain it.
   */
  router.patch(
    "/:key",
    validateRequest(seasonUpdateInputSchema),
    (request: Request, response: Response, next: NextFunction) => {
      try {
        const key = request.params.key as SeasonKey;
        const hruId = getCurrentUnitId(request.query.unitId as string);
        const { enabled, spanStart, name } = request.body as {
          enabled?: boolean;
          spanStart?: string;
          name?: string | null;
        };

        if (!isSeasonsFeatureEnabled()) {
          return next(
            new ConflictError(
              "Seasons are disabled; enable the feature before changing a season",
              "SEASONS_FEATURE_DISABLED",
            ),
          );
        }

        ensureSeasons(hruId);
        let seasons = getSeasons(hruId);
        const target = seasons.find((season) => season.seasonKey === key);
        if (!target) {
          return next(new BadRequestError(`Unknown season "${key}"`, "UNKNOWN_SEASON"));
        }

        if (typeof name === "string") {
          const conflict = findPlanNameConflict(hruId, name, { kind: "season", id: target.id });
          if (conflict) {
            return next(
              new DetailedConflictError(
                `The name "${conflict.name}" is already used`,
                "PLAN_NAME_TAKEN",
                { conflict },
              ),
            );
          }
        }

        if (spanStart !== undefined || enabled !== undefined) {
          const db = getDatabase();
          if (!db) throw new Error("Database not initialised");
          let copied: CopiedModeValues[] = [];
          // One transaction for everything the request changes. The copied
          // values and the season update stand or fall together: a rejected
          // boundary used to leave the copies behind in a season that stayed
          // disabled, while the client had rolled its own state back.
          db.transaction(() => {
            if (enabled === true && !target.enabled && hruId) {
              // A disabled season cannot be opened in the editor, so refusing
              // here would leave nowhere to supply the values. Copy them
              // instead, and refuse only what no enabled season can supply.
              copied = copyCustomTimelineModesInto(
                hruId,
                [toSeasonRef(target)],
                copySources(hruId),
              );
              const violation = customTimelineRuleViolation(hruId, [toSeasonRef(target)]);
              if (violation) throw violation;
            }
            try {
              seasons = updateSeason(hruId, key, { spanStart, enabled });
            } catch (validationError) {
              throw new ConflictError(
                validationError instanceof Error
                  ? validationError.message
                  : "Invalid season change",
                "INVALID_SEASON_PARTITION",
              );
            }
          })();
          if (copied.length > 0) {
            logger.info(
              { hruId, key, modes: copied.map((entry) => entry.modeName ?? entry.modeId) },
              "Copied mode values used by custom timelines into the season being enabled",
            );
          }
          // The active season may have moved under the scheduler.
          timelineScheduler.restart();
        }

        if (name !== undefined) {
          seasons = renameSeason(hruId, key, name);
          logger.info({ hruId, key, name }, "Season renamed");
        }

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

        // Checked against the outcome: which seasons end up enabled depends on
        // the parked partition, and a parked season keeps its own values even
        // when copying is on. A violation rolls the whole enable back.
        let violation: DetailedConflictError | null = null;
        try {
          enableSeasonsFeature(hruId, cloneCurrent, (source) => {
            if (!hruId) return;
            // Cloning skips a parked season that kept content of its own, so a
            // mode created while it was parked is still missing there. Copying
            // is what the user asked for, and adding one mode's values touches
            // none of the content the guard protects.
            if (cloneCurrent) {
              copyCustomTimelineModesInto(hruId, enabledSeasonRefs(hruId), [toSeasonRef(source)]);
            }
            violation = customTimelineRuleViolation(hruId, enabledSeasonRefs(hruId));
            if (violation) throw violation;
          });
        } catch (error) {
          if (violation) return next(violation);
          throw error;
        }
        const seasons = getSeasons(hruId);
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

        // The kept season may be a parked one that never got the values a
        // custom timeline uses. Like enabling a season, copy them in from the
        // seasons that were running until now - refusing would force an
        // enable-then-disable detour to reach the same state - and refuse only
        // what none of them can supply. Both happen inside the collapse
        // transaction, so a refusal rolls the whole disable back.
        const sources = hruId ? copySources(hruId) : [];
        let copied: CopiedModeValues[] = [];
        disableSeasonsFeature(hruId, keepSeasonKey, () => {
          if (!hruId) return;
          copied = copyCustomTimelineModesInto(hruId, enabledSeasonRefs(hruId), sources);
          const violation = customTimelineRuleViolation(hruId, enabledSeasonRefs(hruId));
          if (violation) throw violation;
        });
        if (copied.length > 0) {
          logger.info(
            { hruId, keepSeasonKey, modes: copied.map((entry) => entry.modeName ?? entry.modeId) },
            "Copied mode values used by custom timelines into the kept season",
          );
        }
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
