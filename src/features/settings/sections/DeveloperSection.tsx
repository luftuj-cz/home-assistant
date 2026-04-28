import { useEffect, useState } from "react";
import {
  Accordion,
  Divider,
  Group,
  Paper,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { IconBug, IconCode } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";

import { MotionSwitch } from "../../../components/common/MotionSwitch";
import { resolveApiUrl } from "../../../shared/utils/api";
import {
  createLogger,
  getLogLevel,
  setLogLevel,
  VALID_LOG_LEVELS,
  type LogLevel,
} from "../../../shared/utils/logger";

const logger = createLogger("DeveloperSection");

export function DeveloperSection() {
  const { t } = useTranslation();
  const [debugMode, setDebugMode] = useState(false);
  const [logLevel, setLogLevelState] = useState<LogLevel>(() => getLogLevel());

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const [debugRes, logRes] = await Promise.all([
          fetch(resolveApiUrl("/api/settings/debug-mode"), { cache: "no-cache" }),
          fetch(resolveApiUrl("/api/settings/log-level"), { cache: "no-cache" }),
        ]);
        if (canceled) return;
        if (debugRes.ok) {
          const { enabled } = await debugRes.json();
          setDebugMode(enabled);
        }
        if (logRes.ok) {
          const { level } = await logRes.json();
          setLogLevel(level as LogLevel);
          setLogLevelState(level as LogLevel);
        }
      } catch (err) {
        logger.error("Failed to load developer settings", { error: err });
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, []);

  function handleDebugChange(checked: boolean) {
    setDebugMode(checked);
    void fetch(resolveApiUrl("/api/settings/debug-mode"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: checked }),
    }).then(() => {
      setTimeout(() => window.location.reload(), 800);
    });
    notifications.show({
      title: t("settings.developer.debugMode"),
      message: checked
        ? t("settings.developer.debugEnabled")
        : t("settings.developer.debugDisabled"),
      color: checked ? "blue" : "gray",
      icon: <IconBug size={20} />,
    });
  }

  async function handleLogLevelChange(value: string | null) {
    if (!value || !VALID_LOG_LEVELS.includes(value as LogLevel)) return;
    setLogLevel(value as LogLevel);
    setLogLevelState(value as LogLevel);
    try {
      const res = await fetch(resolveApiUrl("/api/settings/log-level"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: value }),
      });
      if (res.ok) {
        notifications.show({
          title: t("settings.developer.logLevel"),
          message: t("settings.developer.logLevelChanged", { level: value }),
          color: "blue",
        });
      }
    } catch (err) {
      logger.error("Failed to save log level", { error: err });
    }
  }

  return (
    <Accordion.Item value="developer">
      <Accordion.Control icon={<IconCode size={20} />}>
        <Text fw={600}>{t("settings.developer.title")}</Text>
      </Accordion.Control>
      <Accordion.Panel>
        <Paper p="md" withBorder radius="md">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Stack gap={0}>
                <Text fw={500}>{t("settings.developer.debugMode")}</Text>
                <Text size="xs" c="dimmed">
                  {t("settings.developer.debugModeDescription")}
                </Text>
              </Stack>
              <MotionSwitch
                checked={debugMode}
                onChange={(e) => handleDebugChange(e.currentTarget.checked)}
                size="md"
              />
            </Group>

            <Divider />

            <Group justify="space-between" align="center">
              <Stack gap={0}>
                <Text fw={500}>{t("settings.developer.logLevel")}</Text>
                <Text size="xs" c="dimmed">
                  {t("settings.developer.logLevelDescription")}
                </Text>
              </Stack>
              <Select
                value={logLevel}
                onChange={(v) => void handleLogLevelChange(v)}
                data={VALID_LOG_LEVELS.map((level) => ({
                  value: level,
                  label: level.toUpperCase(),
                }))}
                size="sm"
                w={120}
                searchable
                allowDeselect={false}
              />
            </Group>
          </Stack>
        </Paper>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
