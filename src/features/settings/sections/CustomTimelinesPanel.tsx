import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconCalendarEvent, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { translateApiError } from "@luftuj/shared/utils/apiError";
import type { CustomTimelineSummary } from "@luftuj/shared/types/customTimeline";
import {
  createCustomTimeline,
  deleteCustomTimeline,
  fetchCustomTimelines,
  renameCustomTimeline,
} from "@luftuj/features/timeline/customTimelinesApi";

/**
 * The custom timelines of the active unit: create, rename, delete, and a way
 * into the week editor. Activating one is deliberately not here - that is the
 * dashboard's job, next to boost.
 */
export function CustomTimelinesPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<CustomTimelineSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<CustomTimelineSummary | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["custom-timelines", "current"],
    queryFn: () => fetchCustomTimelines(),
    staleTime: 15 * 1000,
  });
  const timelines = data?.timelines ?? [];

  const run = useCallback(
    async (action: () => Promise<unknown>, onDone?: () => void) => {
      setBusy(true);
      try {
        await action();
        await queryClient.invalidateQueries({ queryKey: ["custom-timelines"] });
        onDone?.();
      } catch (error) {
        notifications.show({
          color: "red",
          title: t("settings.customTimelines.errorTitle"),
          message: translateApiError(error, t),
        });
      } finally {
        setBusy(false);
      }
    },
    [queryClient, t],
  );

  const create = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    void run(
      () => createCustomTimeline(name),
      () => setNewName(""),
    );
  }, [newName, run]);

  return (
    <Stack gap="sm">
      <Stack gap={2}>
        <Text fw={600} size="sm">
          {t("settings.customTimelines.title")}
        </Text>
        <Text size="xs" c="dimmed">
          {t("settings.customTimelines.description")}
        </Text>
      </Stack>

      {isLoading && <Loader size="sm" />}

      {!isLoading && timelines.length === 0 && (
        <Text size="sm" c="dimmed">
          {t("settings.customTimelines.empty")}
        </Text>
      )}

      {timelines.map((timeline) => {
        const overriding = timeline.overridePhase !== null;
        return (
          <Paper key={timeline.id} withBorder p="sm" radius="md">
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Group gap={6} wrap="wrap">
                  <Text fw={600} size="sm" style={{ overflowWrap: "anywhere" }}>
                    {timeline.name}
                  </Text>
                  {timeline.overridePhase === "active" && (
                    <Badge size="xs" color="grape" variant="filled">
                      {t("settings.customTimelines.phaseActive")}
                    </Badge>
                  )}
                  {timeline.overridePhase === "scheduled" && (
                    <Badge size="xs" color="grape" variant="light">
                      {t("settings.customTimelines.phaseScheduled")}
                    </Badge>
                  )}
                  {timeline.enabledEvents === 0 && (
                    <Badge size="xs" color="gray" variant="light">
                      {t("settings.customTimelines.noEvents")}
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {t("settings.customTimelines.eventCount", { count: timeline.enabledEvents })}
                </Text>
              </Stack>
              <Group gap={4} wrap="nowrap">
                <Tooltip label={t("settings.customTimelines.openInTimeline")}>
                  <ActionIcon
                    variant="subtle"
                    aria-label={t("settings.customTimelines.openInTimeline")}
                    onClick={() =>
                      void navigate({ to: "/timeline", search: { custom: timeline.id } })
                    }
                  >
                    <IconCalendarEvent size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={t("settings.customTimelines.rename")}>
                  <ActionIcon
                    variant="subtle"
                    aria-label={t("settings.customTimelines.rename")}
                    onClick={() => {
                      setRenaming(timeline);
                      setRenameValue(timeline.name);
                    }}
                  >
                    <IconPencil size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip
                  label={
                    overriding
                      ? t("settings.customTimelines.deleteBlocked")
                      : t("settings.customTimelines.delete")
                  }
                  multiline
                  w={overriding ? 240 : undefined}
                >
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={t("settings.customTimelines.delete")}
                    disabled={overriding}
                    onClick={() => setDeleting(timeline)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          </Paper>
        );
      })}

      <Group gap="xs" wrap="nowrap" align="flex-end">
        <TextInput
          style={{ flex: 1 }}
          label={t("settings.customTimelines.newLabel")}
          placeholder={t("settings.customTimelines.newPlaceholder")}
          value={newName}
          maxLength={60}
          onChange={(event) => setNewName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") create();
          }}
        />
        <Button
          leftSection={<IconPlus size={14} />}
          onClick={create}
          disabled={!newName.trim()}
          loading={busy}
        >
          {t("settings.customTimelines.create")}
        </Button>
      </Group>

      <Modal
        opened={renaming !== null}
        onClose={() => setRenaming(null)}
        centered
        title={<Text fw={600}>{t("settings.customTimelines.renameTitle")}</Text>}
      >
        <Stack gap="md">
          <TextInput
            label={t("settings.customTimelines.nameLabel")}
            value={renameValue}
            maxLength={60}
            onChange={(event) => setRenameValue(event.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRenaming(null)} disabled={busy}>
              {t("settings.timeline.modal.cancel")}
            </Button>
            <Button
              disabled={!renameValue.trim()}
              loading={busy}
              onClick={() =>
                renaming &&
                void run(
                  () => renameCustomTimeline(renaming.id, renameValue.trim()),
                  () => setRenaming(null),
                )
              }
            >
              {t("settings.customTimelines.save")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deleting !== null}
        onClose={() => setDeleting(null)}
        centered
        title={
          <Text fw={600}>
            {t("settings.customTimelines.deleteTitle", { name: deleting?.name ?? "" })}
          </Text>
        }
      >
        <Stack gap="md">
          <Text size="sm">
            {t("settings.customTimelines.deleteBody", { count: deleting?.totalEvents ?? 0 })}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={busy}>
              {t("settings.timeline.modal.cancel")}
            </Button>
            <Button
              color="red"
              loading={busy}
              onClick={() =>
                deleting &&
                void run(
                  () => deleteCustomTimeline(deleting.id),
                  () => setDeleting(null),
                )
              }
            >
              {t("settings.customTimelines.delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
