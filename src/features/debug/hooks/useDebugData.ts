import { useQuery } from "@tanstack/react-query";

import type { DebugPayload, ServerLogEntry } from "@luftuj/features/debug/utils";
import { resolveApiUrl } from "@luftuj/shared/utils/api";

/** How often the values and the log refresh, as before the redesign. */
export const DEBUG_POLL_MS = 5000;

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(resolveApiUrl(path), { cache: "no-cache" });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** The backend's own snapshot (`/api/debug`): the stat strip and the Inspector's Backend source share it. */
export function useBackendSnapshot() {
  return useQuery({
    queryKey: ["debug", "backend"],
    queryFn: () => getJson<DebugPayload>("/api/debug"),
    refetchInterval: DEBUG_POLL_MS,
  });
}

/** What Home Assistant's API reports; only polled while that source is on screen. */
export function useHomeAssistantSnapshot(enabled: boolean) {
  return useQuery({
    queryKey: ["debug", "home-assistant"],
    queryFn: () => getJson<DebugPayload>("/api/debug/home-assistant"),
    refetchInterval: enabled ? DEBUG_POLL_MS : false,
    enabled,
  });
}

export interface ServerLogs {
  logs: ServerLogEntry[];
  bufferedCount: number;
}

/**
 * The last 500 server log lines. Keeps polling while LogStream is paused, so the pause pill can count what arrived;
 * the list itself stays frozen.
 */
export function useServerLogs() {
  return useQuery({
    queryKey: ["debug", "logs"],
    queryFn: async (): Promise<ServerLogs> => {
      const payload = await getJson<{ logs?: ServerLogEntry[]; bufferedCount?: number }>(
        "/api/debug/logs?limit=500",
      );
      return {
        logs: Array.isArray(payload.logs) ? payload.logs : [],
        bufferedCount: Number.isFinite(payload.bufferedCount)
          ? (payload.bufferedCount as number)
          : 0,
      };
    },
    refetchInterval: DEBUG_POLL_MS,
  });
}
