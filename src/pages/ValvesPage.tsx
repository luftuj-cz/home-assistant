import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Container,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconRefresh, IconAdjustments } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { ValveCard } from "../components";
import { resolveApiUrl, resolveWebSocketUrl } from "../utils/api";
import { logger } from "../utils/logger";
import type { HaState } from "../types/homeAssistant";
import type { Valve } from "../types/valve";

type ManagedWebSocket = WebSocket & { manualClose?: boolean };

function normaliseValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

  const formatValveValue = useCallback(
    (value: number) => {
      if (value === 0) return t("valves.status.open");
      if (value >= 90) return t("valves.status.closed");
      return `${90 - value}°`;
    },
    [t],
  );

  const valves = useMemo(() => {
    return Object.values(valveMap).sort((a, b) => a.name.localeCompare(b.name));
  }, [valveMap]);

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
    setValveMap(valvesFromStates(payload));
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

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

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
          updateValve(message.payload as HaState);
          logger.debug("Received websocket valve update", {
            entityId: (message.payload as HaState).entity_id,
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
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = window.setTimeout(() => {
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
    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
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

  return (
    <Container size="xl">
      <Stack gap="xl">
        <Stack gap={0}>
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <IconAdjustments size={32} color="var(--mantine-primary-color-5)" />
              <Title order={1}>{t("valves.title")}</Title>
            </Group>
            <ActionIcon
              variant="light"
              color="blue"
              onClick={fetchSnapshot}
              aria-label={t("valves.refreshAria")}
              size="lg"
            >
              <IconRefresh size={20} stroke={1.8} />
            </ActionIcon>
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

        {loading || (valves.length === 0 && !gracePeriodExpired) ? (
          <Group justify="center" align="center" h={240}>
            <Loader color="blue" size="lg" />
            {!loading && (
              <Text size="sm" c="dimmed" ml="md">
                {t("valves.waiting")}
              </Text>
            )}
          </Group>
        ) : valves.length === 0 ? (
          <Alert color="yellow" title={t("valves.warningTitle")}>
            {t("valves.empty")}
          </Alert>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
            {valves.map((valve) => (
              <ValveCard
                key={valve.entityId}
                valve={valve}
                formatValue={formatValveValue}
                onPreview={previewValveValue}
                onCommit={commitValveValue}
              />
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </Container>
  );
}
