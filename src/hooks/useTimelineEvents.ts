import { useState, useCallback, useMemo } from "react";
import { notifications } from "@mantine/notifications";
import type { TFunction } from "i18next";
import type { TimelineEvent, Mode } from "../types/timeline";
import * as api from "../api/timeline";
import { createLogger } from "../utils/logger";

const logger = createLogger("useTimelineEvents");

export function useTimelineEvents(modes: Mode[], t: TFunction, activeUnitId?: string) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [saving, setSaving] = useState(false);

  const eventsByDay = useMemo(() => {
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
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
      map.set(key, list);
    }
    return map;
  }, [events]);

  const loadEvents = useCallback(
    async (unitId?: string) => {
      try {
        const loaded = await api.fetchTimelineEvents(unitId);
        setEvents(loaded);
        logger.info("Timeline events loaded", { count: loaded.length, unitId });
      } catch (err) {
        logger.error("Failed to load timeline events", { error: err, unitId });
        notifications.show({
          title: t("settings.timeline.notifications.loadFailedTitle"),
          message: t("settings.timeline.notifications.loadFailedMessage"),
          color: "red",
        });
      }
    },
    [t],
  );

  const saveEvent = useCallback(
    async (event: TimelineEvent) => {
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

      setSaving(true);
      try {
        const saved = await api.saveTimelineEvent(
          {
            ...event,
            hruConfig: mergedHruConfig,
            luftatorConfig: mergedLuftatorConfig,
          },
          activeUnitId,
        );

        setEvents((prev) => {
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

        notifications.show({
          title: t("settings.timeline.notifications.saveSuccessTitle"),
          message: t("settings.timeline.notifications.saveSuccessMessage"),
          color: "green",
        });
        return true;
      } catch (err) {
        logger.error("Failed to save timeline event", {
          error: err,
          eventId: event.id,
          dayOfWeek: event.dayOfWeek,
        });
        notifications.show({
          title: t("settings.timeline.notifications.saveFailedTitle"),
          message:
            err instanceof Error
              ? err.message
              : t("settings.timeline.notifications.saveFailedMessage"),
          color: "red",
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [modes, t, activeUnitId],
  );

  const deleteEvent = useCallback(
    async (id: number) => {
      try {
        await api.deleteTimelineEvent(id);
        setEvents((prev) => prev.filter((e) => e.id !== id));
        logger.info("Timeline event deleted", { id });
      } catch (err) {
        logger.error("Failed to delete timeline event", { error: err, id });
        notifications.show({
          title: t("settings.timeline.notifications.deleteFailedTitle"),
          message:
            err instanceof Error
              ? err.message
              : t("settings.timeline.notifications.deleteFailedMessage"),
          color: "red",
        });
      }
    },
    [t],
  );

  return { events, eventsByDay, loadEvents, saveEvent, deleteEvent, saving };
}
