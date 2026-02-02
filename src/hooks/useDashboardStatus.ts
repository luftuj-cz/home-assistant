import { useEffect, useRef, useState } from "react";
import { resolveApiUrl, resolveWebSocketUrl } from "../utils/api";

export type ConnectionState = "connected" | "connecting" | "disconnected" | "offline";
export type ModbusState = "loading" | "reachable" | "unreachable";

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

  const valvesWsRef = useRef<WebSocket | null>(null);
  const valvesReconnectRef = useRef<number | null>(null);

  // Load Modbus Settings and HRU Units
  useEffect(() => {
    const envHost = (import.meta.env.VITE_MODBUS_HOST as string | undefined) ?? undefined;
    const envPortRaw = import.meta.env.VITE_MODBUS_PORT as string | number | undefined;
    const envPort =
      typeof envPortRaw === "string"
        ? Number.parseInt(envPortRaw, 10)
        : (envPortRaw as number | undefined);

    setModbusHost(envHost ?? "localhost");
    setModbusPort(envPort ?? 502);

    let canceled = false;
    async function loadData() {
      try {
        const [settingsRes, unitsRes] = await Promise.all([
          fetch(resolveApiUrl("/api/settings/hru")),
          fetch(resolveApiUrl("/api/hru/units")),
        ]);

        if (canceled) return;

        let unitId: string | null = null;

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

        if (unitsRes.ok && unitId) {
          const units = (await unitsRes.json()) as Array<{ id: string; name: string }>;
          const found = units.find((u) => u.id === unitId);
          if (found) {
            setHruName(found.name);
          }
        }
      } catch {
        // ignore
      }
    }
    void loadData();
    return () => {
      canceled = true;
    };
  }, []);

  // Poll HA Status via REST (fallback)
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

  // Poll Modbus Reachability
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
    const id = setInterval(probe, 10000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [modbusHost, modbusPort]);

  // Poll HRU Live Values
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
        if (data?.value) {
          setHruStatus({
            ...data.value,
            registers: data.registers,
          });
        } else {
          setHruStatus({ error: "Invalid HRU response" });
        }
      } catch {
        if (!active) return;
        setHruStatus({ error: "Failed to read HRU" });
      }
    }
    void poll();
    const id = setInterval(poll, 10_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // WebSocket for real-time updates
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
          setHaLoading(false);
        }
      } catch {
        // ignore
      }
    }

    function onError() {
      // handled by close/reconnect
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
  };
}
