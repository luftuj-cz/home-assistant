import { z } from "zod";

// HRU Settings Schema
export const hruSettingsInputSchema = z.object({
  host: z.string().trim().min(1, "Host is required"),
  port: z.number().int().min(1).max(65535, "Port must be between 1 and 65535"),
  unitId: z.number().int().min(0).max(255, "Unit ID must be between 0 and 255").optional(),
  unit: z.string().optional(),
  maxPower: z.number().int().min(1, "Max power must be at least 1").optional(),
});

// MQTT Settings Schema
export const mqttSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    host: z.string().trim().optional(),
    port: z.number().int().min(1).max(65535, "Port must be between 1 and 65535").optional(),
    user: z.string().optional(),
    password: z.string().optional(),
  })
  .refine((data) => !data.enabled || (data.host && data.host.length > 0), {
    message: "Host is required when MQTT is enabled",
    path: ["host"],
  });

// MQTT Test Schema (more relaxed for testing)
export const mqttTestInputSchema = z.object({
  host: z.string().trim().min(1, "Host is required"),
  port: z.number().int().min(1).max(65535, "Port must be between 1 and 65535"),
  user: z.string().optional(),
  password: z.string().optional(),
});

// Addon Mode Schema
export const addonModeInputSchema = z.object({
  mode: z.enum(["manual", "timeline"]),
});

// Theme Setting Schema
export const themeSettingInputSchema = z.object({
  theme: z.enum(["light", "dark"]),
});

// Language Setting Schema
export const languageSettingInputSchema = z.object({
  language: z.enum(["en", "cs"]),
});

// Temperature Unit Setting Schema
export const temperatureUnitInputSchema = z.object({
  temperatureUnit: z.enum(["c", "f"]),
});

// Debug Mode Schema
export const debugModeInputSchema = z.object({
  enabled: z.boolean(),
});

// Type exports
export type HruSettingsInput = z.infer<typeof hruSettingsInputSchema>;
export type MqttSettingsInput = z.infer<typeof mqttSettingsInputSchema>;
export type MqttTestInput = z.infer<typeof mqttTestInputSchema>;
export type AddonModeInput = z.infer<typeof addonModeInputSchema>;
export type ThemeSettingInput = z.infer<typeof themeSettingInputSchema>;
export type LanguageSettingInput = z.infer<typeof languageSettingInputSchema>;
export type TemperatureUnitInput = z.infer<typeof temperatureUnitInputSchema>;
export type DebugModeInput = z.infer<typeof debugModeInputSchema>;
