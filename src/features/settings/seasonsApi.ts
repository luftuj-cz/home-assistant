import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseApiError } from "@luftuj/shared/utils/apiError";
import type {
  DisableImpactResponse,
  Season,
  SeasonKey,
  SeasonsResponse,
} from "@luftuj/shared/types/season";

export async function fetchSeasons(): Promise<SeasonsResponse> {
  const res = await fetch(resolveApiUrl("/api/seasons"));
  if (!res.ok) throw await parseApiError(res);
  return (await res.json()) as SeasonsResponse;
}

/**
 * Enable or disable a single season, or move the day it begins on. The backend
 * rejects a change that would leave no season enabled, or two seasons sharing a
 * start day.
 */
export async function updateSeason(
  key: SeasonKey,
  patch: { enabled?: boolean; spanStart?: string },
): Promise<Season[]> {
  const res = await fetch(resolveApiUrl(`/api/seasons/${key}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await parseApiError(res);
  const data = (await res.json()) as { seasons: Season[] };
  return data.seasons;
}

export async function enableSeasons(cloneCurrent: boolean): Promise<Season[]> {
  const res = await fetch(resolveApiUrl("/api/seasons/enable"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cloneCurrent }),
  });
  if (!res.ok) throw await parseApiError(res);
  const data = (await res.json()) as { seasons: Season[] };
  return data.seasons;
}

/** What turning the feature off would delete, per season. Read-only. */
export async function fetchDisableImpact(keepSeasonKey: SeasonKey): Promise<DisableImpactResponse> {
  const res = await fetch(
    resolveApiUrl(`/api/seasons/disable-impact?keepSeasonKey=${encodeURIComponent(keepSeasonKey)}`),
  );
  if (!res.ok) throw await parseApiError(res);
  return (await res.json()) as DisableImpactResponse;
}

export async function disableSeasons(keepSeasonKey: SeasonKey): Promise<Season[]> {
  const res = await fetch(resolveApiUrl("/api/seasons/disable"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keepSeasonKey }),
  });
  if (!res.ok) throw await parseApiError(res);
  const data = (await res.json()) as { seasons: Season[] };
  return data.seasons;
}
