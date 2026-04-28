import { useEffect, useState } from "react";
import { resolveApiUrl } from "../../../shared/utils/api";
import { createLogger } from "../../../shared/utils/logger";
import type { ModbusState } from "../types";

const logger = createLogger("useModbusProbe");

export function useModbusProbe(
  host: string | null,
  port: number | null,
  configLoaded: boolean,
): [ModbusState, (s: ModbusState) => void] {
  const [status, setStatus] = useState<ModbusState>("loading");

  useEffect(() => {
    if (!configLoaded || !host || !port) return;

    let active = true;
    const controller = new AbortController();

    async function probe() {
      try {
        const url = resolveApiUrl(
          `/api/modbus/status?host=${encodeURIComponent(host as string)}&port=${port}`,
        );
        const res = await fetch(url, { signal: controller.signal });
        if (!active) return;
        if (!res.ok) {
          setStatus("unreachable");
          return;
        }
        const data = ((await res.json().catch(() => null)) as { reachable?: boolean } | null) ?? {};
        const next: ModbusState = data.reachable ? "reachable" : "unreachable";
        setStatus(next);
        logger.debug("Modbus status probed", { status: next, host, port });
      } catch {
        if (active) setStatus("unreachable");
      }
    }
    void probe();
    const id = setInterval(probe, 30_000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(id);
    };
  }, [configLoaded, host, port]);

  return [status, setStatus];
}
