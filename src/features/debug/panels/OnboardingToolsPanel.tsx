import { Button, Group, Stack } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconPlayerStop, IconRefresh, IconTrash } from "@tabler/icons-react";
import { resolveApiUrl } from "../../../shared/utils/api";

export function OnboardingToolsPanel() {
  const { t } = useTranslation();
  const [discoveryRefreshing, setDiscoveryRefreshing] = useState(false);
  const [valvesRefreshing, setValvesRefreshing] = useState(false);
  const [overrideStopping, setOverrideStopping] = useState(false);
  const [schedulerRestarting, setSchedulerRestarting] = useState(false);
  const [databaseResetting, setDatabaseResetting] = useState(false);

  async function loadDebugSnapshot(): Promise<void> {
    const response = await fetch(resolveApiUrl("/api/debug"), { cache: "no-cache" });
    if (!response.ok) {
      console.error("Failed to reload debug snapshot");
    }
  }

  async function refreshMqttDiscovery(): Promise<void> {
    setDiscoveryRefreshing(true);
    try {
      const response = await fetch(resolveApiUrl("/api/settings/mqtt/discovery/refresh"), {
        method: "POST",
      });
      if (response.ok) {
        void loadDebugSnapshot();
      } else {
        const detail = (await response.text()).trim();
        console.error("Failed to refresh MQTT discovery", detail || `HTTP ${response.status}`);
      }
    } catch (error) {
      console.error("Failed to refresh MQTT discovery", error);
    } finally {
      setDiscoveryRefreshing(false);
    }
  }

  async function refreshValves(): Promise<void> {
    setValvesRefreshing(true);
    try {
      const response = await fetch(resolveApiUrl("/api/valves/refresh"), {
        method: "POST",
      });
      if (response.ok) {
        notifications.show({
          title: t("debug.valvesRefreshSuccess"),
          message: t("debug.valvesRefreshSuccessMessage"),
          color: "green",
        });
        void loadDebugSnapshot();
      } else {
        const detail = (await response.text()).trim();
        console.error("Failed to refresh valves", detail || `HTTP ${response.status}`);
      }
    } catch (error) {
      console.error("Failed to refresh valves", error);
    } finally {
      setValvesRefreshing(false);
    }
  }

  async function stopTimelineOverride(): Promise<void> {
    setOverrideStopping(true);
    try {
      const response = await fetch(resolveApiUrl("/api/timeline/override/stop"), {
        method: "POST",
      });
      if (response.ok) {
        void loadDebugSnapshot();
      } else {
        const detail = (await response.text()).trim();
        console.error("Failed to stop timeline override", detail || `HTTP ${response.status}`);
      }
    } catch (error) {
      console.error("Failed to stop timeline override", error);
    } finally {
      setOverrideStopping(false);
    }
  }

  async function restartScheduler(): Promise<void> {
    setSchedulerRestarting(true);
    try {
      const response = await fetch(resolveApiUrl("/api/timeline/scheduler/restart"), {
        method: "POST",
      });
      if (response.ok) {
        void loadDebugSnapshot();
      } else {
        const detail = (await response.text()).trim();
        console.error("Failed to restart scheduler", detail || `HTTP ${response.status}`);
      }
    } catch (error) {
      console.error("Failed to restart scheduler", error);
    } finally {
      setSchedulerRestarting(false);
    }
  }

  async function resetDatabase(): Promise<void> {
    if (!window.confirm(t("debug.resetDatabaseConfirm"))) {
      return;
    }

    setDatabaseResetting(true);
    try {
      const response = await fetch(resolveApiUrl("/api/database/reset"), {
        method: "POST",
      });
      if (response.ok) {
        notifications.show({
          title: t("debug.databaseResetSuccess"),
          message: t("debug.databaseResetSuccessMessage"),
          color: "green",
          autoClose: false,
        });

        setTimeout(() => {
          window.location.reload();
        }, 15000);
      } else {
        const detail = (await response.text()).trim();
        console.error("Failed to reset database", detail || `HTTP ${response.status}`);
        setDatabaseResetting(false);
      }
    } catch (error) {
      console.error("Failed to reset database", error);
      setDatabaseResetting(false);
    }
  }

  return (
    <Stack gap="md">
      <Group gap="md">
        <Button
          color="blue"
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={discoveryRefreshing}
          onClick={() => {
            void refreshMqttDiscovery();
          }}
        >
          {t("debug.refreshDiscovery")}
        </Button>
        <Button
          color="blue"
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={valvesRefreshing}
          onClick={() => {
            void refreshValves();
          }}
        >
          {t("debug.refreshValves")}
        </Button>
        <Button
          color="orange"
          variant="light"
          leftSection={<IconPlayerStop size={16} />}
          loading={overrideStopping}
          onClick={() => {
            void stopTimelineOverride();
          }}
        >
          {t("debug.stopOverride")}
        </Button>
        <Button
          color="violet"
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={schedulerRestarting}
          onClick={() => {
            void restartScheduler();
          }}
        >
          {t("debug.restartScheduler")}
        </Button>
        <Button
          color="red"
          variant="filled"
          leftSection={<IconTrash size={16} />}
          loading={databaseResetting}
          onClick={() => {
            void resetDatabase();
          }}
        >
          {t("debug.resetDatabase")}
        </Button>
        <Button
          color="red"
          variant="light"
          onClick={async () => {
            await fetch(resolveApiUrl("/api/settings/onboarding-reset"), {
              method: "POST",
            });
            window.location.reload();
          }}
        >
          {t("debug.resetOnboarding")}
        </Button>
      </Group>
    </Stack>
  );
}
