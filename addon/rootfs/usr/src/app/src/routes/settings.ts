import { Router } from "express";
import type { Request, Response } from "express";
import type { Logger } from "pino";
import { getAppSetting, setAppSetting } from "../services/database";
import type { MqttService } from "../services/mqttService";
import {
  HRU_SETTINGS_KEY,
  ADDON_MODE_KEY,
  ADDON_MODES,
  type AddonMode,
  THEME_SETTING_KEY,
  LANGUAGE_SETTING_KEY,
  SUPPORTED_LANGUAGES,
  type HruSettings,
  MQTT_SETTINGS_KEY,
  type MqttSettings,
} from "../types";
import { HRU_UNITS } from "../hru/definitions";

export function createSettingsRouter(mqttService: MqttService, logger: Logger) {
  const router = Router();

  // MQTT Settings
  router.get("/mqtt", (_request: Request, response: Response) => {
    const raw = getAppSetting(MQTT_SETTINGS_KEY);
    let value: MqttSettings;
    try {
      value = raw
        ? (JSON.parse(String(raw)) as MqttSettings)
        : { enabled: false, host: "", port: 1883 };
    } catch {
      logger.warn({ raw }, "Failed to parse stored MQTT settings; falling back to defaults");
      value = { enabled: false, host: "", port: 1883 };
    }
    response.json(value);
  });

  router.post("/mqtt", async (request: Request, response: Response) => {
    const body = request.body as Partial<MqttSettings>;
    const enabled = Boolean(body.enabled);
    const host = (body.host ?? "").toString().trim();
    const port = Number(body.port);
    const user = body.user;
    const password = body.password;

    if (enabled) {
      if (!host) {
        response.status(400).json({ detail: "Missing host" });
        return;
      }
      if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        response.status(400).json({ detail: "Invalid port" });
        return;
      }
    }

    const settings: MqttSettings = { enabled, host, port, user, password };
    setAppSetting(MQTT_SETTINGS_KEY, JSON.stringify(settings));

    // Trigger reload
    await mqttService.reloadConfig();

    response.status(204).end();
  });

  router.post("/mqtt/test", async (request: Request, response: Response) => {
    const body = request.body as Partial<MqttSettings>;
    const host = (body.host ?? "").toString().trim();
    const port = Number(body.port);
    const user = body.user;
    const password = body.password;

    if (!host) {
      response.status(400).json({ detail: "Missing host" });
      return;
    }

    try {
      const result = await (mqttService.constructor as typeof MqttService).testConnection(
        { enabled: true, host, port, user, password },
        logger,
      );

      if (result.success) {
        response.json({ success: true });
      } else {
        response.status(502).json({ detail: result.message || "Connection failed" });
      }
    } catch (err) {
      logger.error({ err }, "MQTT test connection error");
      response.status(500).json({ detail: err instanceof Error ? err.message : "Internal error" });
    }
  });

  // HRU Settings
  router.get("/hru", (_request: Request, response: Response) => {
    const raw = getAppSetting(HRU_SETTINGS_KEY);
    let value: HruSettings;
    try {
      value = raw
        ? (JSON.parse(String(raw)) as HruSettings)
        : { unit: null, host: "localhost", port: 502, unitId: 1 };
    } catch {
      logger.warn({ raw }, "Failed to parse stored HRU settings; falling back to defaults");
      value = { unit: null, host: "localhost", port: 502, unitId: 1 };
    }
    response.json(value);
  });

  router.post("/hru", (request: Request, response: Response) => {
    const body = request.body as Partial<HruSettings>;
    const unit = body.unit ?? null;
    const host = (body.host ?? "").toString().trim();
    const port = Number(body.port);
    const unitId = Number(body.unitId);

    if (unit !== null && !HRU_UNITS.some((u) => u.id === unit)) {
      response.status(400).json({ detail: "Unknown HRU unit id" });
      return;
    }
    if (!host) {
      response.status(400).json({ detail: "Missing host" });
      return;
    }
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      response.status(400).json({ detail: "Invalid port" });
      return;
    }
    if (!Number.isFinite(unitId) || unitId <= 0 || unitId > 247) {
      response.status(400).json({ detail: "Invalid unitId" });
      return;
    }

    const settings: HruSettings = { unit, host, port, unitId };
    setAppSetting(HRU_SETTINGS_KEY, JSON.stringify(settings));
    response.status(204).end();
  });

  // Addon Mode
  router.get("/mode", (_request: Request, response: Response) => {
    const raw = getAppSetting(ADDON_MODE_KEY);
    const mode = ADDON_MODES.includes(raw as AddonMode) ? raw : "manual";
    response.json({ mode });
  });

  router.post("/mode", (request: Request, response: Response) => {
    const { mode } = request.body as { mode?: string };
    if (!mode || !ADDON_MODES.includes(mode as AddonMode)) {
      response.status(400).json({ detail: "Invalid mode" });
      return;
    }
    setAppSetting(ADDON_MODE_KEY, mode);
    response.status(204).end();
  });

  // Theme
  router.get("/theme", (_request: Request, response: Response) => {
    const theme = getAppSetting(THEME_SETTING_KEY) ?? "light";
    response.json({ theme });
  });

  router.post("/theme", (request: Request, response: Response) => {
    const { theme } = request.body as { theme?: string };
    if (theme !== "light" && theme !== "dark") {
      response.status(400).json({ detail: "Invalid theme value" });
      return;
    }
    setAppSetting(THEME_SETTING_KEY, theme);
    response.status(204).end();
  });

  // Language
  router.get("/language", (_request: Request, response: Response) => {
    const language = getAppSetting(LANGUAGE_SETTING_KEY) ?? "cs";
    response.json({ language });
  });

  router.post("/language", (request: Request, response: Response) => {
    const { language } = request.body as { language?: string };
    if (!language || !SUPPORTED_LANGUAGES.has(language)) {
      response.status(400).json({ detail: "Invalid language value" });
      return;
    }
    setAppSetting(LANGUAGE_SETTING_KEY, language);
    response.status(204).end();
  });

  return router;
}
