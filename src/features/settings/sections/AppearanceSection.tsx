import { useCallback, useMemo, useState } from "react";
import {
  Accordion,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { IconLanguage, IconMoon, IconSun } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";

import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { setLanguage } from "@luftuj/shared/i18n";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("AppearanceSection");

export function AppearanceSection() {
  const { t, i18n } = useTranslation();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("dark", { getInitialValueInEffect: false });
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);

  const themeOptions = useMemo(
    () => [
      { label: t("settings.theme.light"), value: "light" },
      { label: t("settings.theme.dark"), value: "dark" },
    ],
    [t],
  );

  const languageOptions = useMemo(
    () => [
      { label: t("settings.language.options.en"), value: "en" },
      { label: t("settings.language.options.cs"), value: "cs" },
    ],
    [t],
  );

  const currentLanguage = useMemo(() => {
    const lang = i18n.language ?? "en";
    const short = lang.split("-")[0];
    return languageOptions.some((option) => option.value === short) ? short : "en";
  }, [i18n.language, languageOptions]);

  const persistTheme = useCallback(async (value: "light" | "dark") => {
    setSavingTheme(true);
    try {
      await fetch(resolveApiUrl("/api/settings/theme"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: value }),
      });
    } catch (err) {
      logger.error("Failed to save theme preference", { error: err });
    } finally {
      setSavingTheme(false);
    }
  }, []);

  const handleThemeChange = useCallback(
    (value: string) => {
      const scheme = value === "dark" ? "dark" : "light";
      setColorScheme(scheme);
      void persistTheme(scheme);
    },
    [persistTheme, setColorScheme],
  );

  const handleLanguageChange = useCallback(
    async (value: string) => {
      setSavingLanguage(true);
      try {
        await setLanguage(value);
        const response = await fetch(resolveApiUrl("/api/settings/language"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: value }),
        });
        if (response.ok) {
          const label = languageOptions.find((option) => option.value === value)?.label ?? value;
          notifications.show({
            title: t("settings.language.notifications.updatedTitle"),
            message: t("settings.language.notifications.updatedMessage", { language: label }),
            color: "green",
          });
        }
      } catch {
        notifications.show({
          title: t("settings.language.notifications.failedTitle"),
          message: t("settings.language.notifications.unknown"),
          color: "red",
        });
      } finally {
        setSavingLanguage(false);
      }
    },
    [languageOptions, t],
  );

  return (
    <Accordion.Item value="appearance">
      <Accordion.Control icon={<IconSun size={20} />}>
        <Text fw={600}>{t("settings.appearance.title")}</Text>
      </Accordion.Control>
      <Accordion.Panel>
        <Stack gap="lg">
          <Paper p="md" withBorder radius="md">
            <Stack gap="md">
              <Group gap="sm">
                <IconLanguage size={20} color="var(--mantine-primary-color-5)" />
                <Text fw={500}>{t("settings.language.title")}</Text>
              </Group>
              <Text size="sm" c="dimmed">
                {t("settings.language.description")}
              </Text>
              <SegmentedControl
                fullWidth
                value={currentLanguage}
                data={languageOptions}
                onChange={(v) => void handleLanguageChange(v)}
                disabled={savingLanguage}
                size="md"
              />
            </Stack>
          </Paper>

          <Paper p="md" withBorder radius="md">
            <Stack gap="md">
              <Group gap="sm">
                {computedColorScheme === "dark" ? (
                  <IconMoon size={20} color="var(--mantine-primary-color-5)" />
                ) : (
                  <IconSun size={20} color="var(--mantine-primary-color-5)" />
                )}
                <Text fw={500}>{t("settings.theme.title")}</Text>
              </Group>
              <Text size="sm" c="dimmed">
                {t("settings.theme.description")}
              </Text>
              <SegmentedControl
                fullWidth
                value={computedColorScheme}
                data={themeOptions}
                onChange={handleThemeChange}
                disabled={savingTheme}
                size="md"
              />
            </Stack>
          </Paper>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
