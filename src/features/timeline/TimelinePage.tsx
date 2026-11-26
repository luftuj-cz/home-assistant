import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { IconCalendarRepeat, IconPlus } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import * as api from "@luftuj/features/timeline/api";
import { ConfirmDialog } from "@luftuj/features/timeline/components/ConfirmDialog";
import { EventDialog } from "@luftuj/features/timeline/components/EventDialog";
import { FillWeekDialog } from "@luftuj/features/timeline/components/FillWeekDialog";
import { DraggableModeCard, ModeCard } from "@luftuj/features/timeline/components/ModeCard";
import { ModeCoverageDialog } from "@luftuj/features/timeline/components/ModeCoverageDialog";
import { ModeDeleteDialog } from "@luftuj/features/timeline/components/ModeDeleteDialog";
import { SeasonBand } from "@luftuj/features/timeline/components/SeasonBand";
import { DAY_DROP_PREFIX, TimelineDay } from "@luftuj/features/timeline/components/TimelineDay";
import { ModeEditor } from "@luftuj/features/timeline/components/ModeEditor";
import { WeekOverview } from "@luftuj/features/timeline/components/WeekOverview";
import { fillCustomTimeline } from "@luftuj/features/timeline/customTimelinesApi";
import {
  useDayCopyPaste,
  useEventWorkflow,
  useHruContext,
  useModeWorkflow,
} from "@luftuj/features/timeline/hooks";
import { useModeCoverage } from "@luftuj/features/timeline/hooks/useModeCoverage";
import { isOverrideApplying, usePlanView } from "@luftuj/features/timeline/hooks/usePlanView";
import { useTimelineEventsQuery } from "@luftuj/features/timeline/hooks/useTimelineEventsQuery";
import { useTimelineModesQuery } from "@luftuj/features/timeline/hooks/useTimelineModesQuery";
import {
  DAY_ORDER,
  DEFAULT_START_TIME,
  carryColor,
  clockNow,
  duplicateModeName,
  findActiveEvent,
  getDayLabels,
  modeOfEvent,
} from "@luftuj/features/timeline/utils";
import { useDndSensors } from "@luftuj/shared/dnd/useDndSensors";
import type { Mode, TimelineEvent } from "@luftuj/shared/types/timeline";
import { Alert } from "@luftuj/shared/ui/alert";
import { Button } from "@luftuj/shared/ui/button";
import { EmptyState } from "@luftuj/shared/ui/empty-state";
import { notify } from "@luftuj/shared/ui/notify";
import { PageHeader } from "@luftuj/shared/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@luftuj/shared/ui/tabs";
import { translateApiError } from "@luftuj/shared/utils/apiError";
import { createLogger } from "@luftuj/shared/utils/logger";
import { seasonLabel } from "@luftuj/shared/utils/seasonLabel";
import { useMediaQuery } from "@luftuj/shared/utils/useMediaQuery";

const logger = createLogger("TimelinePage");

/** "HH:MM" and today's index, refreshed every 30 s for the now-needles. */
function useClock() {
  const [clock, setClock] = useState(() => clockNow());
  useEffect(() => {
    const id = setInterval(() => setClock(clockNow()), 30_000);
    return () => clearInterval(id);
  }, []);
  return clock;
}

/**
 * Časová osa: the SeasonBand picks which plan is on screen, then Režimy (drag a mode onto a day) and the week of
 * TimelineDays with today highlighted. On a phone the week is a WeekOverview picking one day, and Režimy are a tab.
 */
