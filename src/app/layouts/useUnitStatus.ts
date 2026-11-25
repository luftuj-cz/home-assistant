import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useHruConfig } from "@luftuj/features/dashboard/hooks/useHruConfig";
import { resolveApiUrl } from "@luftuj/shared/utils/api";

const POLL_MS = 10_000;
/** Older than three polls: the data is stale. */
const STALE_AFTER_S = 30;

interface HruRead {
  fetchedAt: number | null;
  failing: boolean;
}

export interface UnitStatus {
  name: string;
  /** Seconds since the last fresh read, counted on this device (no clock skew with the backend). */
  ageSeconds: number | null;
  status: "ok" | "warning" | "error";
}

/**
 * The unit chip in the header: the HRU's name and how old its data is. Reads the backend's cached HRU state
 * (`/api/hru/read`, cheap) every 10 s, only while `enabled`.
 */
export function useUnitStatus(enabled: boolean): UnitStatus | null {
  const { hruName } = useHruConfig();
  const read = useQuery({
    queryKey: ["shell-hru-read"],
    enabled,
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<HruRead> => {
      const res = await fetch(resolveApiUrl("/api/hru/read"));
      if (!res.ok) {
        return { fetchedAt: null, failing: true };
      }
      const data = (await res.json().catch(() => null)) as {
        fetchedAt?: number | null;
        readError?: unknown;
      } | null;
      return {
        fetchedAt: data?.fetchedAt ?? null,
        failing: Boolean(data?.readError) && data?.fetchedAt == null,
      };
    },
  });

  const fetchedAt = read.data?.fetchedAt ?? null;
  const [ageSeconds, setAgeSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (fetchedAt === null) {
      setAgeSeconds(null);
      return;
    }
    setAgeSeconds(0);
    const id = setInterval(() => setAgeSeconds((s) => (s ?? 0) + 1), 1000);
    return () => clearInterval(id);
  }, [fetchedAt]);

  if (!enabled || !hruName) {
    return null;
  }
  const failing = read.isError || read.data?.failing === true;
  let status: UnitStatus["status"] = "ok";
  if (failing) {
    status = "error";
  } else if (ageSeconds !== null && ageSeconds > STALE_AFTER_S) {
    status = "warning";
  }
  return { name: hruName, ageSeconds, status };
}
