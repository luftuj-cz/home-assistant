import { Accordion, Container, Group, Stack, Text, Title } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { AppearanceSection } from "@luftuj/features/settings/sections/AppearanceSection";
import { HruSection } from "@luftuj/features/settings/sections/HruSection";
import { SeasonsSection } from "@luftuj/features/settings/sections/SeasonsSection";
import { MqttSection } from "@luftuj/features/settings/sections/MqttSection";
import { DatabaseSection } from "@luftuj/features/settings/sections/DatabaseSection";
import { DeveloperSection } from "@luftuj/features/settings/sections/DeveloperSection";
import { HelpSection } from "@luftuj/features/settings/sections/HelpSection";

export function SettingsPage() {
  const { t } = useTranslation();
  // A link from elsewhere can name the section it is talking about; without one
  // the page opens as it always has.
  const { section } = useSearch({ from: "/settings" }) as { section?: string };

  return (
    <Container size="xl">
      <Stack gap="xl">
        <Stack gap={0}>
          <Group gap="sm">
            <IconSettings size={32} color="var(--mantine-primary-color-5)" />
            <Title order={1}>{t("settings.title")}</Title>
          </Group>
          <Text size="lg" c="dimmed" mt="xs">
            {t("settings.description")}
          </Text>
        </Stack>

        <Accordion variant="separated" defaultValue={section ?? "appearance"}>
          <AppearanceSection />
          <HruSection />
          <SeasonsSection />
          <MqttSection />
          <DatabaseSection />
          <HelpSection />
          <DeveloperSection />
        </Accordion>
      </Stack>
    </Container>
  );
}
