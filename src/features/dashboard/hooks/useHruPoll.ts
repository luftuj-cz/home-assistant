import { useEffect, useRef, useState } from "react";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { createLogger } from "@luftuj/shared/utils/logger";
import type { HruState, HruVariable, ModbusState } from "@luftuj/features/dashboard/types";

const logger = createLogger("useHruPoll");

export function useHruPoll(onModbusStatus?: (s: ModbusState) => void): HruState {
  const [hruStatus, setHruStatus] = useState<HruState>(null);
  const onModbusStatusRef = useRef(onModbusStatus);
  onModbusStatusRef.current = onModbusStatus;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function poll() {
      try {
        const res = await fetch(resolveApiUrl("/api/hru/read"), { signal: controller.signal });
        if (!active) return;
        if (!res.ok) {
          const detail = (await res.text())?.trim();
          setHruStatus({ error: detail || "Failed to read HRU" });
          return;
        }
        const data = (await res.json().catch(() => null)) as {
          values?: Record<string, number | string | boolean>;
          displayValues?: Record<string, string | number | boolean>;
          variables?: HruVariable[];
          registers?: {
            power?: { unit?: string; scale?: number; precision?: number };
            temperature?: { unit?: string; scale?: number; precision?: number };
          };
        } | null;

        if (data?.values && data.displayValues && data.variables) {
          setHruStatus({
            values: data.values,
            displayValues: data.displayValues,
            variables: data.variables,
            registers: data.registers,
          });
          onModbusStatusRef.current?.("reachable");
          logger.debug("HRU state updated", { variableCount: data.variables.length });
        } else {
          setHruStatus({ error: "Invalid HRU response" });
          onModbusStatusRef.current?.("unreachable");
        }
      } catch {
        if (!active) return;
        setHruStatus({ error: "Failed to read HRU" });
        onModbusStatusRef.current?.("unreachable");
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

  return hruStatus;
}
