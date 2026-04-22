import { useState, useCallback } from "react";
import { notifications } from "@mantine/notifications";
import type { TFunction } from "i18next";
import type { TimelineEvent } from "../../../types/timeline";
import { createLogger } from "../../../utils/logger";
import { DEFAULT_START_TIME, validateEvent } from "../utils";

const logger = createLogger("useEventWorkflow");

export function useEventWorkflow(
  t: TFunction,
  saveEvent: (event: TimelineEvent, options?: { silent?: boolean }) => Promise<boolean>,
  modes: Array<{ id?: number | string; name: string }>,
) {
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);

  const handleAddEvent = useCallback(
    (day: number) => {
      setEditingEvent({
        startTime: DEFAULT_START_TIME,
        dayOfWeek: day,
        hruConfig: { mode: modes[0]?.id?.toString() },
        enabled: true,
      });
      setEventModalOpen(true);
    },
    [modes],
  );

  const handleEditEvent = useCallback((event: TimelineEvent) => {
    setEditingEvent(event);
    setEventModalOpen(true);
  }, []);

  const handleSaveEvent = useCallback(async () => {
    if (editingEvent) {
      const errorMessage = validateEvent(editingEvent, t);
      if (errorMessage) {
        notifications.show({
          title: t("settings.timeline.notifications.validationFailedTitle"),
          message: errorMessage,
          color: "red",
        });
        return;
      }
      const success = await saveEvent(editingEvent);
      if (success) {
        setEventModalOpen(false);
        setEditingEvent(null);
        logger.info("Event saved successfully");
      }
    }
  }, [editingEvent, saveEvent, t]);

  const handleCloseEventModal = useCallback(() => {
    setEventModalOpen(false);
    setEditingEvent(null);
  }, []);

  const handleEventChange = useCallback((event: TimelineEvent | null) => {
    setEditingEvent(event);
  }, []);

  return {
    eventModalOpen,
    editingEvent,
    handleAddEvent,
    handleEditEvent,
    handleSaveEvent,
    handleCloseEventModal,
    handleEventChange,
  };
}
