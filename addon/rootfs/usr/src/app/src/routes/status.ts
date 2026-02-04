import { Router } from "express";
import type { Request, Response } from "express";
import type { Logger } from "pino";
import net from "net";
import type { HomeAssistantClient } from "../services/homeAssistantClient";
import type { MqttService } from "../services/mqttService";
import { getAppSetting } from "../services/database";
import { HRU_SETTINGS_KEY, type HruSettings } from "../types";
import { APP_VERSION } from "../constants";
import { validateQuery } from "../middleware/validateRequest";
import { type ModbusStatusQuery, modbusStatusQuerySchema } from "../schemas/status";

export function createStatusRouter(
  haClient: HomeAssistantClient | null,
  mqttService: MqttService,
  logger: Logger,
  timelineScheduler: { getActiveState: () => { source: string; modeName?: string } | null },
) {
  const router = Router();

  router.get("/status", (_request: Request, response: Response) => {
    const ha = haClient ? { connection: haClient.getConnectionState() } : { connection: "offline" };
    const mqtt = {
      connection: mqttService.isConnected() ? "connected" : "disconnected",
      lastDiscovery: mqttService.getLastDiscoveryTime(),
    };
    const timeline = timelineScheduler.getActiveState();
    response.json({ ha, mqtt, timeline, version: APP_VERSION });
  });

  async function probeTcp(host: string, port: number, timeoutMs = 1500): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      let done = false;
      function finalize(err?: Error) {
        if (done) return;
        done = true;
        try {
          socket.destroy();
        } catch (err) {
          logger.error({ err }, "Failed to destroy socket");
        }
        if (err) reject(err);
        else resolve();
      }
      socket.setTimeout(timeoutMs);
      socket.once("error", (err) => finalize(err));
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
    ) => {
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
      const port = portQ ?? savedSettings?.port ?? 502;

      try {
        await probeTcp(host, port);
        response.json({ reachable: true });
      } catch (err) {
        logger.warn({ host, port, err }, "Modbus TCP probe failed");
        response.json({
          reachable: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  return router;
}
