import { useCallback, useEffect, useMemo, useState } from "react";
import { notifications } from "@mantine/notifications";
import { Button, Stack, Text } from "@mantine/core";
import type { TFunction } from "i18next";
import { IconCopy } from "@tabler/icons-react";
import type { Mode, TimelineEvent } from "@luftuj/shared/types/timeline";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("useDayCopyPaste");

/**
 * A copied day, captured as data rather than as a pointer into the currently
 * loaded season. Holding a day index meant the source vanished the moment the
 * user switched season; carrying the events makes crossing seasons free.
 */
interface DayClipboard {
  sourceSeasonId?: number;
  sourceSeasonLabel?: string;
  sourceUnitId?: string;
  sourceDay: number;
  events: TimelineEvent[];
}

interface PendingPaste {
  targetDay: number;
  replacing: number;
}

interface CopyPasteContext {
  /** Season currently being viewed; pasted events land here. */
  seasonId?: number;
  seasonLabel?: string;
  unitId?: string;
  /** Modes resolved for the viewed season, so we know what is configured here. */
  modes: Mode[];
}

export function useDayCopyPaste(
  t: TFunction,
  eventsByDay: Map<number, TimelineEvent[]>,
  deleteEvent: (id: number, options?: { silent?: boolean }) => Promise<boolean>,
  saveEvent: (event: TimelineEvent, options?: { silent?: boolean }) => Promise<boolean>,
  dayLabels: string[],
  context: CopyPasteContext,
) {
  const [clipboard, setClipboard] = useState<DayClipboard | null>(null);
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);

  const setCopyDay = useCallback(
    (day: number | null) => {
      if (day === null) {
        setClipboard(null);
        return;
      }
      setClipboard({
        sourceSeasonId: context.seasonId,
        sourceSeasonLabel: context.seasonLabel,
        sourceUnitId: context.unitId,
        sourceDay: day,
        events: eventsByDay.get(day) ?? [],
      });
    },
    [context.seasonId, context.seasonLabel, context.unitId, eventsByDay],
  );

  /**
   * Day index shown as "this is the source". Null once the clipboard comes from
   * another season, so no day in the current view is wrongly marked.
   */
  const copyDay = useMemo(() => {
    if (!clipboard) return null;
    if (clipboard.sourceSeasonId !== context.seasonId) return null;
    return clipboard.sourceDay;
  }, [clipboard, context.seasonId]);

  useEffect(() => {
    if (!clipboard) {
      notifications.hide("copy-hint");
      return;
    }

    const crossSeason =
      clipboard.sourceSeasonLabel !== undefined && clipboard.sourceSeasonId !== context.seasonId;

    notifications.show({
      id: "copy-hint",
      icon: <IconCopy size={16} />,
      title: crossSeason
        ? t("settings.timeline.copyingFromSeason", {
            day: dayLabels[clipboard.sourceDay],
            season: clipboard.sourceSeasonLabel,
          })
        : t("settings.timeline.copying", { day: dayLabels[clipboard.sourceDay] }),
      message: (
        <Stack gap="xs">
          <Text size="xs">{t("settings.timeline.copyHint")}</Text>
          <Button
            size="compact-xs"
            variant="light"
            color="gray"
            fullWidth
            onClick={() => setClipboard(null)}
          >
            {t("settings.timeline.modal.cancel")}
          </Button>
        </Stack>
      ),
      autoClose: false,
      withCloseButton: false,
      color: "blue",
      loading: true,
    });
  }, [clipboard, context.seasonId, dayLabels, t]);

  const performPaste = useCallback(
    async (targetDay: number, source: DayClipboard) => {
      // Clearing the target day has to succeed before anything is created:
      // carrying on after a failed delete leaves the day holding the old events
      // and the pasted ones at once, which is worse than not pasting at all.
      for (const existing of eventsByDay.get(targetDay) ?? []) {
        if (existing.id === undefined) continue;
        if (!(await deleteEvent(existing.id, { silent: true }))) {
          setPendingPaste(null);
          notifications.show({
            color: "red",
            title: t("settings.timeline.pasteBlockedTitle"),
            message: t("settings.timeline.pasteDeleteFailed", { day: dayLabels[targetDay] }),
          });
          logger.error("Paste aborted, target day could not be cleared", { targetDay });
          return;
        }
      }

      const disabledModes = new Set<string>();
      let pasted = 0;
      let failed = 0;

      for (const event of source.events) {
        const modeRef = event.hruConfig?.mode?.toString();
        // Events reference a mode by id or - legacy rows - by name; the backend
        // resolves both, so the paste has to as well or a name-referenced event
        // is judged against a mode that was never found.
        const mode = context.modes.find(
          (candidate) => candidate.id.toString() === modeRef || candidate.name === modeRef,
        );
        // The invariant only covers *enabled* events, so an event whose mode is
        // unconfigured here is kept and switched off rather than dropped. The
        // whole day survives; the blocked parts are inert and flagged.
        const usable = mode?.configured !== false;

        const saved = await saveEvent(
          {
            startTime: event.startTime,
            dayOfWeek: targetDay,
            hruConfig: event.hruConfig,
            luftatorConfig: event.luftatorConfig,
            enabled: usable ? event.enabled : false,
          },
          { silent: true },
        );
        // Count what actually landed, and name a mode as disabled only once its
        // event exists. saveEvent reports its own failure, so a summary counting
        // attempts contradicted the error the user was already looking at.
        if (saved) {
          pasted++;
          if (!usable && mode) disabledModes.add(mode.name);
        } else {
          failed++;
        }
      }

      setClipboard(null);
      setPendingPaste(null);

      // A plain success toast would turn a partial paste into exactly the kind
      // of half-failure the rest of this feature avoids.
      if (failed > 0) {
        notifications.show({
          color: "red",
          autoClose: false,
          title: t("settings.timeline.pasteFailedTitle", {
            pasted,
            total: pasted + failed,
          }),
          message: t("settings.timeline.pasteFailedMessage", { failed }),
        });
      } else if (disabledModes.size > 0) {
        notifications.show({
          color: "yellow",
          autoClose: false,
          title: t("settings.timeline.pastePartialTitle", {
            pasted,
            disabled: disabledModes.size,
          }),
          message: t("settings.timeline.pastePartialMessage", {
            modes: [...disabledModes].join(", "),
          }),
        });
      } else {
        notifications.show({
          title: t("settings.timeline.notifications.saveSuccessTitle"),
          message: t("settings.timeline.pasteSuccess"),
          color: "green",
        });
      }

      logger.info("Day pasted", { targetDay: dayLabels[targetDay], pasted, failed });
    },
    [context.modes, dayLabels, deleteEvent, eventsByDay, saveEvent, t],
  );

  /**
   * Pasting replaces the target day. Same-season that is survivable because the
   * user is looking at what is destroyed; after switching season they are not,
   * so confirm whenever the target holds anything.
   */
  const handlePasteDay = useCallback(
    (targetDay: number) => {
      if (!clipboard) return;

      // Mode ids are scoped to a unit, so a mode copied from another unit does
      // not exist here. Hard rejection, not a warning.
      if (clipboard.sourceUnitId !== context.unitId) {
        notifications.show({
          color: "red",
          title: t("settings.timeline.pasteBlockedTitle"),
          message: t("settings.timeline.pasteCrossUnit"),
        });
        setClipboard(null);
        return;
      }

      const replacing = (eventsByDay.get(targetDay) ?? []).length;
      if (replacing > 0) {
        setPendingPaste({ targetDay, replacing });
        return;
      }
      void performPaste(targetDay, clipboard);
    },
    [clipboard, context.unitId, eventsByDay, performPaste, t],
  );

  const confirmPaste = useCallback(() => {
    if (pendingPaste && clipboard) void performPaste(pendingPaste.targetDay, clipboard);
  }, [clipboard, pendingPaste, performPaste]);

  const cancelPaste = useCallback(() => setPendingPaste(null), []);

  return {
    copyDay,
    copyActive: clipboard !== null,
    copySourceSeasonLabel: clipboard?.sourceSeasonLabel,
    setCopyDay,
    handlePasteDay,
    pendingPaste,
    confirmPaste,
    cancelPaste,
  };
}
