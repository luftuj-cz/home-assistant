import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Container,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconAdjustments, IconAlertCircle, IconFolders, IconRefresh } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { ValveGroupSection } from "@luftuj/features/valves/components/ValveGroupSection";
import { GroupManagerModal } from "@luftuj/features/valves/components/GroupManagerModal";
import { bulkSetValveGroupValue, fetchValveGroups } from "@luftuj/features/valves/api";
import { resolveApiUrl, resolveWebSocketUrl } from "@luftuj/shared/utils/api";
import { createLogger } from "@luftuj/shared/utils/logger";
import type { HaState } from "@luftuj/shared/types/homeAssistant";
import type { Valve, ValveGroup } from "@luftuj/shared/types/valve";

const logger = createLogger("ValvesPage");

type ManagedWebSocket = WebSocket & { manualClose?: boolean };

function normaliseValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isValveAvailable(state: HaState): boolean {
  const rawState = String(state.state ?? "")
    .trim()
    .toLowerCase();
  const attrs = state.attributes ?? {};
  const attributeAvailable = attrs.available;

  if (attrs.restored === true) {
    return false;
  }

  if (attributeAvailable === false) {
    return false;
  }

  if (rawState === "unavailable" || rawState === "unknown" || rawState === "offline") {
    return false;
  }

  return Number.isFinite(Number(state.state));
}

function mapValve(state: HaState): Valve {
  const attrs = state.attributes ?? {};
  return {
    entityId: state.entity_id,
    name: (attrs.friendly_name as string) ?? state.entity_id,
    value: normaliseValue(state.state, 0),
    min: normaliseValue(attrs.min, 0),
    max: normaliseValue(attrs.max, 90),
    step: normaliseValue(attrs.step, 5),
    state: state.state,
    isAvailable: isValveAvailable(state),
    attributes: attrs,
  };
}

function valvesFromStates(states: HaState[]): Record<string, Valve> {
  return states.reduce<Record<string, Valve>>((acc, state) => {
    const valve = mapValve(state);
    acc[valve.entityId] = valve;
    return acc;
  }, {});
}

