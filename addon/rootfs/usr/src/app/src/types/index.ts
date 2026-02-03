export const THEME_SETTING_KEY = "ui.theme";
export const LANGUAGE_SETTING_KEY = "ui.language";
export const TEMP_UNIT_SETTING_KEY = "ui.temperature_unit";
export const SUPPORTED_LANGUAGES = new Set(["en", "cs"]);

export const HRU_SETTINGS_KEY = "hru.settings";

export type HruSettings = {
  unit: string | null; // id from HeatRecoveryUnit
  host: string;
  port: number;
  unitId: number; // Modbus unit/slave id
  maxPower?: number;
};

export const MQTT_SETTINGS_KEY = "mqtt.settings";
export const MQTT_LAST_DISCOVERY_KEY = "mqtt.last_discovery_sent";

export type MqttSettings = {
  enabled: boolean;
  host: string;
  port: number;
  user?: string;
  password?: string;
};

export const ADDON_MODE_KEY = "addon.mode";
export const ADDON_MODES = ["manual", "timeline"] as const;
export type AddonMode = (typeof ADDON_MODES)[number];

export const TIMELINE_MODES_KEY = "timeline.modes";
export const TIMELINE_OVERRIDE_KEY = "timeline.override";

export type TimelineMode = {
  id: number;
  name: string;
  color?: string;
  power?: number;
  temperature?: number;
  luftatorConfig?: Record<string, number>;
  isBoost?: boolean;
};

export type TimelineOverride = {
  modeId: number;
  endTime: string; // ISO 8601
  durationMinutes: number;
} | null;
