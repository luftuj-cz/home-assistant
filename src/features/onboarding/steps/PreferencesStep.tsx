import { Alert, Button, Group, Select, Stack, useMantineColorScheme } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { IconArrowRight, IconLanguage, IconLeaf, IconPalette } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useOnboardingWizard } from "@luftuj/features/onboarding/hooks/useOnboardingWizard";
import { useSeasonHemisphere } from "@luftuj/features/timeline/hooks/useSeasonHemisphere";
import { setLanguage } from "@luftuj/shared/i18n";
import type { Hemisphere } from "@luftuj/shared/types/timeline";

export function PreferencesStep() {
  const { t } = useTranslation();
  const { setColorScheme } = useMantineColorScheme();
  const { data: seasonHemisphere, save: saveSeasonHemisphere } = useSeasonHemisphere();
  const [selectedHemisphere, setSelectedHemisphere] = useState<Hemisphere>("northern");
  const {
    nextStep,
    prevStep,
    selectedLanguage,
    setSelectedLanguage,
    selectedTheme,
    setSelectedTheme,
    saveLanguageMutation,
    saveThemeMutation,
  } = useOnboardingWizard();

  useEffect(() => {
    if (seasonHemisphere?.hemisphere) {
      setSelectedHemisphere(seasonHemisphere.hemisphere);
    }
  }, [seasonHemisphere?.hemisphere]);

  async function handleSubmit() {
    try {
      await Promise.all([
        saveLanguageMutation.mutateAsync(selectedLanguage),
        saveThemeMutation.mutateAsync(selectedTheme),
        saveSeasonHemisphere.mutateAsync(selectedHemisphere),
      ]);
      nextStep();
    } catch {
      notifications.show({
        title: t("onboarding.mqtt.failed"),
        message: t("onboarding.errors.prefSaveFailed"),
        color: "red",
      });
    }
  }

  return (
    <Stack gap="md" py="lg">
      <Select
        label={t("onboarding.preferences.languageLabel")}
        placeholder={t("onboarding.preferences.languagePlaceholder")}
        leftSection={<IconLanguage size={16} />}
        data={[
          { value: "en", label: "English" },
          { value: "cs", label: "Čeština" },
        ]}
        value={selectedLanguage}
        onChange={async (val) => {
          if (val === "en" || val === "cs") {
            setSelectedLanguage(val);
            await setLanguage(val);
          }
        }}
      />
      <Select
        label={t("onboarding.preferences.themeLabel")}
        placeholder={t("onboarding.preferences.themePlaceholder")}
        leftSection={<IconPalette size={16} />}
        data={[
          { value: "light", label: t("onboarding.preferences.themes.light") },
          { value: "dark", label: t("onboarding.preferences.themes.dark") },
        ]}
        value={selectedTheme}
        onChange={(val) => {
          if (val === "light" || val === "dark") {
            setSelectedTheme(val);
            setColorScheme(val);
          }
        }}
      />
      <Select
        label={t("onboarding.preferences.seasonHemisphereLabel")}
        placeholder={t("onboarding.preferences.seasonHemispherePlaceholder")}
        leftSection={<IconLeaf size={16} />}
        data={[
          { value: "northern", label: t("settings.timeline.seasons.hemisphereNorthern") },
          { value: "southern", label: t("settings.timeline.seasons.hemisphereSouthern") },
        ]}
        value={selectedHemisphere}
        onChange={(val) => {
          if (val === "northern" || val === "southern") {
            setSelectedHemisphere(val);
          }
        }}
      />
      <Alert color="blue" variant="light" icon={<IconLeaf size={16} />}>
        {t("onboarding.preferences.seasonInfo")}
      </Alert>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={prevStep}>
          {t("onboarding.back")}
        </Button>
        <Button
          onClick={handleSubmit}
          loading={
            saveLanguageMutation.isPending ||
            saveThemeMutation.isPending ||
            saveSeasonHemisphere.isPending
          }
          rightSection={<IconArrowRight size={16} />}
        >
          {t("onboarding.next")}
        </Button>
      </Group>
    </Stack>
  );
}
