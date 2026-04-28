import { useQuery } from "@tanstack/react-query";
import { fetchActiveUnit } from "@luftuj/shared/api/hru";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("useActiveUnitQuery");

export function useActiveUnitQuery() {
  return useQuery({
    queryKey: ["active-unit"],
    queryFn: async () => {
      logger.debug("Fetching active unit");
      const result = await fetchActiveUnit();
      logger.info("Active unit loaded", { unitId: result.unitId });
      return result;
    },
    staleTime: 5 * 60 * 1000,
  });
}
