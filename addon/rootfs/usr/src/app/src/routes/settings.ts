import { Router } from "express";
import type { Request, Response } from "express";
import type { Logger } from "pino";
import { getAppSetting, setAppSetting } from "../services/database";
import type { HomeAssistantClient } from "../services/homeAssistantClient";
import type { MqttService } from "../services/mqttService";
import {
  HRU_SETTINGS_KEY,
  ADDON_MODE_KEY,
  ADDON_MODES,
  type AddonMode,
  THEME_SETTING_KEY,
  LANGUAGE_SETTING_KEY,
  TEMP_UNIT_SETTING_KEY,
  DEBUG_MODE_KEY,
  ONBOARDING_DONE_KEY,
  type HruSettings,
  MQTT_SETTINGS_KEY,
  type MqttSettings,
} from "../types";
import {
  addonModeInputSchema,
  hruSettingsInputSchema,
  languageSettingInputSchema,
  mqttSettingsInputSchema,
  mqttTestInputSchema,
  temperatureUnitInputSchema,
  themeSettingInputSchema,
  debugModeInputSchema,
} from "../schemas/settings";
import type { HruService } from "../features/hru/hru.service";
import { validateRequest } from "../middleware/validateRequest";

export function createSettingsRouter(
  hruService: HruService,
  mqttService: MqttService,
  haClient: HomeAssistantClient | null,
  logger: Logger,
) {
  const router = Router();

  router.get("/onboarding-status", async (_request: Request, response: Response) => {
    function isTruthy(val: string | null) {
      return val === "true" || val === "1" || val === "yes";
    }

    const hruSettings = getAppSetting(HRU_SETTINGS_KEY);
    const hruConfigured = !!(hruSettings && JSON.parse(String(hruSettings)).unit);

    const mqttSettings = getAppSetting(MQTT_SETTINGS_KEY);
    const mqttConfigured = !!(mqttSettings && JSON.parse(String(mqttSettings)).enabled);

    let luftatorAvailable = false;
    if (haClient) {
      try {
        const entities = await haClient.fetchLuftatorEntities();
        luftatorAvailable = entities.length > 0;
      } catch (err) {
        logger.warn({ err }, "Failed to check Luftator status in HASS");
      }
    }

    const onboardingDone = isTruthy(getAppSetting(ONBOARDING_DONE_KEY));

    response.json({
      onboardingDone,
      hruConfigured,
      mqttConfigured,
      luftatorAvailable,
    });
  });

  router.post("/onboarding-finish", (_request: Request, response: Response) => {
    setAppSetting(ONBOARDING_DONE_KEY, "true");
    response.status(204).end();
  });

  router.post("/onboarding-reset", (_request: Request, response: Response) => {
    setAppSetting(ONBOARDING_DONE_KEY, "false");
    response.status(204).end();
  });

  router.get("/units", (_request: Request, response: Response) => {
    const units = hruService.getAllUnits();
    response.json(
      units.map((u) => ({
        id: u.id,
        name: u.name,
        code: u.code,
      })),
    );
  });

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

  router.post(
    "/mqtt",
    validateRequest(mqttSettingsInputSchema),
    async (request: Request, response: Response) => {
      const { enabled, host, port, user, password } = request.body as MqttSettings;

      const settings: MqttSettings = {
        enabled,
        host: host ?? "",
        port: port ?? 1883,
        user,
        password,
      };
      setAppSetting(MQTT_SETTINGS_KEY, JSON.stringify(settings));

      await mqttService.reloadConfig();

      response.status(204).end();
    },
  );

  router.post(
    "/mqtt/test",
    validateRequest(mqttTestInputSchema),
    async (request: Request, response: Response) => {
      const { host, port, user, password } = request.body;

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
        response
          .status(500)
          .json({ detail: err instanceof Error ? err.message : "Internal error" });
      }
    },
  );

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

    if (value.unit) {
      const unitDef = hruService.getAllUnits().find((u) => u.id === value.unit);
      if (unitDef) {
        if (!unitDef.isConfigurable) {
          value.maxPower = undefined;
        } else if (value.maxPower !== undefined && unitDef.maxValue !== undefined) {
          value.maxPower = Math.min(value.maxPower, unitDef.maxValue);
        }
      }
    }

    response.json(value);
  });

  router.post(
    "/hru",
    validateRequest(hruSettingsInputSchema),
    (request: Request, response: Response) => {
      const { unit, host, port, unitId, maxPower } = request.body;

      if (unit !== undefined && !hruService.getAllUnits().some((u) => u.id === unit)) {
        response.status(400).json({ detail: "Unknown HRU unit id" });
        return;
      }

      const resolvedUnit = unit ?? null;
      const resolvedUnitId = unitId ?? 1;

      // Validate maxPower against unit's actual maximum
      if (maxPower !== undefined && resolvedUnit !== null) {
        const selectedUnit = hruService.getAllUnits().find((u) => u.id === resolvedUnit);
        if (selectedUnit && selectedUnit.isConfigurable) {
          const unitMaxValue = selectedUnit.maxValue;
          if (maxPower > unitMaxValue) {
            response.status(400).json({
              detail: `Maximum power cannot exceed ${unitMaxValue} ${selectedUnit.controlUnit || ""}. The selected unit supports a maximum of ${unitMaxValue}.`,
            });
            return;
          }
        }
      }

      const settings: HruSettings = {
        unit: resolvedUnit,
        host,
        port,
        unitId: resolvedUnitId,
        maxPower,
      };
      setAppSetting(HRU_SETTINGS_KEY, JSON.stringify(settings));
      response.status(204).end();
    },
  );

  router.get("/mode", (_request: Request, response: Response) => {
    const raw = getAppSetting(ADDON_MODE_KEY);
    const mode = ADDON_MODES.includes(raw as AddonMode) ? raw : "manual";
    response.json({ mode });
  });

  router.post(
    "/mode",
    validateRequest(addonModeInputSchema),
    (request: Request, response: Response) => {
      const { mode } = request.body;
      setAppSetting(ADDON_MODE_KEY, mode);
      response.status(204).end();
    },
  );

  router.get("/theme", (_request: Request, response: Response) => {
    const theme = getAppSetting(THEME_SETTING_KEY) ?? "light";
    response.json({ theme });
  });

  router.post(
    "/theme",
    validateRequest(themeSettingInputSchema),
    (request: Request, response: Response) => {
      const { theme } = request.body;
      setAppSetting(THEME_SETTING_KEY, theme);
      response.status(204).end();
    },
  );

  router.get("/language", (_request: Request, response: Response) => {
    const language = getAppSetting(LANGUAGE_SETTING_KEY) ?? "cs";
    response.json({ language });
  });

  router.post(
    "/language",
    validateRequest(languageSettingInputSchema),
    (request: Request, response: Response) => {
      const { language } = request.body;
      setAppSetting(LANGUAGE_SETTING_KEY, language);
      response.status(204).end();
    },
  );

  router.get("/temperature-unit", (_request: Request, response: Response) => {
    const temperatureUnit = getAppSetting(TEMP_UNIT_SETTING_KEY) ?? "c";
    response.json({ temperatureUnit });
  });

  router.post(
    "/temperature-unit",
    validateRequest(temperatureUnitInputSchema),
    (request: Request, response: Response) => {
      const { temperatureUnit } = request.body;
      setAppSetting(TEMP_UNIT_SETTING_KEY, temperatureUnit);
      response.status(204).end();
    },
  );

  router.get("/debug-mode", (_request: Request, response: Response) => {
    const raw = getAppSetting(DEBUG_MODE_KEY);
    const enabled = raw === "true";
    response.json({ enabled });
  });

  router.post(
    "/debug-mode",
    validateRequest(debugModeInputSchema),
    (request: Request, response: Response) => {
      const { enabled } = request.body;
      setAppSetting(DEBUG_MODE_KEY, String(enabled));
      response.status(204).end();
    },
  );

  return router;
}
