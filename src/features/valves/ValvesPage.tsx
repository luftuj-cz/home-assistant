import { closestCenter, DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { IconAdjustmentsHorizontal, IconRefresh } from "@tabler/icons-react";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useAutomaticStatus } from "@luftuj/features/automatic/hooks";
import { bulkSetValveGroupValue } from "@luftuj/features/valves/api";
import { GroupManagerDialog } from "@luftuj/features/valves/components/GroupManagerDialog";
import { ValveGroup } from "@luftuj/features/valves/components/ValveGroup";
import { useCollapsedGroups } from "@luftuj/features/valves/hooks/useCollapsedGroups";
import { useValveGroups } from "@luftuj/features/valves/hooks/useValveGroups";
import { useValveStates } from "@luftuj/features/valves/hooks/useValveStates";
import { ValveLocksContext } from "@luftuj/features/valves/valveLocks";
import { SortableGrip } from "@luftuj/shared/dnd/SortableGrip";
import { SortableItem } from "@luftuj/shared/dnd/SortableItem";
import { useReorderAnnouncer } from "@luftuj/shared/dnd/useReorderAnnouncer";
import { useSortableReorder } from "@luftuj/shared/dnd/useSortableReorder";
import { Alert } from "@luftuj/shared/ui/alert";
import { Button } from "@luftuj/shared/ui/button";
import { EmptyState } from "@luftuj/shared/ui/empty-state";
import { IconDamper } from "@luftuj/shared/ui/icons";
import { PageHeader } from "@luftuj/shared/ui/page-header";
import { Skeleton } from "@luftuj/shared/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@luftuj/shared/ui/tooltip";
import { cn } from "@luftuj/shared/utils/cn";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("ValvesPage");

const UNGROUPED = "ungrouped";
/** One turn of animate-spin (`--animate-spin` in globals.css). */
const SPIN_MS = 900;

/**
 * Klapky: one ValveGroup per saved group (reorder by its grip, ↑ ↓ too), then the dampers without a group. Values
 * arrive live from Home Assistant; a slider previews while it moves and writes on release.
 */
