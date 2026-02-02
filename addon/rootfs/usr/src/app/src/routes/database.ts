import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import fs from "fs";
import {
  getDatabasePath,
  replaceDatabaseWithFile,
  createDatabaseBackup,
  checkpointDatabase,
} from "../services/database";
import type { ValveController } from "../core/valveManager";

export function createDatabaseRouter(valveManager: ValveController, logger: Logger) {
  const router = Router();

  router.get("/export", async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const dbPath = getDatabasePath();
      if (!fs.existsSync(dbPath)) {
        logger.warn({ dbPath }, "Database export requested but file missing");
        response.status(404).json({ detail: "Database file not found" });
        return;
      }

      logger.info({ dbPath }, "Streaming database export");

      // Flush WAL to main DB file before export
      checkpointDatabase();

      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("Content-Disposition", "attachment; filename=luftator.db");
      fs.createReadStream(dbPath)
        .on("error", (error) => next(error))
        .pipe(response);
    } catch (error) {
      next(error);
    }
  });

  router.post("/import", async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.body || !(request.body instanceof Buffer) || request.body.length === 0) {
        response.status(400).json({ detail: "Request body must be a binary SQLite file" });
        return;
      }

      const buffer = request.body as Buffer;
      if (!buffer.subarray(0, 16).toString("utf-8").includes("SQLite format")) {
        logger.warn({ length: buffer.length }, "Rejected database import: invalid signature");
        response
          .status(400)
          .json({ detail: "Uploaded file does not appear to be a SQLite database" });
        return;
      }

      logger.info({ size: buffer.length }, "Replacing database from uploaded file");
      await createDatabaseBackup();
      await replaceDatabaseWithFile(buffer);

      logger.info("Database import completed, restarting valve manager");
      await valveManager.stop();
      await valveManager.start();

      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
