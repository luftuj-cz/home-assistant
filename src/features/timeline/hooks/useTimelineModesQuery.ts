import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import type { Mode } from "@luftuj/shared/types/timeline";
import * as api from "@luftuj/features/timeline/api";
import { mapModeForUi } from "@luftuj/features/timeline/utils";
import { createLogger } from "@luftuj/shared/utils/logger";
import { translateApiError, ApiResponseError } from "@luftuj/shared/utils/apiError";

const logger = createLogger("useTimelineModesQuery");

export function useTimelineModesQuery(unitId?: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["timeline-modes", unitId],
    queryFn: async () => {
      logger.debug("Fetching timeline modes", { unitId });
      const data = await api.fetchTimelineModes(unitId);
      logger.info("Timeline modes loaded", { count: data.length, unitId });
      return data.map(mapModeForUi);
    },
    staleTime: 30 * 1000,
  });

  const saveModeMutation = useMutation({
    mutationFn: async (mode: Partial<Mode>) => {
      const isEdit = typeof mode.id === "number";
      if (isEdit) {
        return api.updateTimelineMode(mode as Mode);
      }
      return api.createTimelineMode(mode as Omit<Mode, "id">);
    },
    onSuccess: (saved, variables) => {
      const mappedSaved = mapModeForUi(saved);
      const isEdit = typeof variables.id === "number";
      queryClient.setQueryData<Mode[]>(["timeline-modes", unitId], (prev) => {
        if (!prev) return [mappedSaved];
        if (isEdit) {
          logger.info("Timeline mode updated", { id: mappedSaved.id, name: mappedSaved.name });
          return prev.map((m) => (m.id === mappedSaved.id ? mappedSaved : m));
        }
        logger.info("Timeline mode created", { id: mappedSaved.id, name: mappedSaved.name });
        return [...prev, mappedSaved];
      });
      notifications.show({
        title: t("settings.timeline.notifications.saveSuccessTitle"),
        message: t(
          isEdit
            ? "settings.timeline.notifications.modeUpdated"
            : "settings.timeline.notifications.modeCreated",
        ),
        color: "green",
      });
    },
    onError: (err, mode) => {
      logger.error("Failed to save timeline mode", {
        error: err,
        modeId: mode.id,
        name: mode.name,
      });
      notifications.show({
        title: t("settings.timeline.notifications.saveFailedTitle"),
        message: translateApiError(err, t),
        color: "red",
      });
    },
  });

  const deleteModeMutation = useMutation({
    mutationFn: (id: number) => api.deleteTimelineMode(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Mode[]>(["timeline-modes", unitId], (prev) =>
        prev ? prev.filter((m) => m.id !== id) : [],
      );
      logger.info("Timeline mode deleted", { id });
      notifications.show({
        title: t("settings.timeline.notifications.modeDeleteSuccessTitle"),
        message: t("settings.timeline.notifications.modeDeleteSuccessMessage"),
        color: "green",
      });
    },
    onError: (err, id) => {
      logger.error("Failed to delete timeline mode", { error: err, id });
      notifications.show({
        title: t("settings.timeline.notifications.deleteFailedTitle"),
        message: translateApiError(err, t),
        color: "red",
      });
    },
  });

  const saveMode = async (mode: Partial<Mode>): Promise<boolean> => {
    try {
      await saveModeMutation.mutateAsync(mode);
      return true;
    } catch (err) {
      if (err instanceof ApiResponseError && err.code === "DUPLICATE_MODE_NAME") {
        throw new Error("DUPLICATE_NAME");
      }
      return false;
    }
  };

  const deleteMode = async (id: number): Promise<boolean> => {
    try {
      await deleteModeMutation.mutateAsync(id);
      return true;
    } catch {
      return false;
    }
  };

  return {
    modes: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    saveMode,
    deleteMode,
    isMutating: saveModeMutation.isPending || deleteModeMutation.isPending,
  };
}
