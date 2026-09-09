import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "pino";
import net from "node:net";
import type { ValveController } from "../core/valveManager.js";
import { isValveAvailable } from "../core/valveAvailability.js";
import type { HomeAssistantClient } from "../services/homeAssistantClient.js";
import type { MqttService } from "../services/mqttService.js";
import { getRecentServerLogs, getServerLogBufferSize } from "../logger.js";
import { APP_VERSION } from "../constants.js";
import { validateQuery } from "../middleware/validateRequest.js";
import { type ModbusStatusQuery, modbusStatusQuerySchema } from "../schemas/status.js";
import {
  getModbusStatusFor,
  getSharedModbusClient,
  isModbusReachable,
} from "../shared/modbus/client.js";
import {
  type ActiveTimelineState,
  buildDebugSnapshot,
  buildHomeAssistantApiSnapshot,
  buildHomeAssistantEntitiesSnapshot,
  type DiagnosticsDeps,
  loadSavedHruSettings,
  resolveHassHost,
} from "../features/support/diagnostics.js";

function parseLogLimit(rawLimit: unknown, defaultLimit: number): number {
  const parsedLimit = Number.parseInt(String(rawLimit ?? defaultLimit), 10);
  return Number.isFinite(parsedLimit) ? parsedLimit : defaultLimit;
}

