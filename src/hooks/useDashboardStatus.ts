import type { HruUnit } from "../api/hru";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveApiUrl, resolveWebSocketUrl } from "../utils/api";
import { createLogger } from "../utils/logger";

const logger = createLogger("useDashboardStatus");

export type ConnectionState = "connected" | "connecting" | "disconnected" | "offline";
export type ModbusState = "loading" | "reachable" | "unreachable";

export interface ActiveMode {
  source: "manual" | "schedule" | "boost";
  modeName?: string;
}

export type LocalizedText = string | { text: string; translate: boolean };

export type VariableClass = "power" | "temperature" | "mode" | "other";

export interface HruVariable {
  name: string;
  type: "number" | "select" | "boolean";
  editable: boolean;
  onDashboard?: boolean;
  label: LocalizedText;
  unit?: LocalizedText;
  class?: VariableClass;
  min?: number;
  max?: number;
  step?: number;
  maxConfigurable?: boolean;
  options?: Array<{
    value: number;
    label: LocalizedText;
  }>;
}

export type HruState =
  | {
      values: Record<string, number | string | boolean>;
      displayValues: Record<string, string | number | boolean>;
      variables: HruVariable[];
      registers?: {
        power?: { unit?: string; scale?: number; precision?: number };
        temperature?: { unit?: string; scale?: number; precision?: number };
      };
    }
  | { error: string }
  | null;

