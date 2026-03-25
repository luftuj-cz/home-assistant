import { useEffect, useState } from "react";
import * as hruApi from "../../../api/hru";
import * as valveApi from "../../../api/valves";
import type { Valve } from "../../../types/valve";
import { resolveApiUrl } from "../../../utils/api";
import { createLogger } from "../../../utils/logger";
import { calculatePowerConfig } from "../utils";

const logger = createLogger("useHruContext");

export function useHruContext(
  loadModes: (unitId?: string) => Promise<void>,
  loadEvents: (unitId?: string) => Promise<void>,
) {
  const [valves, setValves] = useState<Valve[]>([]);
  const [hruVariables, setHruVariables] = useState<hruApi.HruVariable[]>([]);
  const [powerUnit, setPowerUnit] = useState<string>("%");
  const [maxPower, setMaxPower] = useState<number>(100);
  const [activeUnitId, setActiveUnitId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const valves = await valveApi.fetchValves().catch(() => []);
        setValves(valves);

        const [settingsRes, units] = await Promise.all([
          fetch(resolveApiUrl("/api/settings/hru")),
          hruApi.fetchHruUnits().catch(() => []),
        ]);

        const settings: { unit?: string; maxPower?: number } = settingsRes.ok
          ? await settingsRes.json()
          : {};
        const activeUnit = units.find((u) => u.id === settings.unit) || units[0];
        const unitId = activeUnit?.id;
        setActiveUnitId(unitId);

        if (activeUnit) {
          setHruVariables(activeUnit.variables || []);
          const powerVar = activeUnit.variables.find((v) => v.class === "power");
          if (powerVar) {
            const { powerUnit, maxPower } = calculatePowerConfig(powerVar, settings.maxPower);
            setPowerUnit(powerUnit);
            setMaxPower(maxPower);
          }
        }

        await Promise.all([loadModes(unitId), loadEvents(unitId)]);
        logger.info("HRU context loaded successfully", { unitId });
      } catch (err) {
        logger.error("Failed to load HRU context", { error: err });
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, [loadModes, loadEvents]);

  return {
    valves,
    hruVariables,
    powerUnit,
    maxPower,
    activeUnitId,
    loading,
  };
}
