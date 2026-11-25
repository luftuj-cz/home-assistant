import { closestCenter, DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { IconFolders, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState, useTransition, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  createValveGroup,
  deleteValveGroup,
  setValveGroupMembers,
  updateValveGroup,
} from "@luftuj/features/valves/api";
import { SortableGrip } from "@luftuj/shared/dnd/SortableGrip";
import { SortableItem } from "@luftuj/shared/dnd/SortableItem";
import { useReorderAnnouncer } from "@luftuj/shared/dnd/useReorderAnnouncer";
import { useSortableReorder } from "@luftuj/shared/dnd/useSortableReorder";
import type { Valve, ValveGroup } from "@luftuj/shared/types/valve";
import { Button } from "@luftuj/shared/ui/button";
import { Collapse } from "@luftuj/shared/ui/collapse";
import { MultiSelect } from "@luftuj/shared/ui/combobox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@luftuj/shared/ui/dialog";
import { EmptyState } from "@luftuj/shared/ui/empty-state";
import { Field } from "@luftuj/shared/ui/field";
import { Input } from "@luftuj/shared/ui/input";
import { notify } from "@luftuj/shared/ui/notify";
import { cn } from "@luftuj/shared/utils/cn";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("GroupManagerDialog");

interface GroupManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  valves: Valve[];
  groups: ValveGroup[];
  onGroupsChanged: () => void | Promise<void>;
  onOrderChanged: (reordered: ValveGroup[]) => void | Promise<void>;
}

/**
 * Spravovat skupiny (replaces GroupManagerModal): one muted block per group with a grip (drag, or ↑ ↓), its order
 * number, the name as an inline input saved on blur, the valve count and delete, which confirms in place. Members
 * are a MultiSelect of valve names; valves already in another group are not offered. New groups under a dashed
 * line; Enter creates.
 */
