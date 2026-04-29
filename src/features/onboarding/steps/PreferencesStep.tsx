import { Button, Group, Select, Stack } from "@mantine/core";
import { useMantineColorScheme } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import {
  useOnboardingWizard,
  IconLanguage,
  IconPalette,
  IconArrowRight,
} from "@luftuj/features/onboarding/hooks/useOnboardingWizard";
import { setLanguage } from "@luftuj/shared/i18n";

export function PreferencesStep() {
  const { t } = useTranslation();
  const { setColorScheme } = useMantineColorScheme();
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

  async function handleSubmit() {
    try {
      await Promise.all([
        saveLanguageMutation.mutateAsync(selectedLanguage),
        saveThemeMutation.mutateAsync(selectedTheme),
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
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={prevStep}>
          {t("onboarding.back")}
        </Button>
        <Button
          onClick={handleSubmit}
          loading={saveLanguageMutation.isPending || saveThemeMutation.isPending}
          rightSection={<IconArrowRight size={16} />}
        >
          {t("onboarding.next")}
        </Button>
      </Group>
    </Stack>
  );
}
