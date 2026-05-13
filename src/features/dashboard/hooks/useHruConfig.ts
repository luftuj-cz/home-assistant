import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@luftuj/shared/api/client";
import { createLogger } from "@luftuj/shared/utils/logger";
import type { HruUnit } from "@luftuj/shared/api/hru";
import type { HruVariable } from "@luftuj/features/dashboard/types";

const logger = createLogger("useHruConfig");

interface HruSettings {
  host?: string;
  port?: number;
  unit?: string;
  maxPower?: number;
}

interface HruConfigState {
  modbusHost: string | null;
  modbusPort: number | null;
  modbusConfigLoaded: boolean;
  hruName: string | null;
  configuredMaxPower: number | undefined;
  variables: HruVariable[];
  unitId: string | undefined;
}

export function useHruConfig(): HruConfigState {
  const envHost = (import.meta.env.VITE_MODBUS_HOST as string | undefined) ?? undefined;
  const envPortRaw = import.meta.env.VITE_MODBUS_PORT as string | number | undefined;
  const envPort =
    typeof envPortRaw === "string"
      ? Number.parseInt(envPortRaw, 10)
      : (envPortRaw as number | undefined);

  const query = useQuery({
    queryKey: ["hru-config"],
    queryFn: async () => {
      const [settings, allUnits] = await Promise.all([
        apiClient.get<HruSettings>("/api/settings/hru").catch((): HruSettings => ({})),
        apiClient.get<HruUnit[]>("/api/hru/units").catch((): HruUnit[] => []),
      ]);

      const resolvedHost = settings.host ?? envHost ?? null;
      const resolvedPort =
        settings.port !== undefined && Number.isFinite(settings.port)
          ? settings.port
          : Number.isFinite(envPort)
            ? (envPort as number)
            : null;
      const activeUnit = allUnits.find((u) => u.id === settings.unit) || allUnits[0];

      logger.info("Dashboard HRU configuration loaded", {
        modbusHost: resolvedHost,
        modbusPort: resolvedPort,
        unitsCount: allUnits.length,
      });

      return {
        modbusHost: resolvedHost,
        modbusPort: resolvedPort,
        hruName: activeUnit?.name ?? null,
        configuredMaxPower:
          settings.maxPower !== undefined && Number.isFinite(settings.maxPower)
            ? settings.maxPower
            : undefined,
        variables: (activeUnit?.variables ?? []) as HruVariable[],
        unitId: activeUnit?.id,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  return {
    modbusHost: query.data?.modbusHost ?? null,
    modbusPort: query.data?.modbusPort ?? null,
    modbusConfigLoaded: !query.isPending,
    hruName: query.data?.hruName ?? null,
    configuredMaxPower: query.data?.configuredMaxPower,
    variables: query.data?.variables ?? [],
    unitId: query.data?.unitId,
  };
}
