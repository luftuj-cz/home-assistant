import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Text,
  Tabs,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCopy, IconRefresh } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { resolveApiUrl } from "../utils/api";

type DebugPayload = Record<string, unknown>;

type DebugRow = {
  key: string;
  value: string;
};

type ServerLogEntry = {
  timestamp: string;
  level: string;
  message: string;
  context?: string;
  line: string;
};

function isBytePath(path: string): boolean {
  const normalized = path.toLowerCase();
  return normalized.startsWith("app.memory.") || normalized.endsWith("bytes");
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return String(bytes);
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Math.abs(bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const signedValue = bytes < 0 ? -value : value;
  const precision = unitIndex === 0 ? 0 : signedValue >= 10 ? 1 : 2;
  const human = `${signedValue.toFixed(precision)} ${units[unitIndex]}`;
  return `${human} (${Math.round(bytes).toLocaleString()} B)`;
}

function formatDebugValue(value: unknown, path: string): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "number" && isBytePath(path)) {
    return formatByteSize(value);
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectDebugRows(value: unknown, path: string, rows: DebugRow[]): void {
  if (value === null || value === undefined) {
    rows.push({ key: path, value: formatDebugValue(value, path) });
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      rows.push({ key: path, value: "[]" });
      return;
    }
    value.forEach((item, index) => {
      collectDebugRows(item, `${path}[${index}]`, rows);
    });
    return;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      rows.push({ key: path, value: "{}" });
      return;
    }
    entries.forEach(([key, nested]) => {
      const nextPath = path ? `${path}.${key}` : key;
      collectDebugRows(nested, nextPath, rows);
    });
    return;
  }

  rows.push({ key: path, value: formatDebugValue(value, path) });
}

function flattenDebugRows(payload: DebugPayload | null): DebugRow[] {
  if (!payload) {
    return [];
  }

  const rows: DebugRow[] = [];
  collectDebugRows(payload, "", rows);
  return rows
    .filter((item) => item.key.trim().length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function formatTimestamp(value: string): string {
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? value : asDate.toLocaleString();
}

function getLogLevelColor(level: string): string {
  const normalized = level.toLowerCase();
  if (normalized === "fatal" || normalized === "error") {
    return "red";
  }
  if (normalized === "warn") {
    return "yellow";
  }
  if (normalized === "info") {
    return "blue";
  }
  if (normalized === "debug") {
    return "teal";
  }
  return "gray";
}

function formatLogContext(context?: string): string {
  if (!context) {
    return "";
  }

  try {
    const parsed = JSON.parse(context) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return context;
  }
}

export function DebugPage() {
  const { t } = useTranslation();
  const [debugData, setDebugData] = useState<DebugPayload | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copyingValues, setCopyingValues] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [serverLogs, setServerLogs] = useState<ServerLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsRefreshing, setLogsRefreshing] = useState(false);
  const [logsErrorMessage, setLogsErrorMessage] = useState<string | null>(null);
  const [logsBufferedCount, setLogsBufferedCount] = useState<number>(0);
  const [haApiData, setHaApiData] = useState<DebugPayload | null>(null);
  const [haApiCapturedAt, setHaApiCapturedAt] = useState<string | null>(null);
  const [haApiLoading, setHaApiLoading] = useState(true);
  const [haApiRefreshing, setHaApiRefreshing] = useState(false);
  const [haApiErrorMessage, setHaApiErrorMessage] = useState<string | null>(null);
  const logsViewportRef = useRef<HTMLDivElement | null>(null);

  async function loadDebugSnapshot(initialLoad: boolean): Promise<void> {
    if (initialLoad) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const response = await fetch(resolveApiUrl("/api/debug"), { cache: "no-cache" });
      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new Error(detail || `HTTP ${response.status}`);
      }

      const payload = (await response.json()) as DebugPayload;
      setDebugData(payload);
      const timestamp =
        typeof payload.capturedAt === "string" ? payload.capturedAt : new Date().toISOString();
      setCapturedAt(timestamp);
      setErrorMessage(null);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t("debug.loadFailedUnknown", { defaultValue: "Failed to load debug values." });
      setErrorMessage(
        t("debug.loadFailed", {
          defaultValue: "Failed to load debug values: {{message}}",
          message,
        }),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

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
      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new Error(detail || `HTTP ${response.status}`);
      }

      const payload = (await response.json()) as DebugPayload;
      setHaApiData(payload);
      const timestamp =
        typeof payload.capturedAt === "string" ? payload.capturedAt : new Date().toISOString();
      setHaApiCapturedAt(timestamp);
      setHaApiErrorMessage(null);
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

  async function copyBackendValues(): Promise<void> {
    if (!debugData) {
      setCopyStatus("failed");
      return;
    }

    setCopyingValues(true);
    try {
      const text = JSON.stringify(debugData, null, 2);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.setAttribute("readonly", "true");
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand("copy");
        document.body.removeChild(textArea);
        if (!successful) {
          throw new Error("Clipboard copy failed");
        }
      }
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    } finally {
      setCopyingValues(false);
    }
  }

  async function loadServerLogs(initialLoad: boolean): Promise<void> {
    if (initialLoad) {
      setLogsLoading(true);
    } else {
      setLogsRefreshing(true);
    }

    try {
      const response = await fetch(resolveApiUrl("/api/debug/logs?limit=500"), { cache: "no-cache" });
      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new Error(detail || `HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        logs?: ServerLogEntry[];
        bufferedCount?: number;
      };

      setServerLogs(Array.isArray(payload.logs) ? payload.logs : []);
      setLogsBufferedCount(
        Number.isFinite(payload.bufferedCount) ? (payload.bufferedCount as number) : 0,
      );
      setLogsErrorMessage(null);
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
    void loadDebugSnapshot(true);
    const intervalId = window.setInterval(() => {
      void loadDebugSnapshot(false);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    void loadServerLogs(true);
    const intervalId = window.setInterval(() => {
      void loadServerLogs(false);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    void loadHomeAssistantApiSnapshot(true);
    const intervalId = window.setInterval(() => {
      void loadHomeAssistantApiSnapshot(false);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const rows = useMemo(() => flattenDebugRows(debugData), [debugData]);
  const haApiRows = useMemo(() => flattenDebugRows(haApiData), [haApiData]);
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
                  <Text size="sm">
                    {t("debug.loading", { defaultValue: "Loading debug values…" })}
                  </Text>
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
          </Tabs.Panel>

          <Tabs.Panel value="home-assistant-api" pt="md">
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
          </Tabs.Panel>

          <Tabs.Panel value="server-logs" pt="md">
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
                  <Text size="sm">
                    {t("debug.logs.loading", { defaultValue: "Loading server logs…" })}
                  </Text>
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
          </Tabs.Panel>

          <Tabs.Panel value="onboarding-tools" pt="md">
            <Stack gap="xs">
              <Group gap="md">
                <Button
                  color="red"
                  variant="light"
                  onClick={async () => {
                    await fetch(resolveApiUrl("/api/settings/onboarding-reset"), { method: "POST" });
                    window.location.reload();
                  }}
                >
                  {t("debug.resetOnboarding")}
                </Button>
                <Button
                  color="green"
                  variant="light"
                  onClick={async () => {
                    await fetch(resolveApiUrl("/api/settings/onboarding-finish"), { method: "POST" });
                    window.location.reload();
                  }}
                >
                  {t("debug.finishOnboarding")}
                </Button>
              </Group>
              <Text size="xs" c="dimmed">
                {t("debug.resetOnboardingHint")}
              </Text>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}
