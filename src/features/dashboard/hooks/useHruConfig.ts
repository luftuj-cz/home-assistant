import { useEffect, useRef, useState } from "react";
import type { HruUnit } from "../../../shared/api/hru";
import { resolveApiUrl } from "../../../shared/utils/api";
import { createLogger } from "../../../shared/utils/logger";
import type { HruVariable } from "../types";

const logger = createLogger("useHruConfig");

interface HruConfigState {
  modbusHost: string | null;
  modbusPort: number | null;
  modbusConfigLoaded: boolean;
  hruName: string | null;
  configuredMaxPower: number | undefined;
  variables: HruVariable[];
}

export function useHruConfig(): HruConfigState {
  const [modbusHost, setModbusHost] = useState<string | null>(null);
  const [modbusPort, setModbusPort] = useState<number | null>(null);
  const [modbusConfigLoaded, setModbusConfigLoaded] = useState(false);
  const [hruName, setHruName] = useState<string | null>(null);
  const [configuredMaxPower, setConfiguredMaxPower] = useState<number | undefined>(undefined);
  const variablesRef = useRef<HruVariable[]>([]);

  useEffect(() => {
    const envHost = (import.meta.env.VITE_MODBUS_HOST as string | undefined) ?? undefined;
    const envPortRaw = import.meta.env.VITE_MODBUS_PORT as string | number | undefined;
    const envPort =
      typeof envPortRaw === "string"
        ? Number.parseInt(envPortRaw, 10)
        : (envPortRaw as number | undefined);

    let canceled = false;
    async function load() {
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
          if (data.unit) unitId = data.unit;
          if (Number.isFinite(data.maxPower)) setConfiguredMaxPower(data.maxPower as number);
        }

        setModbusHost(resolvedHost);
        setModbusPort(resolvedPort);
        setModbusConfigLoaded(true);

        if (unitsRes.ok) {
          allUnits = await unitsRes.json();
          const activeUnit = allUnits.find((u) => u.id === unitId) || allUnits[0];
          if (activeUnit) {
            setHruName(activeUnit.name);
            variablesRef.current = activeUnit.variables || [];
          }
        }

        logger.info("Dashboard HRU configuration loaded", {
          modbusHost: resolvedHost,
          modbusPort: resolvedPort,
          unitsCount: allUnits.length,
        });
      } catch (err) {
        if (!canceled) setModbusConfigLoaded(true);
        logger.error("Failed to load HRU configuration", { error: err });
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, []);

  return {
    modbusHost,
    modbusPort,
    modbusConfigLoaded,
    hruName,
    configuredMaxPower,
    variables: variablesRef.current,
  };
}
