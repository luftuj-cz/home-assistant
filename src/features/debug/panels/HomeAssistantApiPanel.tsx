import { Alert, Button, Group, Loader, ScrollArea, Stack, Table, Text, Title } from "@mantine/core";
import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import {
  flattenDebugRows,
  formatTimestamp,
  type DebugPayload,
} from "@luftuj/features/debug/panels/utils";

export function HomeAssistantApiPanel() {
  const { t } = useTranslation();
  const [haApiData, setHaApiData] = useState<DebugPayload | null>(null);
  const [haApiCapturedAt, setHaApiCapturedAt] = useState<string | null>(null);
  const [haApiLoading, setHaApiLoading] = useState(true);
  const [haApiRefreshing, setHaApiRefreshing] = useState(false);
  const [haApiErrorMessage, setHaApiErrorMessage] = useState<string | null>(null);

  async function loadHomeAssistantApiSnapshot(initialLoad: boolean): Promise<void> {
    if (initialLoad) {
      setHaApiLoading(true);
    } else {
      setHaApiRefreshing(true);
    }

    try {
      const response = await fetch(resolveApiUrl("/api/debug/home-assistant"), {
        cache: "no-cache",
      });
      if (response.ok) {
        const payload = (await response.json()) as DebugPayload;
        setHaApiData(payload);
        const timestamp =
          typeof payload.capturedAt === "string" ? payload.capturedAt : new Date().toISOString();
        setHaApiCapturedAt(timestamp);
        setHaApiErrorMessage(null);
      } else {
        const detail = (await response.text()).trim();
        const message = detail || `HTTP ${response.status}`;
        setHaApiErrorMessage(
          t("debug.haApi.loadFailed", {
            defaultValue: "Failed to load Home Assistant API data: {{message}}",
            message,
          }),
        );
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t("debug.haApi.loadFailedUnknown", {
              defaultValue: "Failed to load Home Assistant API data.",
            });
      setHaApiErrorMessage(
        t("debug.haApi.loadFailed", {
          defaultValue: "Failed to load Home Assistant API data: {{message}}",
          message,
        }),
      );
    } finally {
      setHaApiLoading(false);
      setHaApiRefreshing(false);
    }
  }

  useEffect(() => {
    void loadHomeAssistantApiSnapshot(true);
    const intervalId = window.setInterval(() => {
      void loadHomeAssistantApiSnapshot(false);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [t]);

  const haApiRows = useMemo(() => flattenDebugRows(haApiData), [haApiData]);

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Title order={3}>
          {t("debug.homeAssistantApi", { defaultValue: "Home Assistant API" })}
        </Title>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={haApiRefreshing}
          onClick={() => {
            void loadHomeAssistantApiSnapshot(false);
          }}
        >
          {t("debug.refresh", { defaultValue: "Refresh" })}
        </Button>
      </Group>

      {haApiCapturedAt ? (
        <Text size="xs" c="dimmed">
          {t("debug.lastUpdated", {
            defaultValue: "Last updated: {{time}}",
            time: formatTimestamp(haApiCapturedAt),
          })}
        </Text>
      ) : null}

      {haApiLoading ? (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm">
            {t("debug.haApi.loading", {
              defaultValue: "Loading Home Assistant API data…",
            })}
          </Text>
        </Group>
      ) : null}

      {haApiErrorMessage ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {haApiErrorMessage}
        </Alert>
      ) : null}

      {!haApiLoading && haApiRows.length > 0 ? (
        <ScrollArea h={700}>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <thead>
              <tr>
                <th>{t("debug.table.key", { defaultValue: "Key" })}</th>
                <th>{t("debug.table.value", { defaultValue: "Value" })}</th>
              </tr>
            </thead>
            <tbody>
              {haApiRows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <Text ff="monospace" size="sm">
                      {row.key}
                    </Text>
                  </td>
                  <td>
                    <Text size="sm" ff="monospace" style={{ whiteSpace: "pre-wrap" }}>
                      {row.value}
                    </Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </ScrollArea>
      ) : null}

      {!haApiLoading && !haApiErrorMessage && haApiRows.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("debug.haApi.noData", {
            defaultValue: "No Home Assistant API data received.",
          })}
        </Text>
      ) : null}
    </Stack>
  );
}
