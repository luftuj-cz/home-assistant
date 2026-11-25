import { useCallback, useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchValveGroups, updateValveGroup } from "@luftuj/features/valves/api";
import type { ValveGroup } from "@luftuj/shared/types/valve";
import { notify } from "@luftuj/shared/ui/notify";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("useValveGroups");

/** Valve groups in their saved order, a refetch, and saving a new order (from the page or the group manager). */
export function useValveGroups() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<ValveGroup[]>([]);

  const refetch = useCallback(async () => {
    try {
      const loaded = await fetchValveGroups();
      setGroups(loaded.toSorted((a, b) => a.sortOrder - b.sortOrder));
    } catch (error) {
      logger.error("Failed to fetch valve groups", { error });
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Quick ↑ ↓ moves start a second save before the first has refetched. Saves therefore run one at a time, and each
  // compares against the order last sent (not the fetched sortOrder, which may be stale), so none is skipped.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const sent = useRef(new Map<number, number>());
  const inFlight = useRef(0);

  const saveOrder = useCallback(
    (reordered: ValveGroup[]) => {
      inFlight.current += 1;
      async function persist() {
        try {
          await Promise.all(
            reordered.map((group, index) => {
              const known = sent.current.get(group.id) ?? group.sortOrder;
              if (index === known) return Promise.resolve();
              sent.current.set(group.id, index);
              return updateValveGroup(group.id, { name: group.name, sortOrder: index });
            }),
          );
          await refetch();
        } catch (error) {
          logger.error("Failed to persist valve group order", { error });
          // What the server kept is unknown now; compare with the next fetch instead.
          sent.current.clear();
          notify({
            variant: "error",
            title: t("valves.groups.reorderFailedTitle"),
            message: t("valves.groups.reorderFailedMessage"),
          });
        } finally {
          inFlight.current -= 1;
          // Once nothing is pending the fetched sortOrder is current again (another client may change it later).
          if (inFlight.current === 0) sent.current.clear();
        }
      }
      const run = queue.current.then(persist);
      queue.current = run;
      return run;
    },
    [refetch, t],
  );

  return { groups, refetch, saveOrder };
}
