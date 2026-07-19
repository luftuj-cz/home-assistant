import { useQuery } from "@tanstack/react-query";
import * as api from "@luftuj/features/timeline/api";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("useHaScriptsQuery");

export function useHaScriptsQuery() {
  return useQuery({
    queryKey: ["ha-scripts"],
    queryFn: async () => {
      logger.debug("Fetching Home Assistant scripts");
      const scripts = await api.getHaScripts();
      logger.info("Home Assistant scripts loaded", { count: scripts.length });
      return scripts;
    },
    // listScripts() pulls the full /api/states snapshot; cache it aggressively so
    // reopening the mode editor reuses it instead of refetching every time.
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
