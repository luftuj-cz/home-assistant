import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveApiUrl, resolveWebSocketUrl } from "../../../shared/utils/api";
import { createLogger } from "../../../shared/utils/logger";
import type { ActiveMode, ConnectionState, MqttState } from "../types";

const logger = createLogger("useSystemStatus");

interface SystemStatus {
  haStatus: ConnectionState;
  haLoading: boolean;
  mqttStatus: MqttState;
  mqttLastDiscovery: string | null;
  activeMode: ActiveMode | null;
}

export function useSystemStatus(): SystemStatus {
  const { t } = useTranslation();
  const [haStatus, setHaStatus] = useState<ConnectionState>("offline");
  const [haLoading, setHaLoading] = useState(true);
  const [mqttStatus, setMqttStatus] = useState<MqttState>("loading");
  const [mqttLastDiscovery, setMqttLastDiscovery] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<ActiveMode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function load() {
      try {
        const res = await fetch(resolveApiUrl("/api/status"), { signal: controller.signal });
        if (!res.ok) {
          setHaLoading(false);
          return;
        }
        const data = ((await res.json().catch(() => null)) as {
          ha?: { connection?: string };
          mqtt?: { connection?: "connected" | "disconnected"; lastDiscovery?: string | null };
          timeline?: ActiveMode | null;
        } | null) ?? {};
        if (!active) return;
        const s = data.ha?.connection;
        if (s === "connected" || s === "connecting" || s === "disconnected" || s === "offline") {
          setHaStatus(s);
        }
        if (data.mqtt) {
          setMqttStatus(data.mqtt.connection ?? "disconnected");
          setMqttLastDiscovery(data.mqtt.lastDiscovery ?? null);
        }
        if (data.timeline !== undefined) {
          const translated = data.timeline?.modeName
            ? {
                ...data.timeline,
                modeName: t(data.timeline.modeName, { defaultValue: data.timeline.modeName }),
              }
            : data.timeline;
          setActiveMode(translated);
        }
        setHaLoading(false);
      } catch {
        setHaLoading(false);
      }
    }
    void load();
    const id = setInterval(load, 5000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(id);
    };
  }, [t]);

  useEffect(() => {
    let stopped = false;

    function cleanup() {
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("error", onError);
        ws.removeEventListener("close", onClose);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "cleanup");
        } else if (ws.readyState === WebSocket.CONNECTING) {
          function closer() {
            ws.removeEventListener("open", closer);
            ws.close(1000, "cleanup");
          }
          ws.addEventListener("open", closer);
        }
      }
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    }

    function onMessage(ev: MessageEvent) {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type?: string;
          payload?: {
            ha?: { connection?: string };
            mqtt?: { connection?: "connected" | "disconnected" };
            timeline?: ActiveMode | null;
          };
        };
        if (msg?.type === "status") {
          const s = msg?.payload?.ha?.connection;
          if (s === "connected" || s === "connecting" || s === "disconnected" || s === "offline") {
            setHaStatus(s);
          }
          const m = msg?.payload?.mqtt?.connection;
          if (m === "connected" || m === "disconnected") {
            setMqttStatus(m);
          }
          if (msg?.payload?.timeline !== undefined) {
            setActiveMode(msg.payload.timeline);
          }
          setHaLoading(false);
        }
      } catch {
        logger.error("Failed to parse WebSocket message", ev.data);
      }
    }

    function onError() {
      logger.error("WebSocket error");
    }

    function onClose() {
      if (stopped || reconnectRef.current !== null) return;
      reconnectRef.current = window.setTimeout(() => {
        reconnectRef.current = null;
        connect();
      }, 2000);
    }

    function connect() {
      cleanup();
      const url = resolveWebSocketUrl("/ws/valves");
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.addEventListener("open", () => logger.info("Status WebSocket connected"));
      ws.addEventListener("message", onMessage);
      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
    }

    connect();

    return () => {
      stopped = true;
      cleanup();
    };
  }, []);

  return { haStatus, haLoading, mqttStatus, mqttLastDiscovery, activeMode };
}