export function GroupManagerDialog({
  open,
  onOpenChange,
  valves,
  groups,
  onGroupsChanged,
  onOrderChanged,
}: Readonly<GroupManagerDialogProps>) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");
  const [confirming, setConfirming] = useState<number | null>(null);
  // Members picked but not yet saved, so the chips do not blink back while the request runs.
  const [pendingMembers, setPendingMembers] = useState<Record<number, string[]>>({});
  const [creating, startCreate] = useTransition();
  const [, startUpdate] = useTransition();
  const { orderedItems, sensors, handleDragEnd, moveBy } = useSortableReorder(
    groups,
    (group) => group.id,
  );
  const announcer = useReorderAnnouncer(
    orderedItems,
    (group) => group.id,
    (group) => group.name,
  );

  const owner = new Map<string, number>();
  for (const group of groups) {
    for (const entityId of group.entityIds) owner.set(entityId, group.id);
  }

  function optionsFor(group: ValveGroup) {
    return valves
      .filter((valve) => {
        const ownerId = owner.get(valve.entityId);
        return ownerId === undefined || ownerId === group.id;
      })
      .map((valve) => ({ value: valve.entityId, label: valve.name, code: valve.entityId }));
  }

  function fail(action: string, error: unknown) {
    logger.error(`Failed to ${action}`, { error });
    notify({
      variant: "error",
      title: t("valves.groups.actionFailedTitle"),
      message: error instanceof Error ? error.message : t("valves.groups.actionFailedMessage"),
    });
  }

  function create(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    startCreate(async () => {
      try {
        await createValveGroup({ name, sortOrder: groups.length });
        setNewName("");
        await onGroupsChanged();
      } catch (error) {
        fail("create valve group", error);
      }
    });
  }

  /** The name field is uncontrolled: when nothing is saved (empty, unchanged, refused) it shows the saved name again. */
  function rename(group: ValveGroup, input: HTMLInputElement) {
    const name = input.value.trim();
    if (!name || name === group.name) {
      input.value = group.name;
      return;
    }
    startUpdate(async () => {
      try {
        await updateValveGroup(group.id, { name, sortOrder: group.sortOrder });
        await onGroupsChanged();
      } catch (error) {
        input.value = group.name;
        fail("rename valve group", error);
      }
    });
  }

  function remove(group: ValveGroup) {
    setConfirming(null);
    startUpdate(async () => {
      try {
        await deleteValveGroup(group.id);
        await onGroupsChanged();
      } catch (error) {
        fail("delete valve group", error);
      }
    });
  }

  function changeMembers(group: ValveGroup, entityIds: string[]) {
    setPendingMembers((current) => ({ ...current, [group.id]: entityIds }));
    startUpdate(async () => {
      try {
        await setValveGroupMembers(group.id, entityIds);
        await onGroupsChanged();
      } catch (error) {
        fail("update valve group members", error);
      } finally {
        setPendingMembers(({ [group.id]: _done, ...rest }) => rest);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" scroll>
        <DialogHeader legend={t("valves.groups.legend")} title={t("valves.groups.manage")} />
        <DialogBody className="@container">
          {groups.length === 0 && (
            <EmptyState
              icon={IconFolders}
              title={t("valves.groups.empty")}
              description={t("valves.groups.emptyDescription")}
            />
          )}
          <DndContext
            accessibility={announcer.accessibility}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => handleDragEnd(event, onOrderChanged)}
          >
            <SortableContext
              items={orderedItems.map((group) => group.id)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="m-0 grid list-none gap-3 p-0">
                {orderedItems.map((group, index) => {
                  const members = pendingMembers[group.id] ?? group.entityIds;
                  return (
                    <SortableItem key={group.id} id={group.id}>
                      {({ setNodeRef, style, isDragging, dragHandleProps }) => (
                        <li
                          ref={setNodeRef}
                          style={{
                            ...style,
                            transform: isDragging
                              ? `${style.transform ?? ""} rotate(-0.6deg) scale(1.01)`
                              : style.transform,
                          }}
                          className={cn(
                            "grid grid-cols-[minmax(0,1fr)] rounded-lg bg-muted px-4 pt-3 pb-4 transition-[background-color,box-shadow] duration-(--duration-base)",
                            isDragging &&
                              "relative z-10 bg-card shadow-[var(--shadow-float),0_0_0_2px_var(--air)]",
                          )}
                        >
                          <div className="mb-3 flex min-w-0 items-center gap-2">
                            <SortableGrip
                              handle={dragHandleProps}
                              label={t("valves.groups.reorder")}
                              onMove={(delta) => {
                                moveBy(index, delta, onOrderChanged);
                                if (orderedItems[index + delta]) {
                                  announcer.announceMove(group, index + delta);
                                }
                              }}
                              className="-ml-2 h-9 w-7"
                            />
                            <span className="code flex-none text-muted-foreground">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <input
                              aria-label={t("valves.groups.name")}
                              defaultValue={group.name}
                              onBlur={(event) => rename(group, event.currentTarget)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                              }}
                              className="h-9 min-w-0 flex-1 rounded-md border-0 bg-transparent px-2 font-sans text-sm font-semibold text-foreground outline-none hover:bg-card focus-visible:bg-card focus-visible:outline-2 focus-visible:outline-ring max-md:text-base"
                            />
                            <span className="caption flex-none text-muted-foreground @max-[420px]:hidden">
                              {t("valves.groups.valveCount", { count: members.length })}
                            </span>
                            <Button
                              variant="danger-ghost"
                              size="icon-sm"
                              icon={IconTrash}
                              aria-label={t("valves.groups.delete")}
                              title={t("valves.groups.delete")}
                              aria-expanded={confirming === group.id}
                              onClick={() =>
                                setConfirming(confirming === group.id ? null : group.id)
                              }
                            />
                          </div>
                          <MultiSelect
                            aria-label={t("valves.groups.membersAria", { name: group.name })}
                            options={optionsFor(group)}
                            value={members}
                            onValueChange={(entityIds) => changeMembers(group, entityIds)}
                            placeholder={t("valves.groups.assignValves")}
                            className="[&_[data-slot=multi-select-field]]:bg-card"
                          />
                          <Collapse open={confirming === group.id}>
                            <div className="mt-3 grid gap-3 rounded-lg bg-destructive-soft p-4">
                              <p className="body m-0">
                                {t("valves.groups.deleteConfirm", { name: group.name })}
                              </p>
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setConfirming(null)}
                                >
                                  {t("ui.cancel")}
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => remove(group)}
                                >
                                  {t("valves.groups.delete")}
                                </Button>
                              </div>
                            </div>
                          </Collapse>
                        </li>
                      )}
                    </SortableItem>
                  );
                })}
              </ol>
            </SortableContext>
          </DndContext>
          <form
            onSubmit={create}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-t border-dashed border-input pt-4"
          >
            <Field label={t("valves.groups.newGroupName")}>
              <Input
                value={newName}
                placeholder={t("valves.groups.newGroupPlaceholder")}
                onChange={(event) => setNewName(event.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="secondary"
              icon={IconPlus}
              loading={creating}
              disabled={!newName.trim()}
            >
              {t("valves.groups.create")}
            </Button>
          </form>
          <p role="status" className="sr-only">
            {announcer.message}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t("valves.groups.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
