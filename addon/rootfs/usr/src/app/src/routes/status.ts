import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "pino";
import fs from "node:fs";
import net from "node:net";
import type { ValveController } from "../core/valveManager.js";
import { isValveAvailable } from "../core/valveAvailability.js";
import type { HomeAssistantClient } from "../services/homeAssistantClient.js";
import type { MqttService } from "../services/mqttService.js";
import { getAllAppSettings, getAppSetting, getDatabasePath } from "../services/database.js";
import { getRecentServerLogs, getServerLogBufferSize } from "../logger.js";
import { HRU_SETTINGS_KEY, type HruSettings } from "../types/index.js";
import { APP_VERSION } from "../constants.js";
import { validateQuery } from "../middleware/validateRequest.js";
import { type ModbusStatusQuery, modbusStatusQuerySchema } from "../schemas/status.js";
import {
  getModbusStatusFor,
  getSharedModbusClient,
  isModbusReachable,
} from "../shared/modbus/client.js";

type ActiveTimelineState = { source: string; modeName?: string | number } | null;

function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0 || days > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

function loadSavedHruSettings(): HruSettings | null {
  try {
    const raw = getAppSetting(HRU_SETTINGS_KEY);
    return raw ? (JSON.parse(String(raw)) as HruSettings) : null;
  } catch {
    return null;
  }
}

function parseSettings(settings: Record<string, string>): Record<string, unknown> {
  return Object.entries(settings).reduce<Record<string, unknown>>((acc, [key, value]) => {
    try {
      acc[key] = JSON.parse(value);
    } catch {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function parseLogLimit(rawLimit: unknown, defaultLimit: number): number {
  const parsedLimit = Number.parseInt(String(rawLimit ?? defaultLimit), 10);
  return Number.isFinite(parsedLimit) ? parsedLimit : defaultLimit;
}

function resolveHassHost(baseUrl: string): string {
  if (baseUrl && baseUrl !== "http://supervisor/core") {
    const url = new URL(baseUrl);
    return url.hostname;
  }
  if (baseUrl === "http://supervisor/core") {
    return "homeassistant.local";
  }
  return "localhost";
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
      const mqtt = {
        connection: mqttService.isConnected() ? "connected" : "disconnected",
        lastDiscovery: mqttService.getLastDiscoveryTime(),
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
            if (!sharedClient.isConnected()) {
              await sharedClient.connect();
            }
            if (sharedClient.isConnected()) {
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
      const snapshot = await valveManager.getSnapshot();
      const unavailableEntities = snapshot
        .filter((item) => !isValveAvailable(item))
        .map((item) => item.entity_id);
      const timelineState = timelineScheduler.getActiveState();
      const allSettings = getAllAppSettings();
      const parsedSettings = parseSettings(allSettings);

      const now = new Date();
      const appUptimeSeconds = Math.max(
        0,
        Math.floor((now.getTime() - appStartedAt.getTime()) / 1000),
      );
      const processUptimeSeconds = Math.max(0, Math.floor(process.uptime()));

      const dbPath = getDatabasePath();
      const dbExists = fs.existsSync(dbPath);
      const dbStat = dbExists ? fs.statSync(dbPath) : null;
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      const mqttLastSuccessAtMs = mqttService.getLastSuccessAt();
      const logBufferSize = getServerLogBufferSize();

      const payload = {
        capturedAt: now.toISOString(),
        app: {
          version: APP_VERSION,
          startedAt: appStartedAt.toISOString(),
          uptimeSeconds: appUptimeSeconds,
          uptimeHuman: formatDuration(appUptimeSeconds),
          processUptimeSeconds,
          processUptimeHuman: formatDuration(processUptimeSeconds),
          pid: process.pid,
          ppid: process.ppid,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          cwd: process.cwd(),
          memory: process.memoryUsage(),
        },
        system: {
          hassBaseUrl: baseUrl,
          hassHost: resolveHassHost(baseUrl),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        services: {
          homeAssistant: {
            configured: haClient !== null,
            connection: haClient ? haClient.getConnectionState() : "offline",
          },
          mqtt: {
            connection: mqttService.isConnected() ? "connected" : "disconnected",
            lastDiscovery: mqttService.getLastDiscoveryTime(),
            lastSuccessAtMs: mqttLastSuccessAtMs,
            lastSuccessAt:
              mqttLastSuccessAtMs === null ? null : new Date(mqttLastSuccessAtMs).toISOString(),
          },
          timeline: {
            activeState: timelineState,
            formattedActiveMode: timelineScheduler.getFormattedActiveMode?.() ?? null,
            boostRemainingMinutes: timelineScheduler.getBoostRemainingMinutes?.() ?? null,
            activeBoostName: timelineScheduler.getActiveBoostName?.() ?? null,
          },
          valves: {
            total: snapshot.length,
            unavailableCount: unavailableEntities.length,
            unavailableEntities,
          },
        },
        database: {
          path: dbPath,
          exists: dbExists,
          sizeBytes: dbStat?.size ?? null,
          modifiedAt: dbStat?.mtime.toISOString() ?? null,
          walExists: fs.existsSync(walPath),
          shmExists: fs.existsSync(shmPath),
        },
        logs: {
          bufferedCount: logBufferSize,
          maxBufferedCount: 1_000,
        },
        settings: {
          raw: allSettings,
          parsed: parsedSettings,
        },
      };

      logger.debug(
        {
          appUptimeSeconds,
          settingsCount: Object.keys(allSettings).length,
          valvesTotal: snapshot.length,
          logBufferSize,
        },
        "Debug snapshot generated",
      );

      response.json(payload);
    } catch (error) {
      logger.error({ error }, "Failed to get debug snapshot");
      next(error);
    }
  });

  router.get(
    "/debug/home-assistant",
    async (_request: Request, response: Response, next: NextFunction) => {
      try {
        const capturedAt = new Date().toISOString();

        if (!haClient) {
          response.json({
            capturedAt,
            available: false,
            connection: "offline",
            detail: "Home Assistant client is not configured",
          });
          return;
        }

        const [config, luftatorEntities] = await Promise.all([
          haClient.fetchConfig(),
          haClient.fetchLuftatorEntities(),
        ]);

        response.json({
          capturedAt,
          available: true,
          connection: haClient.getConnectionState(),
          config,
          luftatorEntityCount: luftatorEntities.length,
          luftatorEntities,
        });
      } catch (error) {
        logger.error({ error }, "Failed to fetch Home Assistant debug API data");
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
