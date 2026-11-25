import { IconCode } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsSection, SummaryChip } from "@luftuj/features/settings/components/SettingsSection";
import { Combobox } from "@luftuj/shared/ui/combobox";
import { Field } from "@luftuj/shared/ui/field";
import { notify } from "@luftuj/shared/ui/notify";
import { Switch } from "@luftuj/shared/ui/switch";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import {
  createLogger,
  getLogLevel,
  type LogLevel,
  setLogLevel,
  VALID_LOG_LEVELS,
} from "@luftuj/shared/utils/logger";

const logger = createLogger("DeveloperSection");

/** Vývojářské nastavení: the debug-mode switch and the console log level. */
export function DeveloperSection() {
  const { t } = useTranslation();
  const [debugMode, setDebugMode] = useState(false);
  const [currentLogLevel, setCurrentLogLevel] = useState<LogLevel>(() => getLogLevel());

  useEffect(() => {
    let canceled = false;

    async function load() {
      try {
        const [debugRes, logRes] = await Promise.all([
          fetch(resolveApiUrl("/api/settings/debug-mode"), { cache: "no-cache" }),
          fetch(resolveApiUrl("/api/settings/log-level"), { cache: "no-cache" }),
        ]);
        if (canceled) return;
        if (debugRes.ok) {
          const { enabled } = await debugRes.json();
          setDebugMode(enabled);
        }
        if (logRes.ok) {
          const { level } = await logRes.json();
          setLogLevel(level as LogLevel);
          setCurrentLogLevel(level as LogLevel);
        }
      } catch (err) {
        logger.error("Failed to load developer settings", { error: err });
      }
    }

    void load();
    return () => {
      canceled = true;
    };
  }, []);

  function handleDebugChange(checked: boolean) {
    setDebugMode(checked);
    void fetch(resolveApiUrl("/api/settings/debug-mode"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: checked }),
    }).then(() => {
      setTimeout(() => globalThis.location.reload(), 800);
    });
    notify({
      title: t("settings.developer.debugMode"),
      message: checked
        ? t("settings.developer.debugEnabled")
        : t("settings.developer.debugDisabled"),
      variant: checked ? "info" : "neutral",
    });
  }

  async function handleLogLevelChange(value: string | null) {
    if (!value || !VALID_LOG_LEVELS.includes(value as LogLevel)) return;
    setLogLevel(value as LogLevel);
    setCurrentLogLevel(value as LogLevel);
    try {
      const res = await fetch(resolveApiUrl("/api/settings/log-level"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: value }),
      });
      if (res.ok) {
        notify({
          title: t("settings.developer.logLevel"),
          message: t("settings.developer.logLevelChanged", { level: value }),
          variant: "info",
        });
      }
    } catch (err) {
      logger.error("Failed to save log level", { error: err });
    }
  }

  return (
    <SettingsSection
      value="developer"
      index="08"
      icon={IconCode}
      title={t("settings.developer.title")}
      description={t("settings.developer.description")}
      summary={
        <>
          <SummaryChip>
            {debugMode ? t("settings.developer.debugOn") : t("settings.developer.debugOff")}
          </SummaryChip>
          <SummaryChip mono>{currentLogLevel}</SummaryChip>
        </>
      }
    >
      <Switch
        label={t("settings.developer.debugMode")}
        description={t("settings.developer.debugModeDescription")}
        checked={debugMode}
        onCheckedChange={handleDebugChange}
      />
      <Field
        label={t("settings.developer.logLevel")}
        description={t("settings.developer.logLevelDescription")}
        className="max-w-[300px]"
      >
        <Combobox
          options={VALID_LOG_LEVELS.map((level) => ({ value: level, label: level, mono: true }))}
          value={currentLogLevel}
          onValueChange={(value) => void handleLogLevelChange(value)}
        />
      </Field>
    </SettingsSection>
  );
}