export function ValvesPage() {
  const [valveMap, setValveMap] = useState<Record<string, Valve>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [haStatus, setHaStatus] = useState<
    "connected" | "connecting" | "disconnected" | "offline" | null
  >(null);
  const [hasUnavailableValves, setHasUnavailableValves] = useState(false);
  const [valveGroups, setValveGroups] = useState<ValveGroup[]>([]);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const wsRef = useRef<ManagedWebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const wsHandlersRef = useRef<{
    socket: ManagedWebSocket;
    closeHandler: (event: CloseEvent) => void;
    errorHandler: () => void;
  } | null>(null);

  const [gracePeriodExpired, setGracePeriodExpired] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setGracePeriodExpired(true);
    }, 10000);
    return () => clearTimeout(timer);
  }, []);

  const { t } = useTranslation();

  const valves = useMemo(() => {
    return Object.values(valveMap).toSorted((a, b) => a.name.localeCompare(b.name));
  }, [valveMap]);

  const allValvesClosed = useMemo(() => {
    if (valves.length === 0) return false;
    return valves.every((v) => v.value >= v.max);
  }, [valves]);

  const anyValveUnavailable = useMemo(() => {
    return hasUnavailableValves || valves.some((v) => !v.isAvailable);
  }, [hasUnavailableValves, valves]);

  const updateValve = useCallback((state: HaState) => {
    setValveMap((prev) => {
      const next = { ...prev };
      const valve = mapValve(state);
      next[valve.entityId] = valve;
      logger.debug("Valve updated from state payload", { entityId: valve.entityId });
      return next;
    });
  }, []);

  const replaceValves = useCallback((payload: HaState[]) => {
    const mapped = valvesFromStates(payload);
    const unavailableCount = Object.values(mapped).filter((v) => !v.isAvailable).length;
    logger.info("Valve snapshot applied", {
      total: Object.keys(mapped).length,
      unavailable: unavailableCount,
    });
    setValveMap(mapped);
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(resolveApiUrl("/api/status"));
      if (!res.ok) return;
      const data = (await res.json()) as {
        ha?: { connection?: string };
        valves?: { hasUnavailable?: boolean };
      };
      const connection = data?.ha?.connection;
      setHasUnavailableValves(data?.valves?.hasUnavailable === true);
      if (
        connection === "connected" ||
        connection === "connecting" ||
        connection === "disconnected" ||
        connection === "offline"
      ) {
        setHaStatus(connection);
      }
    } catch (statusError) {
      logger.debug("Failed to fetch HA status", { statusError });
    }
  }, []);

  const fetchSnapshot = useCallback(async () => {
    try {
      setLoading(true);
      const url = resolveApiUrl("/api/valves");
      logger.debug("Requesting valve snapshot via REST", { url });
      const response = await logger.timeAsync("valves.fetchSnapshot", async () => fetch(url));
      if (!response.ok) {
        const message = response.statusText || t("valves.errors.loadUnknown");
        setError(t("valves.errors.load", { message }));
        logger.warn("Valve snapshot request returned non-OK response", {
          status: response.status,
          statusText: response.statusText,
        });
        return;
      }

      const data: HaState[] = await response.json();
      replaceValves(data);
      logger.info("Valve snapshot loaded", { count: data.length });
      setError(null);
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : t("valves.errors.loadUnknown");
      setError(t("valves.errors.load", { message }));
      logger.error("Valve snapshot fetch failed", { error: fetchError });
    } finally {
      setLoading(false);
    }
  }, [replaceValves, t]);

  const fetchGroups = useCallback(async () => {
    try {
      const groups = await fetchValveGroups();
      setValveGroups(groups);
    } catch (groupsError) {
      logger.error("Failed to fetch valve groups", { error: groupsError });
    }
  }, []);

  useEffect(() => {
    logger.info("ValvesPage mounted, loading initial data");
    void fetchStatus();
    void fetchSnapshot();
    void fetchGroups();
  }, [fetchSnapshot, fetchStatus, fetchGroups]);

  const connectWebSocket = useCallback(() => {
    if (wsHandlersRef.current) {
      const { socket: existing, closeHandler, errorHandler } = wsHandlersRef.current;
      existing.manualClose = true;
      existing.removeEventListener("close", closeHandler);
      existing.removeEventListener("error", errorHandler);
      if (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CLOSING) {
        existing.close(1000, "reconnect");
      } else if (existing.readyState === WebSocket.CONNECTING) {
        function closeOnOpen() {
          existing.removeEventListener("open", closeOnOpen);
          existing.close(1000, "reconnect");
        }

        existing.addEventListener("open", closeOnOpen);
      } else {
        existing.close();
      }
      wsHandlersRef.current = null;
      wsRef.current = null;
    }

    const wsTarget = resolveWebSocketUrl("/ws/valves");
    logger.info("Opening valves WebSocket connection", { url: wsTarget });
    const socket = new WebSocket(wsTarget) as ManagedWebSocket;
    wsRef.current = socket;

    function onMessage(event: MessageEvent) {
      try {
        const message = JSON.parse(event.data as string) as {
          type: string;
          payload: HaState | HaState[];
        };
        if (message.type === "snapshot" && Array.isArray(message.payload)) {
          replaceValves(message.payload);
          logger.debug("Received websocket snapshot", { count: message.payload.length });
        } else if (message.type === "update" && !Array.isArray(message.payload)) {
          updateValve(message.payload);
          logger.debug("Received websocket valve update", {
            entityId: message.payload.entity_id,
          });
        }
      } catch (wsError) {
        const errMsg = wsError instanceof Error ? wsError.message : t("valves.errors.websocket");
        setError(errMsg);
        logger.error("Failed to parse websocket message", { error: wsError });
      }
    }

    function scheduleReconnect() {
      if (reconnectTimeoutRef.current !== null) {
        globalThis.clearTimeout(reconnectTimeoutRef.current);
      }
      logger.debug("Scheduling WebSocket reconnection", { delayMs: 3000 });
      reconnectTimeoutRef.current = globalThis.setTimeout(() => {
        logger.info("Reconnecting valves WebSocket");
        connectWebSocket();
      }, 3000);
    }

    function handleClose(event: CloseEvent) {
      if (socket.manualClose || event.code === 1000) {
        socket.manualClose = false;
        logger.debug("WebSocket closed intentionally", { code: event.code, reason: event.reason });
        return;
      }
      logger.warn("WebSocket closed unexpectedly", { code: event.code, reason: event.reason });
      scheduleReconnect();
    }

    function handleError() {
      if (socket.manualClose) {
        socket.manualClose = false;
        return;
      }
      logger.warn("WebSocket error occurred");
      scheduleReconnect();
    }

    function handleOpen() {
      logger.info("WebSocket connection established", { url: wsTarget });
    }

    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);
    socket.addEventListener("open", handleOpen);

    wsHandlersRef.current = {
      socket,
      closeHandler: handleClose,
      errorHandler: handleError,
    };
  }, [replaceValves, updateValve, t]);

  useEffect(() => {
    logger.info("Initializing valves WebSocket connection");
    connectWebSocket();

    return () => {
      logger.debug("Cleaning up valves WebSocket connection");
      if (reconnectTimeoutRef.current !== null) {
        globalThis.clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsHandlersRef.current) {
        const { socket, closeHandler, errorHandler } = wsHandlersRef.current;
        socket.manualClose = true;
        socket.removeEventListener("close", closeHandler);
        socket.removeEventListener("error", errorHandler);
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
          socket.close(1000, "unmount");
        } else if (socket.readyState === WebSocket.CONNECTING) {
          function closeOnOpen() {
            socket.removeEventListener("open", closeOnOpen);
            socket.close(1000, "unmount");
          }

          socket.addEventListener("open", closeOnOpen);
        } else {
          socket.close();
        }
      }
      wsHandlersRef.current = null;
      wsRef.current = null;
    };
  }, [connectWebSocket]);

  const previewValveValue = useCallback((entityId: string, value: number): void => {
    setValveMap((prev) => {
      const current = prev[entityId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [entityId]: {
          ...current,
          value,
          state: String(value),
        },
      };
    });
  }, []);

  const commitValveValue = useCallback(
    async (entityId: string, value: number): Promise<void> => {
      try {
        logger.info("Submitting valve value change", { entityId, value });
        const response = await fetch(resolveApiUrl(`/api/valves/${encodeURIComponent(entityId)}`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        });
        if (!response.ok) {
          const message = response.statusText || t("valves.errors.setValueUnknown");
          setError(t("valves.errors.setValue", { message }));
          logger.warn("Valve value update returned non-OK response", {
            entityId,
            status: response.status,
            statusText: response.statusText,
          });
          await fetchSnapshot();
          return;
        }
        setError(null);
        logger.info("Valve value update acknowledged", { entityId, value });
      } catch (requestError) {
        const message =
          requestError instanceof Error ? requestError.message : t("valves.errors.setValueUnknown");
        setError(t("valves.errors.setValue", { message }));
        logger.error("Valve value update failed", { entityId, value, error: requestError });
        await fetchSnapshot();
      }
    },
    [fetchSnapshot, t],
  );

  const handleCloseError = useCallback(() => setError(null), []);

  const handleBulkCommit = useCallback(
    async (groupId: number, value: number) => {
      try {
        await bulkSetValveGroupValue(groupId, value);
      } catch (bulkError) {
        logger.error("Bulk group value update failed", { groupId, value, error: bulkError });
        await fetchSnapshot();
      }
    },
    [fetchSnapshot],
  );

  const groupedEntityIds = useMemo(() => {
    return new Set(valveGroups.flatMap((group) => group.entityIds));
  }, [valveGroups]);

  const ungroupedValves = useMemo(() => {
    return valves.filter((valve) => !groupedEntityIds.has(valve.entityId));
  }, [valves, groupedEntityIds]);

  let valveGrid: ReactNode;
  if (loading || (valves.length === 0 && !gracePeriodExpired)) {
    valveGrid = (
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
        <Skeleton height={200} radius="md" />
        <Skeleton height={200} radius="md" />
        <Skeleton height={200} radius="md" />
      </SimpleGrid>
    );
  } else if (valves.length === 0) {
    valveGrid = (
      <Alert color="yellow" title={t("valves.warningTitle")}>
        {t("valves.empty")}
      </Alert>
    );
  } else {
    const sortedGroups = valveGroups.toSorted((a, b) => a.sortOrder - b.sortOrder);
    valveGrid = (
      <Stack gap="xl">
        {sortedGroups.map((group) => (
          <ValveGroupSection
            key={group.id}
            title={group.name}
            valves={valves.filter((valve) => group.entityIds.includes(valve.entityId))}
            onPreview={previewValveValue}
            onCommit={commitValveValue}
            onBulkCommit={(value) => handleBulkCommit(group.id, value)}
          />
        ))}
        <ValveGroupSection
          title={
            sortedGroups.length > 0
              ? t("valves.groups.ungrouped", { defaultValue: "Ungrouped" })
              : undefined
          }
          valves={ungroupedValves}
          onPreview={previewValveValue}
          onCommit={commitValveValue}
        />
      </Stack>
    );
  }

  return (
    <Container size="xl">
      <Stack gap="xl">
        <Stack gap={0}>
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <IconAdjustments size={32} color="var(--mantine-color-luftBlue-5)" />
              <Title order={1}>{t("valves.title")}</Title>
            </Group>
            <Group gap="xs">
              <Button
                variant="light"
                color="blue"
                onClick={() => setGroupManagerOpen(true)}
                leftSection={<IconFolders size={20} stroke={1.8} />}
                visibleFrom="sm"
              >
                {t("valves.groups.manage", { defaultValue: "Manage groups" })}
              </Button>
              <Tooltip label={t("valves.groups.manage", { defaultValue: "Manage groups" })}>
                <ActionIcon
                  variant="light"
                  color="blue"
                  onClick={() => setGroupManagerOpen(true)}
                  aria-label={t("valves.groups.manage", { defaultValue: "Manage groups" })}
                  size="lg"
                  hiddenFrom="sm"
                >
                  <IconFolders size={20} stroke={1.8} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("valves.refreshAria")}>
                <ActionIcon
                  variant="light"
                  color="blue"
                  onClick={fetchSnapshot}
                  aria-label={t("valves.refreshAria")}
                  size="lg"
                >
                  <IconRefresh size={20} stroke={1.8} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
          <Text size="lg" c="dimmed" mt="xs">
            {t("valves.description")}
          </Text>
        </Stack>

        {error ? (
          <Alert
            color="red"
            variant="light"
            title={t("valves.alertTitle")}
            withCloseButton
            onClose={handleCloseError}
          >
            {error}
          </Alert>
        ) : null}

        {haStatus === "offline" || haStatus === "disconnected" ? (
          <Alert
            color="orange"
            variant="filled"
            title={t("valves.warningTitle")}
            icon={<IconAlertCircle size={24} />}
            mb="md"
          >
            {t("valves.warnings.offlineMode")}
          </Alert>
        ) : null}

        {anyValveUnavailable ? (
          <Alert
            color="yellow"
            variant="light"
            title={t("valves.warningTitle")}
            icon={<IconAlertCircle size={24} />}
            mb="md"
          >
            {t("valves.warnings.unavailable")}
          </Alert>
        ) : null}

        {allValvesClosed && (
          <Alert
            color="orange"
            variant="filled"
            title={t("valves.warningTitle")}
            icon={<IconAlertCircle size={24} />}
            mb="md"
          >
            {t("valves.warnings.allClosed")}
          </Alert>
        )}

        {valveGrid}
      </Stack>

      <GroupManagerModal
        opened={groupManagerOpen}
        onClose={() => setGroupManagerOpen(false)}
        valves={valves}
        groups={valveGroups}
        onGroupsChanged={fetchGroups}
      />
    </Container>
  );
}
