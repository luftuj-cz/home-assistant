import { ZipArchive } from "archiver";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/options.js";
import { APP_VERSION } from "../../constants.js";
import type { HomeAssistantClient } from "../../services/homeAssistantClient.js";
import type { MqttService } from "../../services/mqttService.js";
import type { ValveController } from "../../core/valveManager.js";
import type { TimelineSchedulerLike } from "./diagnostics.js";
import { buildBugReportBundle } from "./bundle.service.js";

export type SupportBundleDeps = {
  valveManager: ValveController;
  haClient: HomeAssistantClient | null;
  mqttService: MqttService;
  timelineScheduler: TimelineSchedulerLike;
  baseUrl: string;
  appStartedAt: Date;
  config: AppConfig;
  logger: Logger;
};

export function createSupportBundleRouter(deps: SupportBundleDeps) {
  const { logger } = deps;
  const router = Router();

  router.get("/bundle", async (_request: Request, response: Response, next: NextFunction) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `luftator-bugreport-${APP_VERSION}-${timestamp}.zip`;

    const archive = new ZipArchive({ zlib: { level: 9 } });

    archive.on("warning", (error) => {
      logger.warn({ error }, "Bug report bundle archive warning");
    });

    archive.on("error", (error) => {
      logger.error({ error }, "Bug report bundle archive error");
      // Headers are already sent once piping starts; destroy the response so the
      // client sees a truncated (failed) download rather than a hung request.
      if (!response.headersSent) {
        next(error);
      } else {
        response.destroy(error);
      }
    });

    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    archive.pipe(response);

    // A download cancelled in the browser leaves the archive with no consumer:
    // it stops pulling from its sources and the streamed database copy would sit
    // open, its temp file never released. Aborting drops the pending work and
    // ends the source streams so their cleanup runs.
    let finalized = false;
    response.on("close", () => {
      if (!finalized) {
        logger.info("Bug report download closed before completion, aborting archive");
        archive.abort();
      }
    });

    try {
      const manifest = await buildBugReportBundle(
        {
          diagnostics: {
            valveManager: deps.valveManager,
            haClient: deps.haClient,
            mqttService: deps.mqttService,
            timelineScheduler: deps.timelineScheduler,
            baseUrl: deps.baseUrl,
            appStartedAt: deps.appStartedAt,
          },
          config: deps.config,
          logger,
        },
        archive,
      );

      archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
      logger.info(
        { sources: manifest.sources.filter((s) => s.included).length },
        "Bug report bundle assembled",
      );
      await archive.finalize();
      finalized = true;
    } catch (error) {
      logger.error({ error }, "Failed to assemble bug report bundle");
      if (!response.headersSent) {
        next(error);
      } else {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });

  return router;
}
