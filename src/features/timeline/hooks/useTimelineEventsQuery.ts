import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import type { TimelineEvent, Mode } from "@luftuj/shared/types/timeline";
import * as api from "@luftuj/features/timeline/api";
import { createLogger } from "@luftuj/shared/utils/logger";
import { translateApiError } from "@luftuj/shared/utils/apiError";

const logger = createLogger("useTimelineEventsQuery");

export function useTimelineEventsQuery(modes: Mode[], activeUnitId?: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["timeline-events", activeUnitId],
    queryFn: async () => {
      logger.debug("Fetching timeline events", { activeUnitId });
      const loaded = await api.fetchTimelineEvents(activeUnitId);
      logger.info("Timeline events loaded", { count: loaded.length, activeUnitId });
      return loaded;
    },
    staleTime: 30 * 1000,
  });

  const saveEventMutation = useMutation({
    mutationFn: async (event: TimelineEvent) => {
      const selectedMode =
        modes.find((m) => m.id?.toString() === event.hruConfig?.mode?.toString()) ?? null;
      const mergedHruConfig = {
        ...event.hruConfig,
        ...(selectedMode?.power !== undefined ? { power: selectedMode.power } : {}),
        ...(selectedMode?.temperature !== undefined
          ? { temperature: selectedMode.temperature }
          : {}),
      };
      const mergedLuftatorConfig = selectedMode?.luftatorConfig ?? event.luftatorConfig ?? null;

      return api.saveTimelineEvent(
        {
          ...event,
          hruConfig: mergedHruConfig,
          luftatorConfig: mergedLuftatorConfig,
        },
        activeUnitId,
      );
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<TimelineEvent[]>(["timeline-events", activeUnitId], (prev) => {
        if (!prev) return [saved];
        const idx = prev.findIndex((e) => e.id === saved.id);
        if (idx >= 0) {
          logger.info("Timeline event updated", {
            id: saved.id,
            dayOfWeek: saved.dayOfWeek,
            startTime: saved.startTime,
          });
          const next = [...prev];
          next[idx] = { ...prev[idx], ...saved };
          return next;
        }
        logger.info("Timeline event created", {
          id: saved.id,
          dayOfWeek: saved.dayOfWeek,
          startTime: saved.startTime,
        });
        return [...prev, saved];
      });
    },
    onError: (err, event) => {
      logger.error("Failed to save timeline event", {
        error: err,
        eventId: event.id,
        dayOfWeek: event.dayOfWeek,
      });
      notifications.show({
        title: t("settings.timeline.notifications.saveFailedTitle"),
        message: translateApiError(err, t),
        color: "red",
      });
      throw err;
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: (id: number) => api.deleteTimelineEvent(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<TimelineEvent[]>(["timeline-events", activeUnitId], (prev) =>
        prev ? prev.filter((e) => e.id !== id) : [],
      );
      logger.info("Timeline event deleted", { id });
    },
    onError: (err, id) => {
      logger.error("Failed to delete timeline event", { error: err, id });
      notifications.show({
        title: t("settings.timeline.notifications.deleteFailedTitle"),
        message: translateApiError(err, t),
        color: "red",
      });
      throw err;
    },
  });

  const eventsByDay = useMemo(() => {
    const events = query.data ?? [];
    const map = new Map<number, TimelineEvent[]>();
    for (let d = 0; d < 7; d += 1) {
      map.set(d, []);
    }
    for (const ev of events) {
      const list = map.get(ev.dayOfWeek) ?? [];
      list.push(ev);
      map.set(ev.dayOfWeek, list);
    }
    for (const [key, list] of map.entries()) {
      const sorted = list.toSorted((a, b) => a.startTime.localeCompare(b.startTime));
      map.set(key, sorted);
    }
    return map;
  }, [query.data]);

  const saveEvent = async (event: TimelineEvent, options?: { silent?: boolean }) => {
    try {
      await saveEventMutation.mutateAsync(event);
      if (!options?.silent) {
        notifications.show({
          title: t("settings.timeline.notifications.saveSuccessTitle"),
          message: t("settings.timeline.notifications.saveSuccessMessage"),
          color: "green",
        });
      }
      return true;
    } catch {
      return false;
    }
  };

  const deleteEvent = async (id: number, options?: { silent?: boolean }) => {
    try {
      await deleteEventMutation.mutateAsync(id);
      if (!options?.silent) {
        notifications.show({
          title: t("settings.timeline.notifications.deleteSuccessTitle"),
          message: t("settings.timeline.notifications.deleteSuccessMessage"),
          color: "green",
        });
      }
      return true;
    } catch {
      return false;
    }
  };

  return {
    events: query.data ?? [],
    eventsByDay,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    saveEvent,
    deleteEvent,
    isMutating: saveEventMutation.isPending || deleteEventMutation.isPending,
  };
}
