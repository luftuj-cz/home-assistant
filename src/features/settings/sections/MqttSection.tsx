import { startTransition, useCallback, useEffect, useState } from "react";
import {
  Accordion,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";

import { MotionSwitch } from "../../../shared/ui";
import { resolveApiUrl } from "../../../shared/utils/api";
import { parseApiError, translateApiError } from "../../../shared/utils/apiError";
import { createLogger } from "../../../shared/utils/logger";

const logger = createLogger("MqttSection");

interface MqttSettings {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
}

const initial: MqttSettings = {
  enabled: false,
  host: "",
  port: 1883,
  user: "",
  password: "",
};

export function MqttSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<MqttSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<"success" | "error" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const res = await fetch(resolveApiUrl("/api/settings/mqtt"), { cache: "no-cache" });
        if (!res.ok || canceled) return;
        const data = await res.json();
        setSettings({
          enabled: !!data.enabled,
          host: data.host || "",
          port: data.port || 1883,
          user: data.user || "",
          password: data.password || "",
        });
      } catch (err) {
        logger.error("Failed to load MQTT settings", { error: err });
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, []);

  function update<K extends keyof MqttSettings>(key: K, value: MqttSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setStatus(null);
    setError(null);
  }

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(resolveApiUrl("/api/settings/mqtt"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await parseApiError(res);
        notifications.show({
          title: t("settings.mqtt.notifications.saveFailedTitle"),
          message: translateApiError(err, t),
          color: "red",
        });
        return;
      }
      notifications.show({
        title: t("settings.mqtt.notifications.saveSuccessTitle"),
        message: t("settings.mqtt.notifications.saveSuccessMessage"),
        color: "green",
      });
    } catch (err) {
      logger.error("Failed to save MQTT settings", { error: err });
      notifications.show({
        title: t("settings.mqtt.notifications.saveFailedTitle"),
        message: t("settings.mqtt.notifications.unknown"),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  }, [settings, t]);

  const test = useCallback(async () => {
    startTransition(() => {
      setStatus(null);
      setError(null);
    });
    setTesting(true);
    try {
      const res = await fetch(resolveApiUrl("/api/settings/mqtt/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await parseApiError(res);
        const message = translateApiError(err, t);
        startTransition(() => {
          setStatus("error");
          setError(message);
        });
        return;
      }
      startTransition(() => setStatus("success"));
    } catch (err) {
      logger.error("MQTT connection test failed", { error: err });
      startTransition(() => {
        setStatus("error");
        setError(t("settings.mqtt.notifications.unknown"));
      });
    } finally {
      setTesting(false);
    }
  }, [settings, t]);

  const hostMissing = settings.enabled && settings.host.trim() === "";

  return (
    <Accordion.Item value="mqtt">
      <Accordion.Control icon={<IconSettings size={20} />}>
        <Text fw={600}>{t("settings.mqtt.title")}</Text>
      </Accordion.Control>
      <Accordion.Panel>
        <Paper p="md" withBorder radius="md">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Text fw={500} size="md">
                {t("settings.mqtt.description")}
              </Text>
              <MotionSwitch
                label={t("settings.mqtt.enabled")}
                checked={settings.enabled}
                onChange={(e) => update("enabled", e.currentTarget.checked)}
                size="md"
              />
            </Group>

            {settings.enabled && (
              <Stack gap="md" mt="xs">
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <TextInput
                    value={settings.host}
                    onChange={(e) => update("host", e.target.value)}
                    label={t("settings.mqtt.host")}
                    placeholder="core-mosquitto"
                    error={hostMissing ? t("settings.mqtt.hostRequired") : undefined}
                    size="md"
                  />
                  <NumberInput
                    value={settings.port}
                    onChange={(v) => update("port", typeof v === "number" ? v : 0)}
                    label={t("settings.mqtt.port")}
                    placeholder="1883"
                    min={1}
                    max={65535}
                    error={
                      settings.port <= 0 || settings.port > 65535
                        ? t("settings.mqtt.portInvalid")
                        : undefined
                    }
                    size="md"
                  />
                </SimpleGrid>

                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <TextInput
                    value={settings.user}
                    onChange={(e) => update("user", e.target.value)}
                    label={t("settings.mqtt.user")}
                    autoComplete="off"
                    size="md"
                  />
                  <PasswordInput
                    value={settings.password}
                    onChange={(e) => update("password", e.target.value)}
                    label={t("settings.mqtt.password")}
                    autoComplete="new-password"
                    size="md"
                  />
                </SimpleGrid>
              </Stack>
            )}

            <Group mt="sm">
              <Button
                onClick={save}
                loading={saving}
                disabled={hostMissing}
                variant="filled"
                size="md"
              >
                {t("settings.mqtt.save")}
              </Button>
              <Button
                onClick={test}
                loading={testing}
                disabled={settings.host.trim() === ""}
                variant="light"
                size="md"
              >
                {t("settings.mqtt.test")}
              </Button>
              {status === "success" && (
                <Badge color="green" variant="light">
                  {t("settings.mqtt.testSuccess")}
                </Badge>
              )}
              {status === "error" && (
                <Badge color="red" variant="light">
                  {error || t("settings.mqtt.notifications.unknown")}
                </Badge>
              )}
            </Group>
          </Stack>
        </Paper>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
