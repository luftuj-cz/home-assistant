import { Router } from "express";
import type { Request, Response } from "express";
import type { Logger } from "pino";
import net from "net";
import type { HomeAssistantClient } from "../services/homeAssistantClient";
import type { MqttService } from "../services/mqttService";
import { getAppSetting } from "../services/database";
import { HRU_SETTINGS_KEY, type HruSettings } from "../types";
import { APP_VERSION } from "../constants";

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
        } catch {
          /* empty */
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

  router.get("/modbus/status", async (request: Request, response: Response) => {
    const hostQ = String((request.query.host as string | undefined) ?? "").trim();
    const portQ = String((request.query.port as string | undefined) ?? "").trim();

    let savedSettings: HruSettings | null;
    try {
      const raw = getAppSetting(HRU_SETTINGS_KEY);
      savedSettings = raw ? (JSON.parse(String(raw)) as HruSettings) : null;
    } catch {
      savedSettings = null;
    }

    const host = hostQ || savedSettings?.host || "localhost";
    const parsedPort = Number.parseInt(portQ, 10);
    const port = Number.isFinite(parsedPort)
      ? parsedPort
      : Number.isFinite(savedSettings?.port)
        ? (savedSettings?.port as number)
        : 502;

    try {
      await probeTcp(host, port);
      response.json({ reachable: true });
    } catch (err) {
      logger.warn({ host, port, err }, "Modbus TCP probe failed");
      response.json({ reachable: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
