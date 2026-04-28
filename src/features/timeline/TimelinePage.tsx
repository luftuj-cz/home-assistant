import { useCallback, useMemo } from "react";
import { Stack, Text, Title, Divider, Container } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { IconCalendar } from "@tabler/icons-react";

import { useTimelineModesQuery } from "@luftuj/features/timeline/hooks/useTimelineModesQuery";
import { useTimelineEventsQuery } from "@luftuj/features/timeline/hooks/useTimelineEventsQuery";
import { useDragAutoScroll } from "@luftuj/shared/hooks/useDragScroll";
import { TimelineModeList } from "@luftuj/features/timeline/components/TimelineModeList";
import { TimelineDayCard } from "@luftuj/features/timeline/components/TimelineDayCard";
import { TimelineEventModal } from "@luftuj/features/timeline/components/TimelineEventModal";
import { TimelineModeModal } from "@luftuj/features/timeline/components/TimelineModeModal";

import { useEventWorkflow } from "@luftuj/features/timeline/hooks";
import { useModeWorkflow } from "@luftuj/features/timeline/hooks";
import { useDayCopyPaste } from "@luftuj/features/timeline/hooks";
import { useHruContext } from "@luftuj/features/timeline/hooks";

import {
  DAY_ORDER,
  getDayLabels,
  getModeOptions,
  DEFAULT_START_TIME,
} from "@luftuj/features/timeline/utils";
import type { TimelineEvent, Mode } from "@luftuj/shared/types/timeline";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("TimelinePage");

export function TimelinePage() {
  const { t } = useTranslation();
  const dragScroll = useDragAutoScroll();

  const { modes, saveMode, deleteMode } = useTimelineModesQuery();
  const {
    eventsByDay,
    saveEvent,
    deleteEvent,
    refetch: refetchEvents,
    isMutating,
  } = useTimelineEventsQuery(modes);

  const { valves, hruVariables, powerUnit, maxPower, activeUnitId, loading } = useHruContext();

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

  const { copyDay, setCopyDay, handlePasteDay } = useDayCopyPaste(
    t,
    eventsByDay,
    deleteEvent,
    saveEvent,
    dayLabels,
  );

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

        <TimelineModeList
          modes={modes}
          onAdd={handleAddMode}
          onEdit={handleEditMode}
          onDelete={handleDeleteMode}
          t={t}
          powerUnit={powerUnit}
        />

        <Stack gap="md">
          <Divider
            label={
              <div
                style={{ display: "flex", gap: "var(--mantine-spacing-xs)", alignItems: "center" }}
              >
                <Text fw={700} size="sm">
                  {t("schedule.title")}
                </Text>
              </div>
            }
            labelPosition="left"
          />
          <div
            ref={dragScroll.ref}
            style={{
              overflow: "auto",
              maxHeight: "calc(100vh - 400px)",
            }}
          >
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
                  loading={loading}
                  onCopy={setCopyDay}
                  onPaste={handlePasteDay}
                  onCancelCopy={handleCancelCopy}
                  onAdd={handleAddEvent}
                  onEdit={handleEditEvent}
                  onDelete={deleteEvent}
                  onToggle={handleToggleEvent}
                  onDropMode={handleDropAndEdit}
                  t={t}
                />
              ))}
            </div>
          </div>
        </Stack>

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
          saving={false}
          onClose={handleCloseModeModal}
          onSave={handleSaveMode}
          t={t}
          hruVariables={hruVariables}
          maxPower={maxPower}
          existingModes={modes}
          nameError={modeNameError}
          onNameChange={handleNameChange}
        />
      </Stack>
    </Container>
  );
}
