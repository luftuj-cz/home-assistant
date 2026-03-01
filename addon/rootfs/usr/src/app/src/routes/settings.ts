import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
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
  themeSettingInputSchema,
  debugModeInputSchema,
  type HruSettingsInput,
  type MqttSettingsInput,
  type MqttTestInput,
  type AddonModeInput,
  type ThemeSettingInput,
  type LanguageSettingInput,
  type DebugModeInput,
} from "../schemas/settings";
import type { HruService } from "../features/hru/hru.service";
import { validateRequest } from "../middleware/validateRequest";
import {
  ApiError,
  ApiSuccess,
  BadRequestError,
  ServiceUnavailableError,
} from "../shared/errors/apiErrors";

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

    logger.debug({ onboardingDone, hruConfigured, mqttConfigured }, "Onboarding status check");

    response.json({
      onboardingDone,
      hruConfigured,
      mqttConfigured,
      luftatorAvailable,
    });
  });

  router.post(
    "/onboarding-finish",
    async (_request: Request, response: Response, next: NextFunction) => {
      try {
        setAppSetting(ONBOARDING_DONE_KEY, "true");
        logger.info("Onboarding finished; restarting MQTT service");

        await mqttService.reloadConfig();

        response.status(204).end();
      } catch (error) {
        logger.error({ error }, "Failed to finish onboarding");
        next(error);
      }
    },
  );

  router.post("/onboarding-reset", (_request: Request, response: Response, next: NextFunction) => {
    try {
      setAppSetting(ONBOARDING_DONE_KEY, "false");
      logger.info("Onboarding reset");
      response.status(204).end();
    } catch (error) {
      logger.error({ error }, "Failed to reset onboarding");
      next(error);
    }
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
    async (
      request: Request<Record<string, unknown>, Record<string, unknown>, MqttSettingsInput>,
      response: Response,
      next: NextFunction,
    ) => {
      try {
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

        logger.info({ enabled, host, port }, "MQTT settings updated");
        response.status(204).end();
      } catch (error) {
        logger.error({ error }, "Failed to update MQTT settings");
        next(error);
      }
    },
  );

  router.post(
    "/mqtt/test",
    validateRequest(mqttTestInputSchema),
    async (
      request: Request<Record<string, unknown>, Record<string, unknown>, MqttTestInput>,
      response: Response,
      next: NextFunction,
    ) => {
      const { host, port, user, password } = request.body;

      try {
        const result = await (mqttService.constructor as typeof MqttService).testConnection(
          { enabled: true, host, port, user, password },
          logger,
        );

        if (result.success) {
          const success = new ApiSuccess("MQTT connection test successful", { success: true });
          success.log(logger);
          response.json({ detail: success.message, data: success.data });
        } else {
          logger.warn({ result }, "MQTT connection test failed");
          return next(
            new ServiceUnavailableError(result.message || "Connection failed", "MQTT_TEST_FAILED"),
          );
        }
      } catch (err) {
        if (err instanceof ApiError) return next(err);
        logger.error({ err }, "MQTT test connection error");
        next(err);
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
        const powerVar = unitDef.variables.find((v) => v.class === "power");
        const isConfigurable = powerVar?.maxConfigurable ?? false;
        const maxValue = powerVar?.max;
        const defaultValue = powerVar?.maxDefault ?? maxValue;

        if (!isConfigurable) {
          value.maxPower = undefined;
        } else if (value.maxPower === undefined && defaultValue !== undefined) {
          value.maxPower = defaultValue;
        } else if (value.maxPower !== undefined && maxValue !== undefined) {
          value.maxPower = Math.min(value.maxPower, maxValue);
        }
      }
    }

    response.json(value);
  });

  router.post(
    "/hru",
    validateRequest(hruSettingsInputSchema),
    async (
      request: Request<Record<string, unknown>, Record<string, unknown>, HruSettingsInput>,
      response: Response,
      next: NextFunction,
    ) => {
      try {
        const { unit, host, port, unitId, maxPower } = request.body;

        const trimmedHost = host.trim();
        if (!trimmedHost) {
          logger.warn("Attempted to set empty HRU host");
          return next(new BadRequestError("Host is required", "HRU_HOST_REQUIRED"));
        }

        if (unit !== undefined && !hruService.getAllUnits().some((u) => u.id === unit)) {
          logger.warn({ unit }, "Attempted to set unknown HRU unit");
          return next(new BadRequestError("Unknown HRU unit id", "UNKNOWN_HRU_UNIT"));
        }

        const resolvedUnit = unit ?? null;
        const resolvedUnitId = unitId ?? 1;

        // Validate maxPower against unit's actual maximum
        const selectedUnit = resolvedUnit !== null
          ? hruService.getAllUnits().find((u) => u.id === resolvedUnit)
          : undefined;

        if (selectedUnit) {
          const powerVar = selectedUnit.variables.find((v) => v.class === "power");
          const isConfigurable = powerVar?.maxConfigurable ?? false;
          const unitMaxValue = powerVar?.max;
          const defaultValue = powerVar?.maxDefault ?? unitMaxValue;
          const controlUnit = typeof powerVar?.unit === "string" ? powerVar.unit : (powerVar?.unit?.text ?? "");

          if (isConfigurable && maxPower === undefined) {
            logger.warn({ unit: resolvedUnit }, "Attempted to set configurable HRU without maxPower");
            return next(
              new BadRequestError(
                "Max power is required for the selected unit",
                "MAX_POWER_REQUIRED",
              ),
            );
          }

          if (maxPower !== undefined && unitMaxValue !== undefined && maxPower > unitMaxValue) {
            logger.warn(
              { maxPower, unitMaxValue },
              "Attempted to set maxPower higher than unit allows",
            );
            return next(
              new BadRequestError(
                `Maximum power cannot exceed ${unitMaxValue} ${controlUnit}. The selected unit supports a maximum of ${unitMaxValue}.`,
                "MAX_POWER_EXCEEDED",
              ),
            );
          }

          // Normalize undefined to default when unit provides one
          if (isConfigurable && maxPower === undefined && defaultValue !== undefined) {
            request.body.maxPower = defaultValue;
          }
        }

        const settings: HruSettings = {
          unit: resolvedUnit,
          host: trimmedHost,
          port,
          unitId: resolvedUnitId,
          maxPower,
        };
        setAppSetting(HRU_SETTINGS_KEY, JSON.stringify(settings));

        // Trigger MQTT discovery update
        try {
          const config = hruService.getResolvedConfiguration(settings);
          if (config) {
            await mqttService.publishDiscovery(config.unit);
          }
        } catch (err) {
          logger.warn({ err }, "Failed to update MQTT discovery after HRU settings change");
        }

        logger.info({ unit, host, port, unitId, maxPower }, "HRU settings updated");
        response.status(204).end();
      } catch (error) {
        logger.error({ error }, "Failed to update HRU settings");
        next(error);
      }
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
    (
      request: Request<Record<string, unknown>, Record<string, unknown>, AddonModeInput>,
      response: Response,
      next: NextFunction,
    ) => {
      try {
        const { mode } = request.body;
        setAppSetting(ADDON_MODE_KEY, mode);
        logger.info({ mode }, "Addon mode updated");
        response.status(204).end();
      } catch (error) {
        logger.error({ error }, "Failed to update addon mode");
        next(error);
      }
    },
  );

  router.get("/theme", (_request: Request, response: Response) => {
    const theme = getAppSetting(THEME_SETTING_KEY) ?? "light";
    response.json({ theme });
  });

  router.post(
    "/theme",
    validateRequest(themeSettingInputSchema),
    (
      request: Request<Record<string, unknown>, Record<string, unknown>, ThemeSettingInput>,
      response: Response,
      next: NextFunction,
    ) => {
      try {
        const { theme } = request.body;
        setAppSetting(THEME_SETTING_KEY, theme);
        logger.info({ theme }, "Theme updated");
        response.status(204).end();
      } catch (error) {
        logger.error({ error }, "Failed to update theme");
        next(error);
      }
    },
  );

  router.get("/language", (_request: Request, response: Response) => {
    const language = getAppSetting(LANGUAGE_SETTING_KEY) ?? "cs";
    response.json({ language });
  });

  router.post(
    "/language",
    validateRequest(languageSettingInputSchema),
    async (
      request: Request<Record<string, unknown>, Record<string, unknown>, LanguageSettingInput>,
      response: Response,
      next: NextFunction,
    ) => {
      try {
        const { language } = request.body;
        setAppSetting(LANGUAGE_SETTING_KEY, language);

        // Trigger MQTT discovery update to refresh localized names
        try {
          await mqttService.refreshDiscovery();
        } catch (err) {
          logger.warn({ err }, "Failed to update MQTT discovery after language change");
        }

        logger.info({ language }, "Language updated");
        response.status(204).end();
      } catch (error) {
        logger.error({ error }, "Failed to update language");
        next(error);
      }
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
    (
      request: Request<Record<string, unknown>, Record<string, unknown>, DebugModeInput>,
      response: Response,
      next: NextFunction,
    ) => {
      try {
        const { enabled } = request.body;
        setAppSetting(DEBUG_MODE_KEY, String(enabled));
        logger.info({ enabled }, "Debug mode updated");
        response.status(204).end();
      } catch (error) {
        logger.error({ error }, "Failed to update debug mode");
        next(error);
      }
    },
  );

  return router;
}
