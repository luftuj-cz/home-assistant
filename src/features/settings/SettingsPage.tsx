import { Accordion, Container, Group, Stack, Text, Title } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { AppearanceSection } from "@luftuj/features/settings/sections/AppearanceSection";
import { HruSection } from "@luftuj/features/settings/sections/HruSection";
import { MqttSection } from "@luftuj/features/settings/sections/MqttSection";
import { DatabaseSection } from "@luftuj/features/settings/sections/DatabaseSection";
import { DeveloperSection } from "@luftuj/features/settings/sections/DeveloperSection";

export function SettingsPage() {
  const { t } = useTranslation();

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

        <Accordion variant="separated" defaultValue="appearance">
          <AppearanceSection />
          <HruSection />
          <MqttSection />
          <DatabaseSection />
          <DeveloperSection />
        </Accordion>
      </Stack>
    </Container>
  );
}
