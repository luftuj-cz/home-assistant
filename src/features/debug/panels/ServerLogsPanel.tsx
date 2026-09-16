import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { createLogger } from "@luftuj/shared/utils/logger";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { triggerBlobDownload } from "@luftuj/shared/utils/download";
import {
  formatLogContext,
  formatLogTime,
  formatTimestamp,
  getLogLevelColor,
  type ServerLogEntry,
} from "@luftuj/features/debug/panels/utils";

const logger = createLogger("ServerLogsPanel");

const ALL_LEVELS = "__all__";

type ServerLogRow = {
  id: string;
  entry: ServerLogEntry;
  context: string;
};

export function ServerLogsPanel() {
  const { t } = useTranslation();
  const [logsDownloading, setLogsDownloading] = useState(false);
  const [serverLogs, setServerLogs] = useState<ServerLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsRefreshing, setLogsRefreshing] = useState(false);
  const [logsErrorMessage, setLogsErrorMessage] = useState<string | null>(null);
  const [logsBufferedCount, setLogsBufferedCount] = useState<number>(0);
  const [autoRefreshPaused, setAutoRefreshPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<string>(ALL_LEVELS);
  const [expanded, setExpanded] = useState<string | null>(null);
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

  async function handleDownloadLogs(): Promise<void> {
    setLogsDownloading(true);
    try {
      const response = await fetch(resolveApiUrl("/api/debug/logs/download?limit=1000"));
      if (!response.ok) {
        notifications.show({
          title: t("debug.logs.downloadFailedTitle", { defaultValue: "Download failed" }),
          message: t("debug.logs.downloadFailed", {
            defaultValue: "Failed to download server logs: HTTP {{status}}",
            status: response.status,
          }),
          color: "red",
        });
        return;
      }

      const blob = await response.blob();
      triggerBlobDownload(blob, `luftator-logs-${Date.now()}.log`);
    } catch (error) {
      logger.error("Server log download failed", { error });
      notifications.show({
        title: t("debug.logs.downloadFailedTitle", { defaultValue: "Download failed" }),
        message: t("debug.logs.downloadFailedUnknown", {
          defaultValue: "Failed to download server logs.",
        }),
        color: "red",
      });
    } finally {
      setLogsDownloading(false);
    }
  }

  useEffect(() => {
    void loadServerLogs(true);
  }, [t]);

  useEffect(() => {
    if (autoRefreshPaused) {
      return;
    }

    const intervalId = globalThis.setInterval(() => {
      void loadServerLogs(false);
    }, 5000);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [autoRefreshPaused, t]);

  // Row ids stay stable across refreshes so an expanded row keeps its context
  // open when new lines arrive and shift every array index.
  const logRows = useMemo<ServerLogRow[]>(() => {
    const ordered = serverLogs.toSorted(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const occurrences = new Map<string, number>();

    return ordered.map((entry) => {
      const signature = `${entry.timestamp}|${entry.level}|${entry.line}`;
      const occurrence = occurrences.get(signature) ?? 0;
      occurrences.set(signature, occurrence + 1);

      return {
        id: `${signature}#${occurrence}`,
        entry,
        context: formatLogContext(entry.context),
      };
    });
  }, [serverLogs]);

  const levelOptions = useMemo(() => {
    const levels = Array.from(new Set(logRows.map((row) => row.entry.level.toLowerCase()))).sort(
      (a, b) => a.localeCompare(b),
    );
    return [
      { value: ALL_LEVELS, label: t("debug.logs.allLevels", { defaultValue: "All levels" }) },
      ...levels.map((value) => ({ value, label: value.toUpperCase() })),
    ];
  }, [logRows, t]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return logRows.filter((row) => {
      if (level !== ALL_LEVELS && row.entry.level.toLowerCase() !== level) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        row.entry.message.toLowerCase().includes(term) || row.context.toLowerCase().includes(term)
      );
    });
  }, [logRows, level, search]);

  useEffect(() => {
    if (autoRefreshPaused) {
      return;
    }

    if (logsViewportRef.current) {
      logsViewportRef.current.scrollTo({ top: 0 });
    }
  }, [autoRefreshPaused, filteredRows]);

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Title order={3}>{t("debug.serverLogs", { defaultValue: "Server Logs" })}</Title>
        <Group gap="xs">
          <Button
            variant="light"
            leftSection={<IconDownload size={16} />}
            loading={logsDownloading}
            onClick={() => {
              void handleDownloadLogs();
            }}
          >
            {t("debug.logs.download", { defaultValue: "Download log" })}
          </Button>
          <Button
            variant={autoRefreshPaused ? "filled" : "light"}
            color={autoRefreshPaused ? "yellow" : undefined}
            leftSection={
              autoRefreshPaused ? <IconPlayerPlay size={16} /> : <IconPlayerPause size={16} />
            }
            onClick={() => {
              setAutoRefreshPaused((paused) => !paused);
            }}
          >
            {autoRefreshPaused
              ? t("debug.logs.resumeAutoRefresh", { defaultValue: "Resume auto-refresh" })
              : t("debug.logs.pauseAutoRefresh", { defaultValue: "Pause auto-refresh" })}
          </Button>
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
      </Group>

      <Group>
        <TextInput
          flex={1}
          placeholder={t("debug.logs.searchPlaceholder", {
            defaultValue: "Search in messages and context…",
          })}
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <Select
          data={levelOptions}
          value={level}
          onChange={(value) => setLevel(value ?? ALL_LEVELS)}
          w={180}
        />
      </Group>

      <Group gap="xs" align="center">
        <Text size="xs" c="dimmed">
          {t("debug.logs.count", {
            defaultValue: "{{shown}} of {{total}} lines, {{buffered}} buffered on the server",
            shown: filteredRows.length,
            total: logRows.length,
            buffered: logsBufferedCount,
          })}
        </Text>
        {autoRefreshPaused ? (
          <Badge color="yellow" variant="light" size="sm">
            {t("debug.logs.autoRefreshPaused", { defaultValue: "Auto-refresh paused" })}
          </Badge>
        ) : null}
      </Group>

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

      {!logsLoading && filteredRows.length > 0 ? (
        <ScrollArea h={700} viewportRef={logsViewportRef}>
          <Table striped highlightOnHover withTableBorder miw={720}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={130}>{t("debug.logs.table.time", { defaultValue: "Time" })}</Table.Th>
                <Table.Th w={90}>{t("debug.logs.table.level", { defaultValue: "Level" })}</Table.Th>
                <Table.Th>{t("debug.logs.table.message", { defaultValue: "Message" })}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredRows.map((row) => {
                const isOpen = expanded === row.id;
                const hasContext = row.context.length > 0;
                const chevron = isOpen ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronRight size={14} />
                );

                return (
                  <Fragment key={row.id}>
                    <Table.Tr>
                      <Table.Td>
                        <Text size="xs" ff="monospace" title={formatTimestamp(row.entry.timestamp)}>
                          {formatLogTime(row.entry.timestamp)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={getLogLevelColor(row.entry.level)} variant="light">
                          {row.entry.level.toUpperCase()}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <UnstyledButton
                          onClick={() => setExpanded(isOpen ? null : row.id)}
                          disabled={!hasContext}
                          w="100%"
                        >
                          <Group gap="xs" wrap="nowrap" align="flex-start">
                            {hasContext ? chevron : <span style={{ width: 14 }} />}
                            <Text size="sm" style={{ textAlign: "left" }}>
                              {row.entry.message}
                            </Text>
                          </Group>
                        </UnstyledButton>
                      </Table.Td>
                    </Table.Tr>
                    {isOpen ? (
                      <Table.Tr>
                        <Table.Td colSpan={3}>
                          <Code block>{row.context}</Code>
                        </Table.Td>
                      </Table.Tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      ) : null}

      {!logsLoading && !logsErrorMessage && logRows.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("debug.logs.noData", { defaultValue: "No server logs captured yet." })}
        </Text>
      ) : null}

      {!logsLoading && !logsErrorMessage && logRows.length > 0 && filteredRows.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("debug.logs.noMatches", { defaultValue: "No log lines match the current filter." })}
        </Text>
      ) : null}
    </Stack>
  );
}
