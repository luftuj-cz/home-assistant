import { getAppSetting } from "../../services/database";
import { HRU_SETTINGS_KEY, LANGUAGE_SETTING_KEY, type HruSettings } from "../../types";

export class SettingsRepository {
  getHruSettings(): HruSettings | null {
    const raw = getAppSetting(HRU_SETTINGS_KEY);
    return raw ? (JSON.parse(String(raw)) as HruSettings) : null;
  }

  getLanguage(): string {
    const raw = getAppSetting(LANGUAGE_SETTING_KEY);
    return raw ? String(raw) : "en";
  }
}
