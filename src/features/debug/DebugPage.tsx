import { Container, Stack, Tabs, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { BackendValuesPanel } from "./panels/BackendValuesPanel";
import { HomeAssistantApiPanel } from "./panels/HomeAssistantApiPanel";
import { OnboardingToolsPanel } from "./panels/OnboardingToolsPanel";
import { ServerLogsPanel } from "./panels/ServerLogsPanel";

export function DebugPage() {
  const { t } = useTranslation();

  return (
    <Container size="xl">
      <Stack gap="xl">
        <Stack gap="xs">
          <Title order={1}>{t("debug.title")}</Title>
          <Text c="dimmed">{t("debug.description")}</Text>
        </Stack>

        <Tabs defaultValue="backend-values">
          <Tabs.List>
            <Tabs.Tab value="backend-values">
              {t("debug.backendValues", { defaultValue: "Backend Debug Values" })}
            </Tabs.Tab>
            <Tabs.Tab value="server-logs">
              {t("debug.serverLogs", { defaultValue: "Server Logs" })}
            </Tabs.Tab>
            <Tabs.Tab value="home-assistant-api">
              {t("debug.homeAssistantApi", { defaultValue: "Home Assistant API" })}
            </Tabs.Tab>
            <Tabs.Tab value="onboarding-tools">{t("debug.onboardingTools")}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="backend-values" pt="md">
            <BackendValuesPanel />
          </Tabs.Panel>

          <Tabs.Panel value="server-logs" pt="md">
            <ServerLogsPanel />
          </Tabs.Panel>

          <Tabs.Panel value="home-assistant-api" pt="md">
            <HomeAssistantApiPanel />
          </Tabs.Panel>

          <Tabs.Panel value="onboarding-tools" pt="md">
            <OnboardingToolsPanel />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}
