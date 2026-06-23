import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseApiError } from "@luftuj/shared/utils/apiError";
import type { Season, SeasonalMode } from "@luftuj/shared/types/timeline";

function seasonalModesUrl(path = "", hruId: string | null): string {
  const params = new URLSearchParams();
  if (hruId) params.set("hruId", hruId);
  const query = params.toString();
  return resolveApiUrl(`/api/timeline/seasonal-modes${path}${query ? `?${query}` : ""}`);
}

export async function fetchSeasonalModes(hruId: string | null): Promise<SeasonalMode[]> {
  const url = seasonalModesUrl("", hruId);
  const res = await fetch(url);
  if (!res.ok) throw await parseApiError(res);
  return res.json();
}

export async function upsertSeasonalMode(
  season: Season,
  hruId: string | null,
  body: Omit<SeasonalMode, "season" | "hruId">,
): Promise<SeasonalMode> {
  const url = seasonalModesUrl(`/${season}`, hruId);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res);
  return res.json();
}

export async function deleteSeasonalMode(season: Season, hruId: string | null): Promise<void> {
  const url = seasonalModesUrl(`/${season}`, hruId);
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw await parseApiError(res);
}
