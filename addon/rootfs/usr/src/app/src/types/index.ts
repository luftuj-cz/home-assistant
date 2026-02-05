export const THEME_SETTING_KEY = "ui.theme";
export const LANGUAGE_SETTING_KEY = "ui.language";
export const TEMP_UNIT_SETTING_KEY = "ui.temperature_unit";
export const SUPPORTED_LANGUAGES = new Set(["en", "cs"]);

export const HRU_SETTINGS_KEY = "hru.settings";
export const ONBOARDING_DONE_KEY = "onboarding.done";

export type HruSettings = {
  unit: string | null;
  host: string;
  port: number;
  unitId: number;
  maxPower?: number;
};

export const MQTT_SETTINGS_KEY = "mqtt.settings";
export const MQTT_LAST_DISCOVERY_KEY = "mqtt.last_discovery_sent";
export const MQTT_DISCOVERED_BOOSTS_KEY = "mqtt.discovered_boosts";
export const MQTT_LAST_UNIT_ID_KEY = "mqtt.last_unit_id";

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
export const BOOST_DURATION_KEY = "boost.duration";

export type TimelineMode = {
  id: number;
  name: string;
  color?: string;
  power?: number;
  temperature?: number;
  luftatorConfig?: Record<string, number>;
  isBoost?: boolean;
  hruId?: string;
};

export type TimelineOverride = {
  modeId: number;
  endTime: string;
  durationMinutes: number;
} | null;
