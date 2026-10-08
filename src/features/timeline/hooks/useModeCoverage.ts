import { useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import type { SeasonSummary } from "@luftuj/shared/types/season";
import type { Mode } from "@luftuj/shared/types/timeline";
import { fetchTimelineModes } from "@luftuj/features/timeline/api";

/**
 * Module-level so its identity is stable: `useQueries` memoises the combined
 * value only for a stable `combine`, and returns a fresh array on every render
 * without one - which made everything memoised on it recompute per render.
 */
function toModeLists(results: UseQueryResult<Mode[]>[]): (Mode[] | undefined)[] {
  return results.map((result) => result.data);
}

/**
 * In which enabled seasons each mode has no values. A custom timeline borrows
 * its values from whichever season is running, so a mode is usable there only
 * when every enabled season can supply them - the rule the backend enforces.
 */
export function useModeCoverage(
  unitId: string | undefined,
  seasons: SeasonSummary[],
  enabled: boolean,
) {
  const modeLists = useQueries({
    queries: seasons.map((season) => ({
      queryKey: ["timeline-modes", unitId, season.id],
      queryFn: () => fetchTimelineModes(unitId, season.id),
      enabled,
      staleTime: 30 * 1000,
    })),
    combine: toModeLists,
  });

  return useMemo(() => {
    const missing = new Map<number, SeasonSummary[]>();
    modeLists.forEach((modes, index) => {
      const season = seasons[index];
      if (!season) return;
      for (const mode of modes ?? []) {
        if (mode.configured !== false) continue;
        missing.set(mode.id, [...(missing.get(mode.id) ?? []), season]);
      }
    });
    return {
      /** Enabled seasons in which the mode has no values. */
      missingSeasons: (modeId: number) => missing.get(modeId) ?? [],
      isCovered: (modeId: number) => !missing.has(modeId),
    };
  }, [modeLists, seasons]);
}
