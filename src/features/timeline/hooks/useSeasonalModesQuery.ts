import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { fetchSeasonalModes, upsertSeasonalMode, deleteSeasonalMode } from "../api/seasonalModes";
import type { Season, SeasonalMode } from "@luftuj/shared/types/timeline";
import { translateApiError } from "@luftuj/shared/utils/apiError";

export function useSeasonalModesQuery(unitId: string | null) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["seasonal-modes", unitId],
    queryFn: () => fetchSeasonalModes(unitId),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (input: { season: Season; body: Omit<SeasonalMode, "season" | "hruId"> }) =>
      upsertSeasonalMode(input.season, unitId, input.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seasonal-modes", unitId] });
    },
    onError: (err) => {
      notifications.show({
        title: t("settings.timeline.seasons.saveFailed", { season: "" }),
        message: translateApiError(err, t),
        color: "red",
      });
    },
  });

  const remove = useMutation({
    mutationFn: (season: Season) => deleteSeasonalMode(season, unitId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seasonal-modes", unitId] });
    },
    onError: (err) => {
      notifications.show({
        title: t("settings.timeline.seasons.loadFailed"),
        message: translateApiError(err, t),
        color: "red",
      });
    },
  });

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    save,
    remove,
  };
}
