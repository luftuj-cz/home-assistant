import { useQuery } from "@tanstack/react-query";

import { fetchCustomTimelines } from "@luftuj/features/timeline/customTimelinesApi";

/** Custom timelines and the running or scheduled override, refreshed every 30 s. Shared cache with the timeline. */
export function useCustomPlans(unitId: string | undefined) {
  return useQuery({
    queryKey: ["custom-timelines", unitId ?? "current"],
    queryFn: () => fetchCustomTimelines(unitId),
    refetchInterval: 30_000,
  });
}
