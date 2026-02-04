import { useEffect, useRef, useState } from "react";
import { resolveApiUrl, resolveWebSocketUrl } from "../utils/api";
import { logger } from "../utils/logger";

export type ConnectionState = "connected" | "connecting" | "disconnected" | "offline";
export type ModbusState = "loading" | "reachable" | "unreachable";
export type TemperatureUnit = "c" | "f";

export interface ActiveMode {
  source: "manual" | "schedule" | "boost";
  modeName?: string;
}

export interface RegisterInfo {
  unit?: string;
  scale?: number;
  precision?: number;
}

export type HruState =
  | {
      power: number;
      temperature: number;
      mode: string;
      maxPower?: number;
      powerUnit?: string;
      registers?: {
        power?: RegisterInfo;
        temperature?: RegisterInfo;
      };
    }
  | { error: string }
  | null;

export function useDashboardStatus() {
  const [haStatus, setHaStatus] = useState<ConnectionState>("offline");
  const [haLoading, setHaLoading] = useState(true);

  const [modbusHost, setModbusHost] = useState("localhost");
  const [modbusPort, setModbusPort] = useState(502);
  const [modbusStatus, setModbusStatus] = useState<ModbusState>("loading");

  const [hruName, setHruName] = useState<string | null>(null);
  const [hruStatus, setHruStatus] = useState<HruState>(null);

  const [mqttStatus, setMqttStatus] = useState<"connected" | "disconnected" | "loading">("loading");
  const [mqttLastDiscovery, setMqttLastDiscovery] = useState<string | null>(null);

  const [tempUnit, setTempUnit] = useState<TemperatureUnit>("c");
  const [activeMode, setActiveMode] = useState<ActiveMode | null>(null);

  const valvesWsRef = useRef<WebSocket | null>(null);
  const valvesReconnectRef = useRef<number | null>(null);
  const configRef = useRef({ maxPower: 100, powerUnit: "%" });

  // Load Modbus Settings and HRU Units
  useEffect(() => {
    const envHost = (import.meta.env.VITE_MODBUS_HOST as string | undefined) ?? undefined;
    const envPortRaw = import.meta.env.VITE_MODBUS_PORT as string | number | undefined;
    const envPort =
      typeof envPortRaw === "string"
        ? Number.parseInt(envPortRaw, 10)
        : (envPortRaw as number | undefined);

    setModbusHost(envHost ?? "localhost");
    setModbusPort(Number.isFinite(envPort) ? (envPort as number) : 502);

    let canceled = false;
    async function loadData() {
      try {
        const [settingsRes, unitsRes, tempUnitRes] = await Promise.all([
          fetch(resolveApiUrl("/api/settings/hru")),
          fetch(resolveApiUrl("/api/hru/units")),
          fetch(resolveApiUrl("/api/settings/temperature-unit")),
        ]);

        if (canceled) return;

        let unitId: string | null = null;
        let allUnits: Array<{ id: string; name: string; maxValue?: number; controlUnit?: string }> =
          [];

        if (settingsRes.ok) {
          const data = (await settingsRes.json()) as {
            host?: string;
            port?: number;
            unit?: string;
          };
          if (data.host) setModbusHost(data.host);
          if (Number.isFinite(data.port)) setModbusPort(data.port as number);
          if (data.unit) {
            unitId = data.unit;
          }
        }

        if (unitsRes.ok) {
          allUnits = (await unitsRes.json()) as Array<{
            id: string;
            name: string;
            maxValue?: number;
            controlUnit?: string;
          }>;
        }

        if (tempUnitRes.ok) {
          const { temperatureUnit } = (await tempUnitRes.json()) as {
            temperatureUnit: TemperatureUnit;
          };
          if (temperatureUnit === "c" || temperatureUnit === "f") {
            setTempUnit(temperatureUnit);
          }
        }

        const activeUnit = allUnits.find((u) => u.id === unitId) || allUnits[0];
        if (activeUnit) {
          configRef.current = {
            maxPower: activeUnit.maxValue ?? 100,
            powerUnit: activeUnit.controlUnit ?? "%",
          };
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
          }
        }
      } catch {
        logger.error("Failed to load data");
      }
    }
    void loadData();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch(resolveApiUrl("/api/status"));
        if (!res.ok) {
          setHaLoading(false);
          return;
        }
        const data = (await res.json()) as {
          ha?: { connection?: string };
          mqtt?: { connection?: "connected" | "disconnected"; lastDiscovery?: string | null };
          timeline?: ActiveMode | null;
        };
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
          setActiveMode(data.timeline);
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
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function probe() {
      try {
        const url = resolveApiUrl(
          `/api/modbus/status?host=${encodeURIComponent(modbusHost)}&port=${modbusPort}`,
        );
        const res = await fetch(url);
        if (!active) return;
        if (!res.ok) {
          setModbusStatus("unreachable");
          return;
        }
        const data = (await res.json()) as { reachable?: boolean };
        setModbusStatus(data.reachable ? "reachable" : "unreachable");
      } catch {
        if (!active) return;
        setModbusStatus("unreachable");
      }
    }
    void probe();
    const id = setInterval(probe, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [modbusHost, modbusPort]);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const res = await fetch(resolveApiUrl("/api/hru/read"));
        if (!active) return;
        if (!res.ok) {
          const detail = await res.text();
          setHruStatus({ error: detail || "Failed to read HRU" });
          return;
        }
        const data = (await res.json()) as {
          value?: { power: number; temperature: number; mode: string };
          registers?: {
            power?: { unit?: string; scale?: number; precision?: number };
            temperature?: { unit?: string; scale?: number; precision?: number };
          };
        };
        const val = data?.value;
        if (val) {
          setHruStatus({
            ...val,
            ...configRef.current,
            registers: data.registers,
          });
          setModbusStatus("reachable");
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
      const ws = new WebSocket(url);
      valvesWsRef.current = ws;
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
    tempUnit,
    activeMode,
  };
}
