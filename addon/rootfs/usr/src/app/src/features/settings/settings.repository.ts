import { getAppSetting, setAppSetting, getTimelineModes } from "../../services/database";
import {
  HRU_SETTINGS_KEY,
  LANGUAGE_SETTING_KEY,
  MQTT_SETTINGS_KEY,
  MQTT_LAST_DISCOVERY_KEY,
  MQTT_DISCOVERED_BOOSTS_KEY,
  MQTT_LAST_UNIT_ID_KEY,
  TIMELINE_OVERRIDE_KEY,
  BOOST_DURATION_KEY,
  type HruSettings,
  type MqttSettings,
  type TimelineMode,
  type TimelineOverride,
} from "../../types";
import type { Logger } from "pino";

export class SettingsRepository {
  constructor(private readonly logger: Logger) {}

  getHruSettings(): HruSettings | null {
    try {
      const raw = getAppSetting(HRU_SETTINGS_KEY);
      return raw ? (JSON.parse(String(raw)) as HruSettings) : null;
    } catch (err) {
      this.logger.error({ err }, "Failed to get HRU settings");
      return null;
    }
  }

  getLanguage(): string {
    try {
      const raw = getAppSetting(LANGUAGE_SETTING_KEY);
      return raw ? String(raw) : "en";
    } catch (err) {
      this.logger.error({ err }, "Failed to get language settings");
      return "en";
    }
  }

  getMqttSettings(): MqttSettings | null {
    try {
      const raw = getAppSetting(MQTT_SETTINGS_KEY);
      return raw ? (JSON.parse(String(raw)) as MqttSettings) : null;
    } catch (err) {
      this.logger.error({ err }, "Failed to get MQTT settings");
      return null;
    }
  }

  getBoostDuration(): number {
    try {
      const raw = getAppSetting(BOOST_DURATION_KEY);
      return raw ? parseInt(String(raw), 10) : 30;
    } catch (err) {
      this.logger.error({ err }, "Failed to get boost duration");
      return 30;
    }
  }

  setBoostDuration(duration: number): void {
    try {
      setAppSetting(BOOST_DURATION_KEY, String(duration));
    } catch (err) {
      this.logger.error({ err, duration }, "Failed to set boost duration");
    }
  }

  getTimelineOverride(): TimelineOverride | null {
    try {
      const raw = getAppSetting(TIMELINE_OVERRIDE_KEY);
      if (!raw || raw === "null") return null;
      return JSON.parse(String(raw)) as TimelineOverride;
    } catch (err) {
      this.logger.error({ err }, "Failed to get timeline override");
      return null;
    }
  }

  setTimelineOverride(override: TimelineOverride | null): void {
    try {
      setAppSetting(TIMELINE_OVERRIDE_KEY, override ? JSON.stringify(override) : "null");
    } catch (err) {
      this.logger.error({ err, override }, "Failed to set timeline override");
    }
  }

  getTimelineModes(hruId?: string): TimelineMode[] {
    try {
      return getTimelineModes(hruId);
    } catch (err) {
      this.logger.error({ err, hruId }, "Failed to get timeline modes");
      return [];
    }
  }

  getLastDiscoveryTime(): string | null {
    try {
      return getAppSetting(MQTT_LAST_DISCOVERY_KEY);
    } catch (err) {
      this.logger.error({ err }, "Failed to get last discovery time");
      return null;
    }
  }

  setLastDiscoveryTime(time: string): void {
    try {
      setAppSetting(MQTT_LAST_DISCOVERY_KEY, time);
    } catch (err) {
      this.logger.error({ err, time }, "Failed to set last discovery time");
    }
  }

  getDiscoveredBoosts(): Record<number, string> {
    try {
      const raw = getAppSetting(MQTT_DISCOVERED_BOOSTS_KEY);
      return raw ? (JSON.parse(String(raw)) as Record<number, string>) : {};
    } catch (err) {
      this.logger.error({ err }, "Failed to get discovered boosts");
      return {};
    }
  }

  setDiscoveredBoosts(map: Record<number, string>): void {
    try {
      setAppSetting(MQTT_DISCOVERED_BOOSTS_KEY, JSON.stringify(map));
    } catch (err) {
      this.logger.error({ err }, "Failed to set discovered boosts");
    }
  }

  getLastUnitId(): string | null {
    try {
      return getAppSetting(MQTT_LAST_UNIT_ID_KEY);
    } catch (err) {
      this.logger.error({ err }, "Failed to get last unit ID");
      return null;
    }
  }

  setLastUnitId(id: string): void {
    try {
      setAppSetting(MQTT_LAST_UNIT_ID_KEY, id);
    } catch (err) {
      this.logger.error({ err, id }, "Failed to set last unit ID");
    }
  }
}
