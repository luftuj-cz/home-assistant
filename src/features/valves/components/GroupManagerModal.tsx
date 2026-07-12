import { useState, useTransition } from "react";
import { closestCenter, DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  MultiSelect,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconAlertCircle, IconGripVertical, IconTrash } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";

import {
  createValveGroup,
  deleteValveGroup,
  setValveGroupMembers,
  updateValveGroup,
} from "@luftuj/features/valves/api";
import { SortableItem } from "@luftuj/shared/dnd/SortableItem";
import { useSortableReorder } from "@luftuj/shared/dnd/useSortableReorder";
import type { Valve, ValveGroup } from "@luftuj/shared/types/valve";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("GroupManagerModal");

export interface GroupManagerModalProps {
  opened: boolean;
  onClose: () => void;
  valves: Valve[];
  groups: ValveGroup[];
  onGroupsChanged: () => void | Promise<void>;
}

export function GroupManagerModal({
  opened,
  onClose,
  valves,
  groups,
  onGroupsChanged,
}: Readonly<GroupManagerModalProps>) {
  const { t } = useTranslation();
  const [newGroupName, setNewGroupName] = useState("");
  const [isPending, startTransition] = useTransition();

  const assignedElsewhere = new Map<string, number>();
  for (const g of groups) {
    for (const entityId of g.entityIds) {
      assignedElsewhere.set(entityId, g.id);
    }
  }

  function valveOptionsFor(group: ValveGroup) {
    return valves
      .filter((valve) => {
        const ownerId = assignedElsewhere.get(valve.entityId);
        return ownerId === undefined || ownerId === group.id;
      })
      .map((valve) => ({ value: valve.entityId, label: valve.name }));
  }

  function reportActionFailure(action: string, error: unknown) {
    logger.error(`Failed to ${action}`, { error });
    notifications.show({
      color: "red",
      icon: <IconAlertCircle size={20} />,
      title: t("valves.groups.actionFailedTitle", { defaultValue: "Action failed" }),
      message:
        error instanceof Error
          ? error.message
          : t("valves.groups.actionFailedMessage", { defaultValue: "Please try again." }),
    });
  }

  function handleCreate() {
    const name = newGroupName.trim();
    if (!name) return;
    startTransition(async () => {
      try {
        await createValveGroup({ name, sortOrder: groups.length });
        setNewGroupName("");
        await onGroupsChanged();
      } catch (error) {
        reportActionFailure("create valve group", error);
      }
    });
  }

  function handleRename(group: ValveGroup, name: string) {
    if (!name.trim() || name === group.name) return;
    startTransition(async () => {
      try {
        await updateValveGroup(group.id, {
          name: name.trim(),
          sortOrder: group.sortOrder,
        });
        await onGroupsChanged();
      } catch (error) {
        reportActionFailure("rename valve group", error);
      }
    });
  }

  function handleDelete(group: ValveGroup) {
    startTransition(async () => {
      try {
        await deleteValveGroup(group.id);
        await onGroupsChanged();
      } catch (error) {
        reportActionFailure("delete valve group", error);
      }
    });
  }

  function handleMembersChange(group: ValveGroup, entityIds: string[]) {
    startTransition(async () => {
      try {
        await setValveGroupMembers(group.id, entityIds);
        await onGroupsChanged();
      } catch (error) {
        reportActionFailure("update valve group members", error);
      }
    });
  }

  const sourceGroups = groups.toSorted((a, b) => a.sortOrder - b.sortOrder);
  const {
    orderedItems: sortedGroups,
    sensors,
    handleDragEnd,
  } = useSortableReorder(sourceGroups, (g) => g.id);

  function persistOrder(reordered: ValveGroup[]) {
    return Promise.all(
      reordered.map((g, index) =>
        index === g.sortOrder
          ? Promise.resolve()
          : updateValveGroup(g.id, { name: g.name, sortOrder: index }),
      ),
    )
      .then(onGroupsChanged)
      .catch((error: unknown) => {
        logger.error("Failed to persist valve group order", { error });
        notifications.show({
          color: "red",
          icon: <IconAlertCircle size={20} />,
          title: t("valves.groups.reorderFailedTitle", { defaultValue: "Reorder failed" }),
          message: t("valves.groups.reorderFailedMessage", {
            defaultValue: "Could not save the new group order. Please try again.",
          }),
        });
      });
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("valves.groups.manage", { defaultValue: "Manage groups" })}
      size="lg"
      centered
      styles={{ body: { overflow: "hidden" }, content: { overflow: "hidden" } }}
    >
      <Stack gap="lg">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event) => handleDragEnd(event, persistOrder)}
        >
          <SortableContext
            items={sortedGroups.map((g) => g.id)}
            strategy={verticalListSortingStrategy}
          >
            <Stack gap="md">
              {sortedGroups.map((group) => (
                <SortableItem key={group.id} id={group.id}>
                  {({ setNodeRef, style, dragHandleProps }) => (
                    <Stack
                      ref={setNodeRef}
                      style={{
                        ...style,
                        border: "1px solid var(--mantine-color-default-border)",
                        borderRadius: "var(--mantine-radius-md)",
                      }}
                      gap="xs"
                      p="sm"
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Group gap="xs" style={{ flex: 1 }} wrap="nowrap">
                          <ActionIcon
                            variant="subtle"
                            style={{ cursor: "grab", touchAction: "none" }}
                            aria-label={t("valves.groups.reorder", {
                              defaultValue: "Drag to reorder",
                            })}
                            {...dragHandleProps}
                          >
                            <IconGripVertical size={16} />
                          </ActionIcon>
                          <TextInput
                            defaultValue={group.name}
                            onBlur={(event) => handleRename(group, event.currentTarget.value)}
                            style={{ flex: 1 }}
                          />
                        </Group>
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          onClick={() => handleDelete(group)}
                          aria-label={t("valves.groups.delete", { defaultValue: "Delete group" })}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                      <MultiSelect
                        data={valveOptionsFor(group)}
                        value={group.entityIds}
                        onChange={(entityIds) => handleMembersChange(group, entityIds)}
                        placeholder={t("valves.groups.assignValves", {
                          defaultValue: "Assign valves",
                        })}
                        searchable
                        clearable
                      />
                    </Stack>
                  )}
                </SortableItem>
              ))}
              {groups.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {t("valves.groups.empty", { defaultValue: "No groups yet." })}
                </Text>
              ) : null}
            </Stack>
          </SortableContext>
        </DndContext>

        <Group gap="sm" align="flex-end">
          <TextInput
            label={t("valves.groups.newGroupName", { defaultValue: "New group name" })}
            value={newGroupName}
            onChange={(event) => setNewGroupName(event.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button onClick={handleCreate} loading={isPending} disabled={!newGroupName.trim()}>
            {t("valves.groups.create", { defaultValue: "Create" })}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
