import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
import net from "net";
import type { HomeAssistantClient } from "../services/homeAssistantClient";
import type { MqttService } from "../services/mqttService";
import { getAppSetting } from "../services/database";
import { HRU_SETTINGS_KEY, type HruSettings } from "../types";
import { APP_VERSION } from "../constants";
import { validateQuery } from "../middleware/validateRequest";
import { type ModbusStatusQuery, modbusStatusQuerySchema } from "../schemas/status";
import { getSharedModbusClient, isModbusReachable } from "../shared/modbus/client";

export function createStatusRouter(
  haClient: HomeAssistantClient | null,
  mqttService: MqttService,
  logger: Logger,
  timelineScheduler: {
    getActiveState: () => { source: string; modeName?: string | number } | null;
  },
  baseUrl: string,
) {
  const router = Router();

  router.get("/status", (_request: Request, response: Response) => {
    const ha = haClient ? { connection: haClient.getConnectionState() } : { connection: "offline" };
    const mqtt = {
      connection: mqttService.isConnected() ? "connected" : "disconnected",
      lastDiscovery: mqttService.getLastDiscoveryTime(),
    };
    const timeline = timelineScheduler.getActiveState();
    logger.debug({ ha, mqtt, timeline }, "Status check");
    response.json({ ha, mqtt, timeline, version: APP_VERSION });
  });

  router.get("/system-info", (_request: Request, response: Response, next: NextFunction) => {
    try {
      let hassHost = "localhost";
      if (baseUrl && baseUrl !== "http://supervisor/core") {
        const url = new URL(baseUrl);
        hassHost = url.hostname;
      } else if (baseUrl === "http://supervisor/core") {
        hassHost = "homeassistant.local";
      }

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

        let savedSettings: HruSettings | null;
        try {
          const raw = getAppSetting(HRU_SETTINGS_KEY);
          savedSettings = raw ? (JSON.parse(String(raw)) as HruSettings) : null;
        } catch {
          savedSettings = null;
        }

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

  return router;
}
