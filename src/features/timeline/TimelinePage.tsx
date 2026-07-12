import { useCallback, useMemo, useState } from "react";
import { Stack, Text, Title, Divider, Container } from "@mantine/core";
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";
import { IconCalendar } from "@tabler/icons-react";

import { useTimelineModesQuery } from "@luftuj/features/timeline/hooks/useTimelineModesQuery";
import { useTimelineEventsQuery } from "@luftuj/features/timeline/hooks/useTimelineEventsQuery";
import { useDndSensors } from "@luftuj/shared/dnd/useDndSensors";
import { TimelineModeList, ModeCard } from "@luftuj/features/timeline/components/TimelineModeList";
import {
  TimelineDayCard,
  DAY_DROP_PREFIX,
} from "@luftuj/features/timeline/components/TimelineDayCard";
import { TimelineEventModal } from "@luftuj/features/timeline/components/TimelineEventModal";
import { TimelineModeModal } from "@luftuj/features/timeline/components/TimelineModeModal";

import {
  useEventWorkflow,
  useModeWorkflow,
  useDayCopyPaste,
  useHruContext,
} from "@luftuj/features/timeline/hooks";

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
  const sensors = useDndSensors();
  const [activeMode, setActiveMode] = useState<Mode | null>(null);

  const { valves, valveGroups, hruVariables, powerUnit, maxPower, activeUnitId, loading } =
    useHruContext();

  const {
    modes,
    saveMode,
    deleteMode,
    isMutating: isModesMutating,
  } = useTimelineModesQuery(activeUnitId);
  const {
    eventsByDay,
    saveEvent,
    deleteEvent,
    refetch: refetchEvents,
    isMutating,
  } = useTimelineEventsQuery(modes, activeUnitId);

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

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <TimelineModeList
            modes={modes}
            onAdd={handleAddMode}
            onEdit={handleEditMode}
            onDelete={handleDeleteMode}
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
                onDelete={handleDeleteMode}
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
          nameError={modeNameError}
          onNameChange={handleNameChange}
        />
      </Stack>
    </Container>
  );
}