function sendJsonDownload(response: Response, payload: unknown, filenamePrefix: string): void {
  const filename = `${filenamePrefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  response.send(JSON.stringify(payload, null, 2));
}

export function createStatusRouter(
  valveManager: ValveController,
  haClient: HomeAssistantClient | null,
  mqttService: MqttService,
  logger: Logger,
  timelineScheduler: {
    getActiveState: () => ActiveTimelineState;
    getBoostRemainingMinutes?: () => number;
    getActiveBoostName?: () => string | null;
    getFormattedActiveMode?: () => string;
  },
  baseUrl: string,
  appStartedAt: Date,
) {
  const router = Router();

  const diagnosticsDeps: DiagnosticsDeps = {
    valveManager,
    haClient,
    mqttService,
    timelineScheduler,
    baseUrl,
    appStartedAt,
  };

  router.get("/status", async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const snapshot = await valveManager.getSnapshot();
      const valves = {
        total: snapshot.length,
        hasUnavailable: snapshot.some((item) => !isValveAvailable(item)),
        unavailableEntities: snapshot
          .filter((item) => !isValveAvailable(item))
          .map((item) => item.entity_id),
      };
      const ha = haClient
        ? { connection: haClient.getConnectionState() }
        : { connection: "offline" };
      const mqttConnectionStatus = mqttService.getStatus();
      const mqtt = {
        connection: mqttConnectionStatus.connected ? "connected" : "disconnected",
        lastDiscovery: mqttService.getLastDiscoveryTime(),
        lastErrorMessage: mqttConnectionStatus.lastErrorMessage,
        lastErrorCode: mqttConnectionStatus.lastErrorCode,
        lastErrorAt: mqttConnectionStatus.lastErrorAt,
      };
      const timeline = timelineScheduler.getActiveState();
      const savedSettings = loadSavedHruSettings();
      const modbus = savedSettings?.host
        ? getModbusStatusFor({
            host: savedSettings.host,
            port: savedSettings.port ?? 502,
            unitId: savedSettings.unitId ?? 1,
          })
        : null;
      logger.debug({ ha, mqtt, timeline, valves, modbus }, "Status check");
      response.json({ ha, mqtt, modbus, timeline, valves, version: APP_VERSION });
    } catch (error) {
      logger.error({ error }, "Failed to get status");
      next(error);
    }
  });

  router.get("/system-info", (_request: Request, response: Response, next: NextFunction) => {
    try {
      const hassHost = resolveHassHost(baseUrl);

      logger.debug({ hassHost }, "System info check");
      response.json({ hassHost });
    } catch (error) {
      logger.error({ error }, "Failed to get system info");
      next(error);
    }
  });

  async function probeTcp(host: string, port: number, timeoutMs = 1500): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      let done = false;

      function finalize(error?: Error) {
        if (done) return;
        done = true;
        try {
          if (!socket.destroyed) {
            socket.destroy();
          }
        } catch (error) {
          logger.error({ error }, "Failed to destroy socket");
        }
        if (error) reject(error);
        else resolve();
      }

      socket.setTimeout(timeoutMs);
      socket.once("error", (error) => finalize(error));
      socket.once("timeout", () => finalize(new Error("timeout")));
      socket.connect(port, host, () => finalize());
    });
  }

  router.get(
    "/modbus/status",
    validateQuery(modbusStatusQuerySchema),
    async (
      request: Request<
        Record<string, never>,
        Record<string, never>,
        Record<string, never>,
        ModbusStatusQuery
      >,
      response: Response,
      next: NextFunction,
    ) => {
      try {
        const query = request.query;
        const hostQ = query.host;
        const portQ = query.port;

        const savedSettings = loadSavedHruSettings();

        const host = hostQ || savedSettings?.host || "localhost";
        const port = portQ ? Number(portQ) : (savedSettings?.port ?? 502);

        if (isModbusReachable(host, port)) {
          logger.debug({ host, port }, "Modbus reachable (cached)");
          response.json({ reachable: true });
          return;
        }

        if (host === savedSettings?.host && port === savedSettings?.port) {
          try {
            const unitId = savedSettings?.unitId ?? 1;
            const sharedClient = getSharedModbusClient({ host, port, unitId }, logger);
            // Serialize under the op lock so this probe can't swap the socket
            // mid-transaction while a runBatch (HRU poll/write) is in flight.
            if (await sharedClient.connectSerialized()) {
              logger.debug({ host, port }, "Modbus reachable (shared client)");
              response.json({ reachable: true });
              return;
            }
          } catch (error) {
            logger.debug({ error }, "Shared Modbus client connection failed during status probe");
          }
        }

        try {
          await probeTcp(host, port);
          logger.info({ host, port }, "Modbus TCP probe successful");
          response.json({ reachable: true });
        } catch (error) {
          logger.warn({ host, port, error }, "Modbus TCP probe failed");
          response.json({
            reachable: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } catch (error) {
        logger.error({ error }, "Failed to get Modbus status");
        next(error);
      }
    },
  );

  router.get("/debug", async (_request: Request, response: Response, next: NextFunction) => {
    try {
      const payload = await buildDebugSnapshot(diagnosticsDeps);
      response.json(payload);
    } catch (error) {
      logger.error({ error }, "Failed to get debug snapshot");
      next(error);
    }
  });

  router.get(
    "/debug/download",
    async (_request: Request, response: Response, next: NextFunction) => {
      try {
        const payload = await buildDebugSnapshot(diagnosticsDeps);
        sendJsonDownload(response, payload, "luftator-debug");
      } catch (error) {
        logger.error({ error }, "Failed to download debug snapshot");
        next(error);
      }
    },
  );

  router.get(
    "/debug/home-assistant",
    async (_request: Request, response: Response, next: NextFunction) => {
      try {
        const payload = await buildHomeAssistantApiSnapshot(haClient);
        response.json(payload);
      } catch (error) {
        logger.error({ error }, "Failed to fetch Home Assistant debug API data");
        next(error);
      }
    },
  );

  router.get(
    "/debug/home-assistant/download",
    async (_request: Request, response: Response, next: NextFunction) => {
      try {
        const payload = await buildHomeAssistantApiSnapshot(haClient);
        sendJsonDownload(response, payload, "luftator-ha-api");
      } catch (error) {
        logger.error({ error }, "Failed to download Home Assistant debug API data");
        next(error);
      }
    },
  );

  router.get(
    "/debug/home-assistant/entities",
    async (_request: Request, response: Response, next: NextFunction) => {
      try {
        const payload = await buildHomeAssistantEntitiesSnapshot(haClient);
        response.json(payload);
      } catch (error) {
        logger.error({ error }, "Failed to fetch Home Assistant entities");
        next(error);
      }
    },
  );

  router.get("/debug/logs", (request: Request, response: Response, next: NextFunction) => {
    try {
      const limit = parseLogLimit(request.query.limit, 300);
      const logs = getRecentServerLogs(limit);

      response.json({
        logs,
        count: logs.length,
        bufferedCount: getServerLogBufferSize(),
        limit,
      });
    } catch (error) {
      logger.error({ error }, "Failed to get server logs");
      next(error);
    }
  });

  router.get("/debug/logs/download", (request: Request, response: Response, next: NextFunction) => {
    try {
      const limit = parseLogLimit(request.query.limit, 1000);
      const logs = getRecentServerLogs(limit);
      const text = logs.map((entry) => entry.line).join("\n");
      const filename = `luftator-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;

      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      response.send(text);
    } catch (error) {
      logger.error({ error }, "Failed to download server logs");
      next(error);
    }
  });

  return router;
}
