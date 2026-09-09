import { useCallback, useMemo, useState } from "react";
import { Button, Container, Divider, Group, Modal, Stack, Text, Title } from "@mantine/core";
import { DndContext, type DragEndEvent, DragOverlay, type DragStartEvent } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { IconCalendar } from "@tabler/icons-react";
import { translateApiError } from "@luftuj/shared/utils/apiError";

import { useTimelineModesQuery } from "@luftuj/features/timeline/hooks/useTimelineModesQuery";
import { useTimelineEventsQuery } from "@luftuj/features/timeline/hooks/useTimelineEventsQuery";
import { useDndSensors } from "@luftuj/shared/dnd/useDndSensors";
import { ModeCard, TimelineModeList } from "@luftuj/features/timeline/components/TimelineModeList";
import {
  DAY_DROP_PREFIX,
  TimelineDayCard,
} from "@luftuj/features/timeline/components/TimelineDayCard";
import { TimelineEventModal } from "@luftuj/features/timeline/components/TimelineEventModal";
import { TimelineModeModal } from "@luftuj/features/timeline/components/TimelineModeModal";

import {
  useDayCopyPaste,
  useEventWorkflow,
  useHruContext,
  useModeWorkflow,
} from "@luftuj/features/timeline/hooks";

import {
  DAY_ORDER,
  DEFAULT_START_TIME,
  getDayLabels,
  getModeOptions,
} from "@luftuj/features/timeline/utils";
import type { Mode, TimelineEvent } from "@luftuj/shared/types/timeline";
import { notifications } from "@mantine/notifications";
import { createLogger } from "@luftuj/shared/utils/logger";
import * as api from "@luftuj/features/timeline/api";
import { ModeDeleteConfirm } from "@luftuj/features/timeline/components/ModeDeleteConfirm";
import {
  EmptyActiveSeasonNotice,
  SeasonSwitcher,
  SeasonViewNotice,
  useSeasonView,
} from "@luftuj/features/timeline/components/SeasonSwitcher";

const logger = createLogger("TimelinePage");

