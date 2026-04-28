import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveApiUrl } from "../../../shared/utils/api";
import { formatLogContext, formatTimestamp, getLogLevelColor, type ServerLogEntry } from "./utils";

export function ServerLogsPanel() {
  const { t } = useTranslation();
  const [serverLogs, setServerLogs] = useState<ServerLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsRefreshing, setLogsRefreshing] = useState(false);
  const [logsErrorMessage, setLogsErrorMessage] = useState<string | null>(null);
  const [logsBufferedCount, setLogsBufferedCount] = useState<number>(0);
  const logsViewportRef = useRef<HTMLDivElement | null>(null);

  async function loadServerLogs(initialLoad: boolean): Promise<void> {
    if (initialLoad) {
      setLogsLoading(true);
    } else {
      setLogsRefreshing(true);
    }

    try {
      const response = await fetch(resolveApiUrl("/api/debug/logs?limit=500"), {
        cache: "no-cache",
      });
      if (response.ok) {
        const payload = (await response.json()) as {
          logs?: ServerLogEntry[];
          bufferedCount?: number;
        };

        setServerLogs(Array.isArray(payload.logs) ? payload.logs : []);
        setLogsBufferedCount(
          Number.isFinite(payload.bufferedCount) ? (payload.bufferedCount as number) : 0,
        );
        setLogsErrorMessage(null);
      } else {
        const detail = (await response.text()).trim();
        const message = detail || `HTTP ${response.status}`;
        setLogsErrorMessage(
          t("debug.logs.loadFailed", {
            defaultValue: "Failed to load server logs: {{message}}",
            message,
          }),
        );
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t("debug.logs.loadFailedUnknown", {
              defaultValue: "Failed to load server logs.",
            });
      setLogsErrorMessage(
        t("debug.logs.loadFailed", {
          defaultValue: "Failed to load server logs: {{message}}",
          message,
        }),
      );
    } finally {
      setLogsLoading(false);
      setLogsRefreshing(false);
    }
  }

  useEffect(() => {
    void loadServerLogs(true);
    const intervalId = window.setInterval(() => {
      void loadServerLogs(false);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [t]);

  const orderedServerLogs = useMemo(() => {
    return serverLogs
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [serverLogs]);

  useEffect(() => {
    if (logsViewportRef.current) {
      logsViewportRef.current.scrollTo({ top: 0 });
    }
  }, [orderedServerLogs]);

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Title order={3}>{t("debug.serverLogs", { defaultValue: "Server Logs" })}</Title>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={logsRefreshing}
          onClick={() => {
            void loadServerLogs(false);
          }}
        >
          {t("debug.refresh", { defaultValue: "Refresh" })}
        </Button>
      </Group>

      <Text size="xs" c="dimmed">
        {t("debug.logs.bufferedCount", {
          defaultValue: "Buffered log lines: {{count}}",
          count: logsBufferedCount,
        })}
      </Text>

      {logsLoading ? (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm">{t("debug.logs.loading", { defaultValue: "Loading server logs…" })}</Text>
        </Group>
      ) : null}

      {logsErrorMessage ? (
        <Alert color="red" icon={<IconAlertCircle size={16} />}>
          {logsErrorMessage}
        </Alert>
      ) : null}

      {!logsLoading && serverLogs.length > 0 ? (
        <ScrollArea h={700} viewportRef={logsViewportRef}>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <thead>
              <tr>
                <th>{t("debug.logs.table.time", { defaultValue: "Time" })}</th>
                <th>{t("debug.logs.table.level", { defaultValue: "Level" })}</th>
                <th>{t("debug.logs.table.message", { defaultValue: "Message" })}</th>
              </tr>
            </thead>
            <tbody>
              {orderedServerLogs.map((entry, index) => (
                <tr key={`${entry.timestamp}-${entry.level}-${index}`}>
                  <td>
                    <Text size="xs" ff="monospace">
                      {formatTimestamp(entry.timestamp)}
                    </Text>
                  </td>
                  <td>
                    <Badge color={getLogLevelColor(entry.level)} variant="light">
                      {entry.level.toUpperCase()}
                    </Badge>
                  </td>
                  <td>
                    <Stack gap={4}>
                      <Text size="sm" fw={600}>
                        {entry.message}
                      </Text>
                      {entry.context ? (
                        <Text
                          size="xs"
                          c="dimmed"
                          ff="monospace"
                          style={{ whiteSpace: "pre-wrap" }}
                        >
                          {formatLogContext(entry.context)}
                        </Text>
                      ) : null}
                    </Stack>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </ScrollArea>
      ) : null}

      {!logsLoading && !logsErrorMessage && serverLogs.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("debug.logs.noData", { defaultValue: "No server logs captured yet." })}
        </Text>
      ) : null}
    </Stack>
  );
}
