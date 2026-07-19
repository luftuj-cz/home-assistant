import { useState } from "react";
import { Button, Container, Group, Select, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconExternalLink } from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BackendValuesPanel } from "@luftuj/features/debug/panels/BackendValuesPanel";
import { HomeAssistantApiPanel } from "@luftuj/features/debug/panels/HomeAssistantApiPanel";
import { OnboardingToolsPanel } from "@luftuj/features/debug/panels/OnboardingToolsPanel";
import { CommissioningPanel } from "@luftuj/features/debug/panels/CommissioningPanel";
import { ServerLogsPanel } from "@luftuj/features/debug/panels/ServerLogsPanel";

export function DebugPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [activeTab, setActiveTab] = useState<string>("backend-values");

  const tabs = [
    {
      value: "backend-values",
      label: t("debug.backendValues", { defaultValue: "Backend Debug Values" }),
    },
    { value: "server-logs", label: t("debug.serverLogs", { defaultValue: "Server Logs" }) },
    {
      value: "home-assistant-api",
      label: t("debug.homeAssistantApi", { defaultValue: "Home Assistant API" }),
    },
    { value: "onboarding-tools", label: t("debug.onboardingTools") },
    { value: "commissioning", label: t("debug.commissioning.tabLabel") },
  ];

  return (
    <Container size="xl">
      <Stack gap="xl">
        <Stack gap="xs">
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={1}>{t("debug.title")}</Title>
              <Text c="dimmed">{t("debug.description")}</Text>
            </div>
            <Button
              variant="light"
              leftSection={<IconExternalLink size={16} />}
              onClick={() => router.navigate({ to: "/debug/home-assistant" })}
            >
              {t("debug.haEntities.openLink", { defaultValue: "HA Entities" })}
            </Button>
          </Group>
        </Stack>

        <Tabs value={activeTab} onChange={(v) => setActiveTab(v ?? "backend-values")}>
          {isMobile ? (
            <Select
              data={tabs}
              value={activeTab}
              onChange={(v) => setActiveTab(v ?? "backend-values")}
              mb="md"
              allowDeselect={false}
            />
          ) : (
            <Tabs.List>
              {tabs.map((tab) => (
                <Tabs.Tab key={tab.value} value={tab.value}>
                  {tab.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          )}

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

          <Tabs.Panel value="commissioning" pt="md">
            <CommissioningPanel />
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}
