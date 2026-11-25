import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { createLogger } from "@luftuj/shared/utils/logger";
import { isTemperatureUnit, type TemperatureUnit } from "@luftuj/shared/utils/temperature";

import { TemperatureContext } from "./temperatureContext";

const logger = createLogger("TemperatureUnitProvider");
/** The last known unit in this browser, so the first render does not flash °C before the backend answers. */
const STORAGE_KEY = "luftujha-temperature-unit";

function readStored(): TemperatureUnit {
  try {
    const saved = globalThis.localStorage.getItem(STORAGE_KEY);
    return isTemperatureUnit(saved) ? saved : "celsius";
  } catch {
    return "celsius";
  }
}

/**
 * The temperature unit for the whole app (Vzhled in Settings), kept on the backend like the language. Values stay
 * in °C everywhere else; components convert only for display and input via `useTemperature`.
 */
export function TemperatureUnitProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [unit, setUnitState] = useState<TemperatureUnit>(readStored);

  useEffect(() => {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, unit);
    } catch {
      // Storage unavailable; the unit still applies for this session.
    }
  }, [unit]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(resolveApiUrl("/api/settings/temperature-unit"));
        if (!response.ok) return;
        const data = (await response.json()) as { unit?: string };
        if (active && isTemperatureUnit(data.unit)) setUnitState(data.unit);
      } catch (error) {
        logger.error("Failed to load the temperature unit", { error });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const setUnit = useCallback((next: TemperatureUnit) => {
    setUnitState(next);
    void fetch(resolveApiUrl("/api/settings/temperature-unit"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit: next }),
    }).catch((error: unknown) => logger.error("Failed to save the temperature unit", { error }));
  }, []);

  const value = useMemo(() => ({ unit, setUnit }), [unit, setUnit]);
  return <TemperatureContext.Provider value={value}>{children}</TemperatureContext.Provider>;
}
