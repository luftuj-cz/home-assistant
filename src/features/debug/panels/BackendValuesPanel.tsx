import { Alert, Button, Group, Loader, ScrollArea, Stack, Table, Text, Title } from "@mantine/core";
import { IconAlertCircle, IconCopy, IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import {
  flattenDebugRows,
  formatTimestamp,
  type DebugPayload,
} from "@luftuj/features/debug/panels/utils";

export function BackendValuesPanel() {
  const { t } = useTranslation();
  const [debugData, setDebugData] = useState<DebugPayload | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copyingValues, setCopyingValues] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const loadDebugSnapshot = useCallback(
    async (initialLoad: boolean): Promise<void> => {
      if (initialLoad) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const response = await fetch(resolveApiUrl("/api/debug"), { cache: "no-cache" });
        if (response.ok) {
          const payload = (await response.json()) as DebugPayload;
          setDebugData(payload);
          const timestamp =
            typeof payload.capturedAt === "string" ? payload.capturedAt : new Date().toISOString();
          setCapturedAt(timestamp);
          setErrorMessage(null);
        } else {
          const detail = (await response.text()).trim();
          const message = detail || `HTTP ${response.status}`;
          setErrorMessage(
            t("debug.loadFailed", {
              defaultValue: "Failed to load debug values: {{message}}",
              message,
            }),
          );
        }
      } catch (error) {
        const msg =
          error instanceof Error && error.message
            ? error.message
            : t("debug.loadFailedUnknown", { defaultValue: "Failed to load debug values." });
        setErrorMessage(
          t("debug.loadFailed", {
            defaultValue: "Failed to load debug values: {{message}}",
            message: msg,
          }),
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  async function copyBackendValues(): Promise<void> {
    if (!debugData) {
      setCopyStatus("failed");
      return;
    }

    setCopyingValues(true);
    try {
      const text = JSON.stringify(debugData, null, 2);
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
    } catch (error) {
      console.error("Clipboard copy failed", error);
      setCopyStatus("failed");
    } finally {
      setCopyingValues(false);
    }
  }

  useEffect(() => {
    void loadDebugSnapshot(true);
    const intervalId = window.setInterval(() => {
      void loadDebugSnapshot(false);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadDebugSnapshot]);

  const rows = useMemo(() => flattenDebugRows(debugData), [debugData]);

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Title order={3}>
          {t("debug.backendValues", { defaultValue: "Backend Debug Values" })}
        </Title>
        <Group gap="xs">
          <Button
            variant="light"
            leftSection={<IconCopy size={16} />}
            loading={copyingValues}
            disabled={!debugData}
            onClick={() => {
              void copyBackendValues();
            }}
          >
            {t("debug.copyValues", { defaultValue: "Copy values" })}
          </Button>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={refreshing}
            onClick={() => {
              void loadDebugSnapshot(false);
            }}
          >
            {t("debug.refresh", { defaultValue: "Refresh" })}
          </Button>
        </Group>
      </Group>

      {capturedAt ? (
        <Text size="xs" c="dimmed">
          {t("debug.lastUpdated", {
            defaultValue: "Last updated: {{time}}",
            time: formatTimestamp(capturedAt),
          })}
        </Text>
      ) : null}

      {copyStatus === "copied" ? (
        <Text size="xs" c="teal">
          {t("debug.copySuccess", { defaultValue: "Debug values copied to clipboard." })}
        </Text>
      ) : null}

      {copyStatus === "failed" ? (
        <Text size="xs" c="red">
          {t("debug.copyFailed", { defaultValue: "Failed to copy debug values." })}
        </Text>
      ) : null}

      {loading ? (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm">{t("debug.loading", { defaultValue: "Loading debug values…" })}</Text>
        </Group>
      ) : null}

      {errorMessage ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {errorMessage}
        </Alert>
      ) : null}

      {!loading && rows.length > 0 ? (
        <ScrollArea h={700}>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <thead>
              <tr>
                <th>{t("debug.table.key", { defaultValue: "Key" })}</th>
                <th>{t("debug.table.value", { defaultValue: "Value" })}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
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

      {!loading && !errorMessage && rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("debug.noData", { defaultValue: "No debug values received." })}
        </Text>
      ) : null}
    </Stack>
  );
}