export function TimelinePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sensors = useDndSensors();
  const [activeMode, setActiveMode] = useState<Mode | null>(null);
  // Deleting a mode removes events from every season, including ones off-screen,
  // so it goes through a confirmation that shows the per-season damage first.
  const [modePendingDelete, setModePendingDelete] = useState<Mode | null>(null);

  const { valves, valveGroups, hruVariables, powerUnit, maxPower, activeUnitId, loading } =
    useHruContext();

  const {
    featureEnabled: seasonsEnabled,
    unitHasEnabledEvents,
    seasons,
    activeSeasonId,
    viewedSeasonId,
    setViewedSeason,
    viewedSeason,
    activeSeason,
  } = useSeasonView();

  // With the feature off there is still one season row behind the scenes, but
  // the user has no seasons: naming one in a dialog title or a paste toast is
  // vocabulary they never opted into.
  const viewedSeasonLabel =
    seasonsEnabled && viewedSeason
      ? t(`settings.seasons.names.${viewedSeason.seasonKey}`)
      : undefined;

  const {
    modes,
    saveMode,
    deleteMode,
    isMutating: isModesMutating,
  } = useTimelineModesQuery(activeUnitId, viewedSeasonId);
  const {
    eventsByDay,
    saveEvent,
    deleteEvent,
    refetch: refetchEvents,
    isMutating,
  } = useTimelineEventsQuery(modes, activeUnitId, viewedSeasonId);

  const {
    eventModalOpen,
    editingEvent,
    handleAddEvent,
    handleEditEvent,
    handleSaveEvent,
    handleCloseEventModal,
    handleEventChange,
  } = useEventWorkflow(t, saveEvent, modes);

  const {
    modeModalOpen,
    editingMode,
    modeNameError,
    handleAddMode,
    handleEditMode,
    handleSaveMode,
    handleDeleteMode,
    handleNameChange,
    handleCloseModeModal,
  } = useModeWorkflow(t, saveMode, deleteMode, refetchEvents, activeUnitId);

  const dayLabels = useMemo(() => getDayLabels(t), [t]);

  /**
   * Puts a mode back to unconfigured for the season being viewed. The backend
   * refuses while enabled events there still use it, which is the point: the
   * alternative is a schedule quietly pointing at a mode that does nothing.
   */
  const handleClearSeasonValues = useCallback(
    async (modeId: number) => {
      try {
        await api.clearModeValuesForSeason(modeId, activeUnitId, viewedSeasonId);
        handleCloseModeModal();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["timeline-modes"] }),
          queryClient.invalidateQueries({ queryKey: ["timeline-events"] }),
          queryClient.invalidateQueries({ queryKey: ["seasons"] }),
        ]);
        notifications.show({
          color: "green",
          title: t("settings.timeline.notifications.saveSuccessTitle"),
          message: t("settings.timeline.modeValuesCleared"),
        });
      } catch (err) {
        logger.error("Failed to clear mode values for season", { error: err, modeId });
        notifications.show({
          color: "red",
          title: t("settings.timeline.notifications.saveFailedTitle"),
          message: translateApiError(err, t),
        });
      }
    },
    [activeUnitId, handleCloseModeModal, queryClient, t, viewedSeasonId],
  );

  const {
    copyDay,
    copyActive,
    copySourceSeasonLabel,
    setCopyDay,
    handlePasteDay,
    pendingPaste,
    confirmPaste,
    cancelPaste,
  } = useDayCopyPaste(t, eventsByDay, deleteEvent, saveEvent, dayLabels, {
    seasonId: viewedSeasonId,
    seasonLabel: viewedSeasonLabel,
    unitId: activeUnitId,
    modes,
  });

  const modeOptions = useMemo(() => getModeOptions(modes), [modes]);

  const handleToggleEvent = useCallback(
    (event: TimelineEvent, enabled: boolean) => {
      void saveEvent({ ...event, enabled }).then(() => {
        logger.info("Event toggled", { id: event.id, enabled });
      });
    },
    [saveEvent],
  );

  const handleDropAndEdit = useCallback(
    (day: number, mode: Mode) => {
      const event: TimelineEvent = {
        startTime: DEFAULT_START_TIME,
        dayOfWeek: day,
        hruConfig: { mode: mode.id.toString() },
        enabled: true,
      };
      handleEventChange(event);
      handleEditEvent(event);
    },
    [handleEventChange, handleEditEvent],
  );

  const handleCancelCopy = useCallback(() => {
    setCopyDay(null);
  }, [setCopyDay]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const mode = event.active.data.current?.mode as Mode | undefined;
    setActiveMode(mode ?? null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveMode(null);
      const { active, over } = event;
      if (!over) return;
      const mode = active.data.current?.mode as Mode | undefined;
      if (!mode) return;
      // Belt and braces: the card is already non-draggable when unconfigured,
      // but the drop handler must refuse too - the same event can be created
      // from the modal, and a silently ignored drop teaches nothing.
      if (mode.configured === false) {
        notifications.show({
          color: "yellow",
          title: t("settings.timeline.modeUnconfigured"),
          message: t("settings.timeline.modeUnconfiguredDrop", { mode: mode.name }),
        });
        return;
      }
      const overId = String(over.id);
      if (!overId.startsWith(DAY_DROP_PREFIX)) return;
      const day = Number(overId.slice(DAY_DROP_PREFIX.length));
      if (!Number.isFinite(day)) return;
      handleDropAndEdit(day, mode);
    },
    [handleDropAndEdit],
  );

  return (
    <Container size="xl">
      <Stack gap="xl">
        <Stack gap={0}>
          <div style={{ display: "flex", gap: "var(--mantine-spacing-sm)", alignItems: "center" }}>
            <IconCalendar size={32} color="var(--mantine-color-luftBlue-5)" />
            <Title order={1}>{t("settings.timeline.title")}</Title>
          </div>
          <Text size="lg" c="dimmed" mt="xs">
            {t("settings.timeline.description")}
          </Text>
        </Stack>

        <Stack gap="sm">
          <SeasonSwitcher
            seasons={seasons}
            viewedSeasonId={viewedSeasonId}
            activeSeasonId={activeSeasonId}
            onChange={setViewedSeason}
            canLeave={() => {
              // A mode or event dialog is scoped to the season it was opened
              // in. Switching underneath it would silently retarget the save.
              if (!eventModalOpen && !modeModalOpen) return true;
              notifications.show({
                color: "yellow",
                title: t("settings.timeline.seasonSwitchBlockedTitle"),
                message: t("settings.timeline.seasonSwitchBlocked"),
              });
              return false;
            }}
          />
          <SeasonViewNotice viewedSeason={viewedSeason} activeSeason={activeSeason} />
          <EmptyActiveSeasonNotice
            featureEnabled={seasonsEnabled}
            unitHasEnabledEvents={unitHasEnabledEvents}
            activeSeason={activeSeason}
          />
        </Stack>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <TimelineModeList
            modes={modes}
            onAdd={handleAddMode}
            onEdit={handleEditMode}
            onDelete={(id) => setModePendingDelete(modes.find((m) => m.id === id) ?? null)}
            t={t}
            powerUnit={powerUnit}
          />

          <Stack gap="md" mt="xl">
            <Divider
              label={
                <div
                  style={{
                    display: "flex",
                    gap: "var(--mantine-spacing-xs)",
                    alignItems: "center",
                  }}
                >
                  <Text fw={700} size="sm">
                    {t("schedule.title")}
                  </Text>
                </div>
              }
              labelPosition="left"
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                gap: "var(--mantine-spacing-lg)",
                contentVisibility: "auto",
              }}
            >
              {DAY_ORDER.map((dayIdx: number) => (
                <TimelineDayCard
                  key={dayIdx}
                  dayIdx={dayIdx}
                  label={dayLabels[dayIdx]}
                  events={eventsByDay.get(dayIdx) ?? []}
                  modes={modes}
                  copyDay={copyDay}
                  copyActive={copyActive}
                  loading={loading}
                  onCopy={setCopyDay}
                  onPaste={handlePasteDay}
                  onCancelCopy={handleCancelCopy}
                  onAdd={handleAddEvent}
                  onEdit={handleEditEvent}
                  onDelete={deleteEvent}
                  onToggle={handleToggleEvent}
                  t={t}
                />
              ))}
            </div>
          </Stack>

          <DragOverlay>
            {activeMode ? (
              <ModeCard
                mode={activeMode}
                onEdit={handleEditMode}
                onDelete={(id) => setModePendingDelete(modes.find((m) => m.id === id) ?? null)}
                t={t}
                powerUnit={powerUnit}
                style={{ cursor: "grabbing", boxShadow: "var(--mantine-shadow-md)" }}
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        <TimelineEventModal
          opened={eventModalOpen}
          event={editingEvent}
          modeOptions={modeOptions}
          saving={isMutating}
          onClose={handleCloseEventModal}
          onSave={handleSaveEvent}
          onChange={handleEventChange}
          t={t}
          hruVariables={hruVariables}
        />

        <TimelineModeModal
          opened={modeModalOpen}
          mode={editingMode}
          valves={valves}
          valveGroups={valveGroups}
          saving={isModesMutating}
          onClose={handleCloseModeModal}
          onSave={handleSaveMode}
          t={t}
          hruVariables={hruVariables}
          maxPower={maxPower}
          existingModes={modes}
          seasonLabel={viewedSeasonLabel}
          copyFromSeasons={
            // Only worth offering while this mode has nothing here yet.
            editingMode?.configured === false
              ? seasons
                  .filter((season) => season.id !== viewedSeasonId)
                  .map((season) => ({
                    id: season.id,
                    label: t(`settings.seasons.names.${season.seasonKey}`),
                  }))
              : []
          }
          onCopyFromSeason={(seasonId) =>
            editingMode
              ? api.fetchModeInSeason(editingMode.id, seasonId, activeUnitId)
              : Promise.resolve(undefined)
          }
          onClearSeasonValues={
            // "Clear the values for this season" only means something when
            // other seasons hold values of their own; on a feature-off install
            // it is just an unlabelled way to make the mode unconfigured.
            seasonsEnabled && editingMode && viewedSeasonId !== undefined
              ? () => void handleClearSeasonValues(editingMode.id)
              : undefined
          }
          nameError={modeNameError}
          onNameChange={handleNameChange}
        />
      </Stack>
      <Modal
        opened={pendingPaste !== null}
        onClose={cancelPaste}
        centered
        title={<Text fw={600}>{t("settings.timeline.pasteOverwriteTitle")}</Text>}
      >
        <Stack gap="md">
          <Text size="sm">
            {t("settings.timeline.pasteOverwriteBody", {
              day: pendingPaste ? dayLabels[pendingPaste.targetDay] : "",
              count: pendingPaste?.replacing ?? 0,
              source: copySourceSeasonLabel ?? "",
            })}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={cancelPaste}>
              {t("settings.timeline.modal.cancel")}
            </Button>
            <Button color="red" onClick={confirmPaste}>
              {t("settings.timeline.pasteOverwriteConfirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <ModeDeleteConfirm
        mode={modePendingDelete}
        unitId={activeUnitId}
        onCancel={() => setModePendingDelete(null)}
        onConfirm={(id) => {
          setModePendingDelete(null);
          void handleDeleteMode(id);
        }}
      />
    </Container>
  );
}