export function useDashboardStatus() {
  const { t } = useTranslation();
  const [haStatus, setHaStatus] = useState<ConnectionState>("offline");
  const [haLoading, setHaLoading] = useState(true);

  const [modbusHost, setModbusHost] = useState<string | null>(null);
  const [modbusPort, setModbusPort] = useState<number | null>(null);
  const [modbusStatus, setModbusStatus] = useState<ModbusState>("loading");
  const [modbusConfigLoaded, setModbusConfigLoaded] = useState(false);

  const [hruName, setHruName] = useState<string | null>(null);
  const [hruStatus, setHruStatus] = useState<HruState>(null);
  const [configuredMaxPower, setConfiguredMaxPower] = useState<number | undefined>(undefined);

  const [mqttStatus, setMqttStatus] = useState<"connected" | "disconnected" | "loading">("loading");
  const [mqttLastDiscovery, setMqttLastDiscovery] = useState<string | null>(null);

  const [activeMode, setActiveMode] = useState<ActiveMode | null>(null);

  const valvesWsRef = useRef<WebSocket | null>(null);
  const valvesReconnectRef = useRef<number | null>(null);
  const configRef = useRef({
    variables: [] as HruVariable[],
  });

  // Load Modbus Settings and HRU Units
  useEffect(() => {
    const envHost = (import.meta.env.VITE_MODBUS_HOST as string | undefined) ?? undefined;
    const envPortRaw = import.meta.env.VITE_MODBUS_PORT as string | number | undefined;
    const envPort =
      typeof envPortRaw === "string"
        ? Number.parseInt(envPortRaw, 10)
        : (envPortRaw as number | undefined);

    let canceled = false;
    async function loadData() {
      try {
        const [settingsRes, unitsRes] = await Promise.all([
          fetch(resolveApiUrl("/api/settings/hru")),
          fetch(resolveApiUrl("/api/hru/units")),
        ]);

        if (canceled) return;

        let unitId: string | null = null;
        let allUnits: HruUnit[] = [];
        let resolvedHost = envHost ?? null;
        let resolvedPort = Number.isFinite(envPort) ? (envPort as number) : null;

        if (settingsRes.ok) {
          const data = (await settingsRes.json()) as {
            host?: string;
            port?: number;
            unit?: string;
            maxPower?: number;
          };
          if (data.host) resolvedHost = data.host;
          if (Number.isFinite(data.port)) resolvedPort = data.port as number;
          if (data.unit) {
            unitId = data.unit;
          }
          if (Number.isFinite(data.maxPower)) {
            setConfiguredMaxPower(data.maxPower as number);
          }
        }

        setModbusHost(resolvedHost);
        setModbusPort(resolvedPort);
        setModbusConfigLoaded(true);

        if (unitsRes.ok) {
          allUnits = await unitsRes.json();
          const activeUnit = allUnits.find((u) => u.id === unitId) || allUnits[0];
          if (activeUnit) {
            setHruName(activeUnit.name);
            configRef.current = {
              variables: activeUnit.variables || [],
            };
          }
        }

        setHruStatus((prev) => {
          if (!prev || !("power" in prev)) return prev;
          return {
            ...prev,
            ...configRef.current,
          };
        });

        if (unitId) {
          const found = allUnits.find((u) => u.id === unitId);
          if (found) {
            setHruName(found.name);
            logger.info("HRU unit loaded", { unitId, unitName: found.name });
          }
        }
        logger.info("Dashboard configuration loaded", {
          modbusHost: resolvedHost,
          modbusPort: resolvedPort,
          unitsCount: allUnits.length,
        });
      } catch (err) {
        if (!canceled) {
          setModbusConfigLoaded(true);
        }
        logger.error("Failed to load data", { error: err });
      }
    }
    void loadData();
    return () => {
      canceled = true;
    };
  }, [t]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function safeJson<T>(res: Response): Promise<T | null> {
      try {
        return (await res.json()) as T;
      } catch {
        return null;
      }
    }

    async function load() {
      try {
        const res = await fetch(resolveApiUrl("/api/status"), { signal: controller.signal });
        if (!res.ok) {
          setHaLoading(false);
          return;
        }
        const data = (await safeJson<{
          ha?: { connection?: string };
          mqtt?: { connection?: "connected" | "disconnected"; lastDiscovery?: string | null };
          timeline?: ActiveMode | null;
        }>(res)) || {};
        if (!active) return;
        const s = data.ha?.connection;
        if (s === "connected" || s === "connecting" || s === "disconnected" || s === "offline") {
          setHaStatus(s);
          logger.debug("HA status updated", { status: s });
        }
        if (data.mqtt) {
          const mqttConn = data.mqtt.connection ?? "disconnected";
          setMqttStatus(mqttConn);
          setMqttLastDiscovery(data.mqtt.lastDiscovery ?? null);
          logger.debug("MQTT status updated", { status: mqttConn, lastDiscovery: data.mqtt.lastDiscovery });
        }
        if (data.timeline !== undefined) {
          const translated = data.timeline?.modeName
            ? { ...data.timeline, modeName: t(data.timeline.modeName, { defaultValue: data.timeline.modeName }) }
            : data.timeline;
          setActiveMode(translated);
          logger.debug("Active mode updated", { mode: translated });
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
    if (!modbusConfigLoaded || !modbusHost || !modbusPort) {
      return;
    }

    const currentModbusHost = modbusHost;
    const currentModbusPort = modbusPort;

    let active = true;
    const controller = new AbortController();

    async function safeJson<T>(res: Response): Promise<T | null> {
      try {
        return (await res.json()) as T;
      } catch {
        return null;
      }
    }

    async function probe() {
      try {
        const url = resolveApiUrl(
          `/api/modbus/status?host=${encodeURIComponent(currentModbusHost)}&port=${currentModbusPort}`,
        );
        const res = await fetch(url, { signal: controller.signal });
        if (!active) return;
        if (!res.ok) {
          setModbusStatus("unreachable");
          return;
        }
        const data = (await safeJson<{ reachable?: boolean }>(res)) || {};
        const status = data.reachable ? "reachable" : "unreachable";
        setModbusStatus(status);
        logger.debug("Modbus status probed", { status, host: currentModbusHost, port: currentModbusPort });
      } catch {
        if (!active) return;
        setModbusStatus("unreachable");
      }
    }
    void probe();
    const id = setInterval(probe, 30_000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(id);
    };
  }, [modbusConfigLoaded, modbusHost, modbusPort]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function safeJson<T>(res: Response): Promise<T | null> {
      try {
        return (await res.json()) as T;
      } catch {
        return null;
      }
    }

    async function poll() {
      try {
        const res = await fetch(resolveApiUrl("/api/hru/read"), { signal: controller.signal });
        if (!active) return;
        if (!res.ok) {
          const detail = (await res.text())?.trim();
          setHruStatus({ error: detail || "Failed to read HRU" });
          return;
        }
        const data = await safeJson<{
          values?: Record<string, number | string | boolean>;
          displayValues?: Record<string, string | number | boolean>;
          variables?: HruVariable[];
          registers?: {
            power?: { unit?: string; scale?: number; precision?: number };
            temperature?: { unit?: string; scale?: number; precision?: number };
          };
        }>(res);

        if (data?.values && data.displayValues && data.variables) {
          setHruStatus({
            values: data.values,
            displayValues: data.displayValues,
            variables: data.variables,
            registers: data.registers,
          });
          setModbusStatus("reachable");
          logger.debug("HRU state updated", { variableCount: data.variables.length });
        } else {
          setHruStatus({ error: "Invalid HRU response" });
          setModbusStatus("unreachable");
        }
      } catch {
        if (!active) return;
        setHruStatus({ error: "Failed to read HRU" });
        setModbusStatus("unreachable");
      }
    }
    void poll();
    const id = setInterval(poll, 10_000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let stopped = false;

    function cleanupSocket() {
      if (valvesWsRef.current) {
        const ws = valvesWsRef.current;
        valvesWsRef.current = null;
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
      if (valvesReconnectRef.current !== null) {
        window.clearTimeout(valvesReconnectRef.current);
        valvesReconnectRef.current = null;
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
            logger.debug("HA status updated via WebSocket", { status: s });
          }
          const m = msg?.payload?.mqtt?.connection;
          if (m === "connected" || m === "disconnected") {
            setMqttStatus(m);
            logger.debug("MQTT status updated via WebSocket", { status: m });
          }
          if (msg?.payload?.timeline !== undefined) {
            setActiveMode(msg.payload.timeline);
            logger.debug("Active mode updated via WebSocket", { mode: msg.payload.timeline });
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
      if (stopped) return;
      if (valvesReconnectRef.current !== null) return;
      valvesReconnectRef.current = window.setTimeout(() => {
        valvesReconnectRef.current = null;
        connect();
      }, 2000);
    }

    function connect() {
      cleanupSocket();
      const url = resolveWebSocketUrl("/ws/valves");
      logger.debug("Connecting to status WebSocket", { url });
      const ws = new WebSocket(url);
      valvesWsRef.current = ws;
      ws.addEventListener("open", () => logger.info("Status WebSocket connected"));
      ws.addEventListener("message", onMessage);
      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
    }

    connect();

    return () => {
      stopped = true;
      cleanupSocket();
    };
  }, []);

  return {
    haStatus,
    haLoading,
    modbusStatus,
    hruStatus,
    hruName,
    mqttStatus,
    mqttLastDiscovery,
    activeMode,
    configuredMaxPower,
  };
}