export function ValvesPage() {
  const { t } = useTranslation();
  const automatic = useAutomaticStatus();
  const lockedValves = automatic.data?.lockedValves;
  const locks = useMemo(
    () => new Map((lockedValves ?? []).map((valve) => [valve.entityId, valve.roomName])),
    [lockedValves],
  );
  const {
    valves,
    loading,
    gracePeriodExpired,
    error,
    setError,
    haStatus,
    anyUnavailable,
    refresh,
    preview,
    commit,
  } = useValveStates();
  const { groups, refetch: refetchGroups, saveOrder } = useValveGroups();
  const { isCollapsed, setGroupCollapsed } = useCollapsedGroups();
  const [managerOpen, setManagerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { orderedItems, sensors, handleDragEnd, move } = useSortableReorder(
    groups,
    (group) => group.id,
  );
  // Groups whose valves Home Assistant does not report are not drawn; ↑ ↓, the sortable list and the announced
  // positions skip them, so a move never swaps a group with an invisible one.
  const visibleGroups = orderedItems
    .map((group) => ({
      group,
      members: valves.filter((valve) => group.entityIds.includes(valve.entityId)),
    }))
    .filter((entry) => entry.members.length > 0);
  const announcer = useReorderAnnouncer(
    visibleGroups.map((entry) => entry.group),
    (group) => group.id,
    (group) => group.name,
  );

  function moveVisible(index: number, delta: -1 | 1) {
    const group = visibleGroups[index]?.group;
    const neighbour = visibleGroups[index + delta]?.group;
    if (!group || !neighbour) return;
    move(orderedItems.indexOf(group), orderedItems.indexOf(neighbour), saveOrder);
    announcer.announceMove(group, index + delta);
  }

  // The refresh icon turns while the snapshot loads and stops on a whole turn, so it never jumps back.
  async function refreshNow() {
    if (refreshing) return;
    setRefreshing(true);
    const started = performance.now();
    try {
      await refresh();
    } finally {
      const elapsed = performance.now() - started;
      const rest = Math.ceil(Math.max(elapsed, 1) / SPIN_MS) * SPIN_MS - elapsed;
      await new Promise((resolve) => setTimeout(resolve, rest));
      setRefreshing(false);
    }
  }

  async function bulkCommit(groupId: number, value: number) {
    try {
      await bulkSetValveGroupValue(groupId, value);
    } catch (bulkError) {
      logger.error("Bulk group value update failed", { groupId, value, error: bulkError });
      await refresh();
    }
  }

  const allClosed = valves.length > 0 && valves.every((valve) => valve.value >= valve.max);
  const grouped = new Set(groups.flatMap((group) => group.entityIds));
  const ungrouped = valves.filter((valve) => !grouped.has(valve.entityId));

  let content: ReactNode;
  if (loading || (valves.length === 0 && !gracePeriodExpired)) {
    content = (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[236px] rounded-xl" />
        ))}
      </div>
    );
  } else if (valves.length === 0) {
    content = (
      <EmptyState
        icon={IconDamper}
        title={t("valves.emptyTitle")}
        description={t("valves.empty")}
        className="rounded-xl bg-card shadow-plane"
      />
    );
  } else {
    content = (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 max-md:gap-6">
        <DndContext
          accessibility={announcer.accessibility}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event) => handleDragEnd(event, saveOrder)}
        >
          <SortableContext
            items={visibleGroups.map((entry) => entry.group.id)}
            strategy={verticalListSortingStrategy}
          >
            {visibleGroups.map(({ group, members }, index) => {
              const key = String(group.id);
              return (
                <SortableItem key={group.id} id={group.id}>
                  {({ setNodeRef, style, isDragging, dragHandleProps }) => (
                    <ValveGroup
                      rootRef={setNodeRef}
                      style={style}
                      dragging={isDragging}
                      name={group.name}
                      valves={members}
                      collapsed={isCollapsed(key)}
                      onCollapsedChange={(value) => setGroupCollapsed(key, value)}
                      onPreview={preview}
                      onCommit={commit}
                      onBulkCommit={(value) => bulkCommit(group.id, value)}
                      grip={
                        <SortableGrip
                          handle={dragHandleProps}
                          label={t("valves.groups.reorder")}
                          onMove={(delta) => moveVisible(index, delta)}
                          size={18}
                          className="mb-1 h-7 w-5 text-input"
                        />
                      }
                    />
                  )}
                </SortableItem>
              );
            })}
          </SortableContext>
        </DndContext>
        {ungrouped.length > 0 && (
          <ValveGroup
            name={t("valves.groups.ungrouped")}
            valves={ungrouped}
            collapsed={isCollapsed(UNGROUPED)}
            onCollapsedChange={(value) => setGroupCollapsed(UNGROUPED, value)}
            onPreview={preview}
            onCommit={commit}
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 font-sans text-sm leading-5 text-foreground max-md:gap-4">
      <PageHeader
        title={t("valves.title")}
        description={t("valves.description")}
        actions={
          <>
            <Button
              variant="secondary"
              icon={IconAdjustmentsHorizontal}
              onClick={() => setManagerOpen(true)}
            >
              {t("valves.groups.manage")}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Phones: icon and label, half the row beside Spravovat skupiny. Wider: the square icon
                    button with its tooltip; the label stays for screen readers. */}
                <Button
                  variant="secondary"
                  icon={IconRefresh}
                  aria-label={t("valves.refreshAria")}
                  aria-busy={refreshing || undefined}
                  className={cn(
                    "md:size-10 md:p-0",
                    refreshing && "[&_svg]:animate-spin motion-reduce:[&_svg]:animate-none",
                  )}
                  onClick={() => void refreshNow()}
                >
                  <span className="md:sr-only">{t("valves.refresh")}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("valves.refreshAria")}</TooltipContent>
            </Tooltip>
          </>
        }
      />

      {error && (
        <Alert
          variant="destructive"
          title={t("valves.alertTitle")}
          action={
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>
              {t("ui.close")}
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      {(haStatus === "offline" || haStatus === "disconnected") && (
        <Alert variant="warning" title={t("valves.warningTitle")}>
          {t("valves.warnings.offlineMode")}
        </Alert>
      )}
      {anyUnavailable && (
        <Alert variant="warning" title={t("valves.warningTitle")}>
          {t("valves.warnings.unavailable")}
        </Alert>
      )}
      {allClosed && (
        <Alert variant="destructive" title={t("valves.warningTitle")}>
          {t("valves.warnings.allClosed")}
        </Alert>
      )}

      {locks.size > 0 && (
        <Alert variant="info" title={t("valves.automaticTitle")}>
          {t("valves.automaticNote")}
        </Alert>
      )}
      <ValveLocksContext.Provider value={locks}>{content}</ValveLocksContext.Provider>
      <p role="status" className="sr-only">
        {announcer.message}
      </p>

      <GroupManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        valves={valves}
        groups={orderedItems}
        onGroupsChanged={refetchGroups}
        onOrderChanged={saveOrder}
      />
    </div>
  );
}