export function TimelinePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sensors = useDndSensors();
  const [activeMode, setActiveMode] = useState<Mode | null>(null);
  // Deleting a mode removes events from every season, including ones off-screen,
  // so it goes through a confirmation that shows the per-season damage first.
  const [modePendingDelete, setModePendingDelete] = useState<Mode | null>(null);
  // On a custom timeline a mode opens as its per-season coverage, not its values.
  const [coverageMode, setCoverageMode] = useState<Mode | null>(null);
  const [fillOpen, setFillOpen] = useState(false);
  const [filling, setFilling] = useState(false);
  const [eventPendingDelete, setEventPendingDelete] = useState<{
    event: TimelineEvent;
    day: number;
  } | null>(null);
  const phone = useMediaQuery("(max-width: 767px)");
  const [phoneTab, setPhoneTab] = useState("plan");
  const clock = useClock();
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const selectedDay = pickedDay ?? clock.day;

  const {
    valves,
    valveGroups,
    hruVariables,
    powerUnit,
    minPower,
    maxPower,
    activeUnitId,
    loading,
  } = useHruContext();

  const {
    featureEnabled: seasonsEnabled,
    unitHasEnabledEvents,
    seasons,
    activeSeasonId,
    viewedSeasonId,
    setViewedSeason,
    viewedSeason,
    activeSeason,
    customTimelines,
    override,
    viewedCustom,
    setViewedCustom,
    clearCustomView,
    ref,
  } = usePlanView(activeUnitId);
  const viewingCustom = viewedCustom !== undefined;

  // With the feature off there is still one season row behind the scenes, but
  // the user has no seasons: naming one in a dialog title or a paste toast is
  // vocabulary they never opted into.
  const viewedSeasonLabel =
    seasonsEnabled && viewedSeason && !viewingCustom ? seasonLabel(viewedSeason, t) : undefined;
  const viewedPlanLabel = viewingCustom ? viewedCustom.name : viewedSeasonLabel;

  // A custom timeline has no values of its own: its modes run with the values
  // of the season active at the time, so that is what its mode list shows.
  const {
    modes: seasonModes,
    saveMode,
    deleteMode,
    isMutating: isModesMutating,
  } = useTimelineModesQuery(activeUnitId, viewingCustom ? activeSeasonId : viewedSeasonId);
  const coverage = useModeCoverage(activeUnitId, seasons, viewingCustom);
  // Usable on a custom timeline only when every enabled season can supply the
  // values - so "configured" means covered there, reusing the unconfigured state.
  const modes = useMemo(
    () =>
      viewingCustom
        ? seasonModes.map((mode) => ({ ...mode, configured: coverage.isCovered(mode.id) }))
        : seasonModes,
    [coverage, seasonModes, viewingCustom],
  );
  const {
    eventsByDay,
    saveEvent,
    deleteEvent,
    refetch: refetchEvents,
    isMutating,
  } = useTimelineEventsQuery(modes, activeUnitId, ref);

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
    duplicateTemplate,
    modeNameError,
    handleAddMode,
    handleEditMode,
    handleDuplicateMode,
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
        notify({
          variant: "success",
          title: t("settings.timeline.notifications.saveSuccessTitle"),
          message: t("settings.timeline.modeValuesCleared"),
        });
      } catch (err) {
        logger.error("Failed to clear mode values for season", { error: err, modeId });
        notify({
          variant: "error",
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
    planKey: `${ref.kind}:${ref.id ?? "-"}`,
    seasonLabel: viewedPlanLabel,
    unitId: activeUnitId,
    modes,
  });

  // Only the plan actually running has a running event: the overriding custom
  // timeline, or else the active season. Marking one in a plan the user is
  // merely browsing would claim it is applied.
  const overrideApplying = isOverrideApplying(override);
  const showsRunningPlan = viewingCustom
    ? overrideApplying && override?.customTimelineId === viewedCustom.id
    : !overrideApplying && viewedSeasonId === activeSeasonId;
  const activeEvent = showsRunningPlan
    ? findActiveEvent(eventsByDay, modes, new Date())
    : undefined;

  const eventCount = useMemo(
    () => [...eventsByDay.values()].reduce((total, list) => total + list.length, 0),
    [eventsByDay],
  );

  const canLeave = useCallback(() => {
    // A mode or event dialog is scoped to the plan it was opened in.
    // Switching underneath it would silently retarget the save.
    if (!eventModalOpen && !modeModalOpen) return true;
    notify({
      variant: "warning",
      title: t("settings.timeline.seasonSwitchBlockedTitle"),
      message: t("settings.timeline.seasonSwitchBlocked"),
    });
    return false;
  }, [eventModalOpen, modeModalOpen, t]);

  const handleEditModeInView = useCallback(
    (mode: Mode) => {
      if (viewingCustom) {
        setCoverageMode(mode);
        return;
      }
      handleEditMode(mode);
    },
    [handleEditMode, viewingCustom],
  );

  const handleDuplicateModeInView = useCallback(
    (mode: Mode) => handleDuplicateMode({ ...mode, name: duplicateModeName(mode.name, modes, t) }),
    [handleDuplicateMode, modes, t],
  );

  const handleFillWeek = useCallback(
    async (modeId: number) => {
      if (!viewedCustom) return;
      setFilling(true);
      try {
        await fillCustomTimeline(viewedCustom.id, modeId, activeUnitId);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["timeline-events"] }),
          queryClient.invalidateQueries({ queryKey: ["custom-timelines"] }),
        ]);
        setFillOpen(false);
        notify({
          variant: "success",
          title: t("settings.timeline.notifications.saveSuccessTitle"),
          message: t("settings.customTimelines.filled", { name: viewedCustom.name }),
        });
      } catch (err) {
        logger.error("Failed to fill custom timeline", { error: err });
        notify({
          variant: "error",
          title: t("settings.timeline.notifications.saveFailedTitle"),
          message: translateApiError(err, t),
        });
      } finally {
        setFilling(false);
      }
    },
    [activeUnitId, queryClient, t, viewedCustom],
  );

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
        notify({
          variant: "warning",
          title: t("settings.timeline.modeUnconfigured"),
          message: viewingCustom
            ? t("settings.customTimelines.modeNotEverywhereDrop", {
                mode: mode.name,
                seasons: coverage
                  .missingSeasons(mode.id)
                  .map((season) => seasonLabel(season, t))
                  .join(", "),
              })
            : t("settings.timeline.modeUnconfiguredDrop", { mode: mode.name }),
        });
        return;
      }
      const overId = String(over.id);
      if (!overId.startsWith(DAY_DROP_PREFIX)) return;
      const day = Number(overId.slice(DAY_DROP_PREFIX.length));
      if (!Number.isFinite(day)) return;
      handleDropAndEdit(day, mode);
    },
    [coverage, handleDropAndEdit, t, viewingCustom],
  );

  // Time without a schedule event runs automatic control (Automatika), so an empty active season is not a gap.
  const showEmptyScheduleHint =
    !viewingCustom &&
    (activeSeason === undefined ? !unitHasEnabledEvents : activeSeason.enabledEvents === 0);
  const dragAnnouncements = {
    onDragStart: ({ active }: { active: { data: { current?: Record<string, unknown> } } }) =>
      t("ui.reorder.pickedUp", {
        name: (active.data.current?.mode as Mode | undefined)?.name ?? "",
      }),
    onDragOver: ({ over }: { over: { id: string | number } | null }) =>
      over ? dayLabels[Number(String(over.id).slice(DAY_DROP_PREFIX.length))] : undefined,
    onDragEnd: ({ over }: { over: { id: string | number } | null }) =>
      over ? dayLabels[Number(String(over.id).slice(DAY_DROP_PREFIX.length))] : undefined,
    onDragCancel: () => t("ui.reorder.cancelled"),
  };

  const dayLabelOf = useCallback(
    (event: TimelineEvent | null) =>
      event?.dayOfWeek == null ? t("settings.timeline.allDays") : dayLabels[event.dayOfWeek],
    [dayLabels, t],
  );

  const modesSection = (
    <section aria-labelledby="timeline-modes" className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex min-h-10 items-center justify-between gap-3 max-md:justify-end">
        {/* On a phone the tab already names the section. */}
        <h2 id="timeline-modes" className="section-title max-md:sr-only">
          {t("settings.timeline.modesTitle")}
        </h2>
        {!viewingCustom && (
          <Button variant="secondary" icon={IconPlus} onClick={handleAddMode}>
            {t("settings.timeline.addMode")}
          </Button>
        )}
      </div>
      {modes.length === 0 ? (
        <EmptyState
          title={t("settings.timeline.noModes")}
          description={t("settings.timeline.noModesCreatedDescription")}
          className="rounded-xl bg-card shadow-plane"
          action={
            viewingCustom ? undefined : (
              <Button variant="secondary" icon={IconPlus} onClick={handleAddMode}>
                {t("settings.timeline.addMode")}
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 max-md:grid-cols-[minmax(0,1fr)]">
          {modes.map((mode) => (
            <DraggableModeCard
              key={mode.id}
              mode={mode}
              powerUnit={powerUnit}
              onEdit={handleEditModeInView}
              onDuplicate={viewingCustom ? undefined : handleDuplicateModeInView}
              onDelete={setModePendingDelete}
              draggable={!phone}
            />
          ))}
        </div>
      )}
    </section>
  );

  function renderDay(dayIdx: number, className?: string) {
    return (
      <TimelineDay
        key={dayIdx}
        dayIdx={dayIdx}
        label={dayLabels[dayIdx]}
        events={eventsByDay.get(dayIdx) ?? []}
        modes={modes}
        activeEvent={activeEvent}
        today={dayIdx === clock.day}
        now={clock.time}
        carry={carryColor(eventsByDay, dayIdx, modes)}
        copyActive={copyActive}
        copyDay={copyDay}
        loading={loading}
        onCopy={setCopyDay}
        onPaste={handlePasteDay}
        onCancelCopy={handleCancelCopy}
        onAdd={handleAddEvent}
        onEdit={handleEditEvent}
        onDelete={(event, day) => setEventPendingDelete({ event, day })}
        onToggle={handleToggleEvent}
        allowAutomatic
        className={className}
      />
    );
  }

  const fillButton = viewingCustom && (
    <Button
      variant="secondary"
      size="sm"
      icon={IconCalendarRepeat}
      onClick={() => setFillOpen(true)}
    >
      {t("settings.customTimelines.fillAction")}
    </Button>
  );

  const weekHeader = (
    <div className="flex min-h-10 flex-wrap items-center justify-between gap-3">
      <h2 className="section-title">{viewingCustom ? viewedCustom.name : t("schedule.title")}</h2>
      {fillButton}
    </div>
  );

  const pendingEvent = eventPendingDelete?.event;
  const pendingMode = pendingEvent ? modeOfEvent(pendingEvent, modes) : undefined;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 font-sans text-sm leading-5 text-foreground max-md:gap-6">
      <PageHeader
        title={t("settings.timeline.title")}
        description={t("settings.timeline.description")}
      />
      {/* empty:hidden: with no seasons, plans or warning the band renders nothing and would leave a bare gap. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 empty:hidden">
        <SeasonBand
          seasons={seasons}
          activeSeasonId={activeSeasonId}
          viewedSeasonId={viewedSeasonId}
          onSeasonChange={(id) => {
            if (canLeave()) setViewedSeason(id);
          }}
          plans={customTimelines}
          viewedPlanId={viewedCustom?.id}
          override={override}
          onPlanChange={(id) => {
            if (!canLeave()) return;
            if (id === null) clearCustomView();
            else setViewedCustom(id);
          }}
          seasonsEnabled={seasonsEnabled}
        />
        {showEmptyScheduleHint && (
          <Alert variant="info">
            {activeSeason && seasonsEnabled
              ? t("automatic.emptySeason", { season: seasonLabel(activeSeason, t) })
              : t("automatic.emptySchedule")}
          </Alert>
        )}
      </div>
      <DndContext
        sensors={sensors}
        accessibility={{ announcements: dragAnnouncements }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveMode(null)}
      >
        {phone ? (
          <Tabs value={phoneTab} onValueChange={setPhoneTab} className="gap-4">
            <TabsList className="w-full">
              <TabsTrigger value="plan" className="flex-1">
                {viewingCustom ? viewedCustom.name : t("schedule.title")}
              </TabsTrigger>
              <TabsTrigger value="modes" className="flex-1">
                {t("settings.timeline.modesTitle")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="plan" className="grid grid-cols-[minmax(0,1fr)] gap-4">
              {fillButton && <div className="flex justify-end">{fillButton}</div>}
              <WeekOverview
                eventsByDay={eventsByDay}
                modes={modes}
                dayLabels={dayLabels}
                today={clock.day}
                now={clock.time}
                selected={selectedDay}
                onSelect={setPickedDay}
                title={viewingCustom ? viewedCustom.name : t("schedule.title")}
              />
              <div key={selectedDay} className="grid grid-cols-[minmax(0,1fr)] animate-rise">
                {renderDay(selectedDay)}
              </div>
            </TabsContent>
            <TabsContent value="modes">{modesSection}</TabsContent>
          </Tabs>
        ) : (
          <>
            {modesSection}
            <section className="grid grid-cols-[minmax(0,1fr)] gap-4">
              {weekHeader}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(264px,1fr))] items-stretch gap-4">
                {DAY_ORDER.map((dayIdx: number) => renderDay(dayIdx))}
              </div>
            </section>
          </>
        )}
        <DragOverlay>
          {activeMode ? (
            <ModeCard
              mode={activeMode}
              powerUnit={powerUnit}
              onEdit={handleEditModeInView}
              onDelete={setModePendingDelete}
              dragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <EventDialog
        open={eventModalOpen}
        event={editingEvent}
        dayLabel={dayLabelOf(editingEvent)}
        modes={modes}
        allowAutomatic
        powerUnit={t(`app.units.${powerUnit}`, { defaultValue: powerUnit })}
        saving={isMutating}
        onChange={handleEventChange}
        onSave={() => void handleSaveEvent()}
        onClose={handleCloseEventModal}
        onDelete={
          editingEvent?.id === undefined
            ? undefined
            : () => {
                const event = editingEvent;
                handleCloseEventModal();
                setEventPendingDelete({ event, day: event.dayOfWeek ?? clock.day });
              }
        }
      />

      <ModeEditor
        open={modeModalOpen}
        mode={editingMode}
        template={duplicateTemplate}
        valves={valves}
        valveGroups={valveGroups}
        saving={isModesMutating}
        onClose={handleCloseModeModal}
        onSave={handleSaveMode}
        hruVariables={hruVariables}
        minPower={minPower}
        maxPower={maxPower}
        existingModes={modes}
        seasonLabel={viewedSeasonLabel}
        copyFromSeasons={
          // Only worth offering while this mode has nothing here yet. A
          // duplicate of such a mode starts just as empty, so it gets the
          // offer too - from the source's seasons.
          (editingMode ?? duplicateTemplate)?.configured === false
            ? seasons
                .filter((season) => season.id !== viewedSeasonId)
                .map((season) => ({
                  id: season.id,
                  label: seasonLabel(season, t),
                }))
            : []
        }
        onCopyFromSeason={(seasonId) => {
          const source = editingMode ?? duplicateTemplate;
          return source
            ? api.fetchModeInSeason(source.id, seasonId, activeUnitId)
            : Promise.resolve(undefined);
        }}
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

      <ConfirmDialog
        open={eventPendingDelete !== null}
        title={t("settings.timeline.eventDeleteTitle")}
        confirmLabel={t("settings.timeline.eventDeleteConfirm")}
        onCancel={() => setEventPendingDelete(null)}
        onConfirm={() => {
          if (pendingEvent?.id !== undefined) void deleteEvent(pendingEvent.id);
          setEventPendingDelete(null);
        }}
      >
        {pendingEvent &&
          t(
            pendingEvent.dayOfWeek === null
              ? "settings.timeline.eventDeleteEveryDay"
              : "settings.timeline.eventDeleteBody",
            {
              time: pendingEvent.startTime,
              mode: pendingMode?.name ?? "–",
              day: dayLabels[eventPendingDelete?.day ?? 0],
            },
          )}
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingPaste !== null}
        title={t("settings.timeline.pasteOverwriteTitle")}
        confirmLabel={t("settings.timeline.pasteOverwriteConfirm")}
        onCancel={cancelPaste}
        onConfirm={confirmPaste}
      >
        {t("settings.timeline.pasteOverwriteBody", {
          day: pendingPaste ? dayLabels[pendingPaste.targetDay] : "",
          count: pendingPaste?.replacing ?? 0,
          source: copySourceSeasonLabel ?? "",
        })}
      </ConfirmDialog>

      <ModeCoverageDialog
        mode={coverageMode}
        seasons={seasons}
        missingSeasons={coverageMode ? coverage.missingSeasons(coverageMode.id) : []}
        seasonsEnabled={seasonsEnabled}
        onClose={() => setCoverageMode(null)}
        onOpenSeason={(seasonId) => {
          setCoverageMode(null);
          setViewedSeason(seasonId);
        }}
      />

      <FillWeekDialog
        open={fillOpen}
        planName={viewedCustom?.name ?? ""}
        modes={modes.filter((mode) => mode.configured !== false)}
        existingEvents={eventCount}
        saving={filling}
        onClose={() => setFillOpen(false)}
        onConfirm={(modeId) => void handleFillWeek(modeId)}
      />

      <ModeDeleteDialog
        mode={modePendingDelete}
        unitId={activeUnitId}
        onCancel={() => setModePendingDelete(null)}
        onConfirm={(id) => {
          setModePendingDelete(null);
          void handleDeleteMode(id);
        }}
      />
    </div>
  );
}
