import { IconDeviceDesktop, IconMoon, IconPalette, IconSun } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsSection, SummaryChip } from "@luftuj/features/settings/components/SettingsSection";
import { setLanguage } from "@luftuj/shared/i18n";
import { useTemperature } from "@luftuj/shared/temperature/useTemperature";
import type { ThemePreference } from "@luftuj/shared/theme/themeContext";
import { useTheme } from "@luftuj/shared/theme/useTheme";
import { Field } from "@luftuj/shared/ui/field";
import { notify } from "@luftuj/shared/ui/notify";
import { ToggleGroup } from "@luftuj/shared/ui/toggle-group";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { createLogger } from "@luftuj/shared/utils/logger";
import { isTemperatureUnit } from "@luftuj/shared/utils/temperature";

const logger = createLogger("AppearanceSection");

const LANGUAGES = ["cs", "en"] as const;

function isPreference(value: string): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** Vzhled: language, theme (light, dark or the system's) and temperature units. Each applies at once. */
export function AppearanceSection() {
  const { t, i18n } = useTranslation();
  const { preference, setPreference } = useTheme();
  const temperature = useTemperature();
  const [savingLanguage, setSavingLanguage] = useState(false);
  const short = (i18n.language ?? "en").split("-")[0];
  const language = LANGUAGES.find((code) => code === short) ?? "en";

  function changeTheme(value: string) {
    if (!isPreference(value)) return;
    setPreference(value);
    void fetch(resolveApiUrl("/api/settings/theme"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: value }),
    }).catch((error: unknown) => logger.error("Failed to save theme preference", { error }));
  }

  async function changeLanguage(value: string) {
    if (!value || value === language) return;
    setSavingLanguage(true);
    try {
      await setLanguage(value);
      const response = await fetch(resolveApiUrl("/api/settings/language"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: value }),
      });
      if (response.ok) {
        notify({
          title: t("settings.language.notifications.updatedTitle"),
          message: t("settings.language.notifications.updatedMessage", {
            language: t(`settings.language.options.${value}`),
          }),
          variant: "success",
        });
      }
    } catch {
      notify({
        title: t("settings.language.notifications.failedTitle"),
        message: t("settings.language.notifications.unknown"),
        variant: "error",
      });
    } finally {
      setSavingLanguage(false);
    }
  }

  const themeLabel = {
    light: t("settings.theme.light"),
    dark: t("settings.theme.dark"),
    system: t("settings.theme.system"),
  }[preference];

  return (
    <SettingsSection
      value="appearance"
      index="01"
      icon={IconPalette}
      title={t("settings.appearance.title")}
      description={t("settings.appearance.description")}
      summary={
        <>
          <SummaryChip>{t(`settings.language.options.${language}`)}</SummaryChip>
          <SummaryChip>{themeLabel}</SummaryChip>
          <SummaryChip>{temperature.label}</SummaryChip>
        </>
      }
    >
      <Field label={t("settings.language.title")} description={t("settings.language.description")}>
        <ToggleGroup
          items={LANGUAGES.map((code) => ({
            value: code,
            label: t(`settings.language.options.${code}`),
          }))}
          value={language}
          onValueChange={(value) => void changeLanguage(value)}
          disabled={savingLanguage}
          aria-label={t("settings.language.title")}
          className="justify-self-start"
        />
      </Field>
      <Field label={t("settings.theme.title")} description={t("settings.theme.description")}>
        <ToggleGroup
          items={[
            { value: "light", label: t("settings.theme.light"), icon: IconSun },
            { value: "dark", label: t("settings.theme.dark"), icon: IconMoon },
            { value: "system", label: t("settings.theme.system"), icon: IconDeviceDesktop },
          ]}
          value={preference}
          onValueChange={changeTheme}
          aria-label={t("settings.theme.title")}
          className="justify-self-start @max-[400px]:[&_svg]:hidden"
        />
      </Field>
      <Field
        label={t("settings.temperatureUnit.title")}
        description={t("settings.temperatureUnit.description")}
      >
        <ToggleGroup
          items={[
            { value: "celsius", label: t("settings.temperatureUnit.options.c") },
            { value: "fahrenheit", label: t("settings.temperatureUnit.options.f") },
          ]}
          value={temperature.unit}
          onValueChange={(value) => {
            if (isTemperatureUnit(value)) temperature.setUnit(value);
          }}
          aria-label={t("settings.temperatureUnit.title")}
          className="justify-self-start"
        />
      </Field>
    </SettingsSection>
  );
}
