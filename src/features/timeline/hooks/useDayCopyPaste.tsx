import { useState, useEffect, useCallback } from "react";
import { notifications } from "@mantine/notifications";
import { Stack, Text, Button } from "@mantine/core";
import type { TFunction } from "i18next";
import { IconCopy } from "@tabler/icons-react";
import type { TimelineEvent } from "../../../types/timeline";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("useDayCopyPaste");

export function useDayCopyPaste(
  t: TFunction,
  eventsByDay: Map<number, TimelineEvent[]>,
  deleteEvent: (id: number) => Promise<void>,
  saveEvent: (event: TimelineEvent) => Promise<void | boolean>,
  dayLabels: string[],
) {
  const [copyDay, setCopyDay] = useState<number | null>(null);

  useEffect(() => {
    if (copyDay !== null) {
      const message = (
        <Stack gap="xs">
          <Text size="xs">{t("settings.timeline.copyHint")}</Text>
          <Button
            size="compact-xs"
            variant="light"
            color="gray"
            fullWidth
            onClick={() => setCopyDay(null)}
          >
            {t("settings.timeline.modal.cancel")}
          </Button>
        </Stack>
      );

      notifications.show({
        id: "copy-hint",
        icon: <IconCopy size={16} />,
        title: t("settings.timeline.copying", {
          day: dayLabels[copyDay],
        }),
        message,
        autoClose: false,
        withCloseButton: false,
        color: "blue",
        loading: true,
      });
    } else {
      notifications.hide("copy-hint");
    }
  }, [copyDay, dayLabels, t, deleteEvent, saveEvent, eventsByDay]);

  const handlePasteDay = useCallback(
    async (targetDay: number) => {
      if (copyDay === null) return;
      const source = eventsByDay.get(copyDay) ?? [];
      const targetEvents = eventsByDay.get(targetDay) ?? [];

      for (const ev of targetEvents) {
        if (ev.id !== undefined) {
          await deleteEvent(ev.id);
        }
      }

      for (const ev of source) {
        await saveEvent({
          startTime: ev.startTime,
          dayOfWeek: targetDay,
          hruConfig: ev.hruConfig,
          luftatorConfig: ev.luftatorConfig,
          enabled: ev.enabled,
        });
      }
      setCopyDay(null);
      notifications.show({
        title: t("settings.timeline.notifications.saveSuccessTitle"),
        message: t("settings.timeline.pasteSuccess"),
        color: "green",
      });
      logger.info("Day pasted successfully", { targetDay: dayLabels[targetDay] });
    },
    [copyDay, eventsByDay, deleteEvent, saveEvent, t, dayLabels],
  );

  return {
    copyDay,
    setCopyDay,
    handlePasteDay,
  };
}
