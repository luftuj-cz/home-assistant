import { getAppSetting, setAppSetting } from "../../services/database";
import {
  HRU_SETTINGS_KEY,
  LANGUAGE_SETTING_KEY,
  MQTT_SETTINGS_KEY,
  MQTT_LAST_DISCOVERY_KEY,
  MQTT_DISCOVERED_BOOSTS_KEY,
  MQTT_LAST_UNIT_ID_KEY,
  TIMELINE_OVERRIDE_KEY,
  TIMELINE_MODES_KEY,
  BOOST_DURATION_KEY,
  type HruSettings,
  type MqttSettings,
  type TimelineMode,
  type TimelineOverride,
} from "../../types";

export class SettingsRepository {
  getHruSettings(): HruSettings | null {
    const raw = getAppSetting(HRU_SETTINGS_KEY);
    return raw ? (JSON.parse(String(raw)) as HruSettings) : null;
  }

  getLanguage(): string {
    const raw = getAppSetting(LANGUAGE_SETTING_KEY);
    return raw ? String(raw) : "en";
  }

  getMqttSettings(): MqttSettings | null {
    const raw = getAppSetting(MQTT_SETTINGS_KEY);
    return raw ? (JSON.parse(String(raw)) as MqttSettings) : null;
  }

  getBoostDuration(): number {
    const raw = getAppSetting(BOOST_DURATION_KEY);
    return raw ? parseInt(String(raw), 10) : 30;
  }

  setBoostDuration(duration: number): void {
    setAppSetting(BOOST_DURATION_KEY, String(duration));
  }

  getTimelineOverride(): TimelineOverride | null {
    const raw = getAppSetting(TIMELINE_OVERRIDE_KEY);
    if (!raw || raw === "null") return null;
    return JSON.parse(String(raw)) as TimelineOverride;
  }

  setTimelineOverride(override: TimelineOverride | null): void {
    setAppSetting(TIMELINE_OVERRIDE_KEY, override ? JSON.stringify(override) : "null");
  }

  getTimelineModes(): TimelineMode[] {
    const raw = getAppSetting(TIMELINE_MODES_KEY);
    return raw ? (JSON.parse(String(raw)) as TimelineMode[]) : [];
  }

  getLastDiscoveryTime(): string | null {
    return getAppSetting(MQTT_LAST_DISCOVERY_KEY);
  }

  setLastDiscoveryTime(time: string): void {
    setAppSetting(MQTT_LAST_DISCOVERY_KEY, time);
  }

  getDiscoveredBoosts(): Record<number, string> {
    const raw = getAppSetting(MQTT_DISCOVERED_BOOSTS_KEY);
    return raw ? (JSON.parse(String(raw)) as Record<number, string>) : {};
  }

  setDiscoveredBoosts(map: Record<number, string>): void {
    setAppSetting(MQTT_DISCOVERED_BOOSTS_KEY, JSON.stringify(map));
  }

  getLastUnitId(): string | null {
    return getAppSetting(MQTT_LAST_UNIT_ID_KEY);
  }

  setLastUnitId(id: string): void {
    setAppSetting(MQTT_LAST_UNIT_ID_KEY, id);
  }
}
