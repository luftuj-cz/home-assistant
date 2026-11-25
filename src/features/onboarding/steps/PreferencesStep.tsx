import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { StepFrame } from "@luftuj/features/onboarding/components/StepFrame";
import { useOnboardingWizard } from "@luftuj/features/onboarding/hooks/useOnboardingWizard";
import { setLanguage } from "@luftuj/shared/i18n";
import { useTemperature } from "@luftuj/shared/temperature/useTemperature";
import type { ThemePreference } from "@luftuj/shared/theme/themeContext";
import { useTheme } from "@luftuj/shared/theme/useTheme";
import { Alert } from "@luftuj/shared/ui/alert";
import { Field } from "@luftuj/shared/ui/field";
import { ToggleGroup } from "@luftuj/shared/ui/toggle-group";
import { isTemperatureUnit } from "@luftuj/shared/utils/temperature";

function isPreference(value: string): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Předvolby: language, theme (incl. the system's) and temperature units. Each applies at once so the rest of the
 * wizard already looks right; Další stores language and theme (the unit stores itself).
 */
export function PreferencesStep() {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();
  const temperature = useTemperature();
  const {
    nextStep,
    selectedLanguage,
    setSelectedLanguage,
    saveLanguageMutation,
    saveThemeMutation,
  } = useOnboardingWizard();
  const [failed, setFailed] = useState(false);
  const language = selectedLanguage.split("-")[0] === "en" ? "en" : "cs";

  async function handleNext() {
    setFailed(false);
    try {
      await Promise.all([
        saveLanguageMutation.mutateAsync(language),
        saveThemeMutation.mutateAsync(preference),
      ]);
      nextStep();
    } catch {
      setFailed(true);
    }
  }

  return (
    <StepFrame
      title={t("onboarding.preferences.title")}
      onNext={() => void handleNext()}
      busy={saveLanguageMutation.isPending || saveThemeMutation.isPending}
    >
      <Field label={t("onboarding.preferences.languageLabel")}>
        <ToggleGroup
          items={[
            { value: "cs", label: t("settings.language.options.cs") },
            { value: "en", label: t("settings.language.options.en") },
          ]}
          value={language}
          onValueChange={(value) => {
            if (value !== "cs" && value !== "en") return;
            setSelectedLanguage(value);
            void setLanguage(value);
          }}
          aria-label={t("onboarding.preferences.languageLabel")}
          className="justify-self-start"
        />
      </Field>
      <Field label={t("onboarding.preferences.themeLabel")}>
        <ToggleGroup
          items={[
            { value: "light", label: t("settings.theme.light"), icon: IconSun },
            { value: "dark", label: t("settings.theme.dark"), icon: IconMoon },
            { value: "system", label: t("settings.theme.system"), icon: IconDeviceDesktop },
          ]}
          value={preference}
          onValueChange={(value) => {
            if (isPreference(value)) setPreference(value);
          }}
          aria-label={t("onboarding.preferences.themeLabel")}
          className="justify-self-start @max-[400px]:[&_svg]:hidden"
        />
      </Field>
      <Field label={t("onboarding.preferences.tempUnitLabel")}>
        <ToggleGroup
          items={[
            { value: "celsius", label: t("onboarding.preferences.tempUnits.c") },
            { value: "fahrenheit", label: t("onboarding.preferences.tempUnits.f") },
          ]}
          value={temperature.unit}
          onValueChange={(value) => {
            if (isTemperatureUnit(value)) temperature.setUnit(value);
          }}
          aria-label={t("onboarding.preferences.tempUnitLabel")}
          className="justify-self-start"
        />
      </Field>
      {failed && <Alert variant="destructive">{t("onboarding.errors.prefSaveFailed")}</Alert>}
    </StepFrame>
  );
}
